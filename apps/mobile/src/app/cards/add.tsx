import { Ionicons } from '@expo/vector-icons';
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/card';
import { CardCode } from '@/components/card-code';
import { CardsSignInGate } from '@/components/cards-sign-in-gate';
import { PrimaryButton } from '@/components/form';
import { Screen } from '@/components/screen';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { useToast } from '@/components/toast';
import {
  diagnoseValue,
  normalizeCardValue,
  normalizeForSymbology,
  symbologyFromScanner,
  SYMBOLOGY_LABELS,
  type Symbology,
} from '@/lib/barcode';
import { haptics } from '@/lib/haptics';
import { useLoyaltyCards } from '@/lib/loyalty-cards';
import { orderedStoreOptions, recordStoreUse, useStorePrefs } from '@/lib/store-prefs';
import { getSupermarket, supermarketLabel } from '@/lib/supermarkets';
import { useAuth } from '@/store/auth';
import { useT } from '@/store/locale';
import { radii, spacing, type, useScrollIndicator, useTheme } from '@/theme';

/**
 * Add a loyalty card.
 *
 * The store comes first, before any camera or gallery access. That ordering is
 * deliberate: a card photographed with no idea which chain it belongs to is
 * unfilable, and asking afterwards means the user has already granted camera
 * permission for something we might then discard.
 *
 * Three capture routes, in descending reliability:
 *
 * 1. **Scan the card** — see "Two scanners" below.
 * 2. **Import a screenshot** — best-effort. `scanFromURLAsync` reads *only QR
 *    codes on iOS*, and on Android wants the barcode to fill most of the frame,
 *    so this fails often enough that it must fail *softly* — it drops into
 *    manual entry with an explanation rather than dead-ending.
 * 3. **Type the number** — always available, always works. Long loyalty numbers
 *    are printed on the card, and this is the only route that needs no
 *    permission at all.
 *
 * Whichever route is used, the last step shows the re-drawn code beside the
 * number so the user can check it against the physical card before saving.
 *
 * ---------------------------------------------------------------------------
 * Two scanners, and why the in-process one is the fallback
 * ---------------------------------------------------------------------------
 *
 * Preferred: `CameraView.launchScanner`, Google Play Services' own code scanner
 * (ML Kit). The camera is opened, driven and closed by Play Services in ITS
 * process, and every outcome — a code, a cancel, a device that cannot produce a
 * preview — comes back as a resolved or rejected promise.
 *
 * Fallback: mounting `<CameraView>` ourselves, which runs CameraX inside this
 * app.
 *
 * That ordering used to be the other way round, and it crashed. CameraX's
 * initialisation runs on its own background thread and retries for several
 * seconds before giving up with
 *
 *     CameraUnavailableException: Device reporting less cameras than
 *     anticipated. Available cameras: 0
 *
 * thrown from that thread. Nothing in JavaScript can catch it — not a try/catch
 * around the render, not an error boundary, not `onMountError`, which never
 * fires because the failure is not in the view. It reaches Android's default
 * uncaught-exception handler and takes the process down, typically well after
 * the user has moved on, so the crash does not even look like it came from the
 * scanner. Devices with no usable camera at all (emulators, some managed
 * handsets, a camera held by another app) are the ones that hit it — precisely
 * the devices where the answer should be "type the number instead".
 *
 * Handing the camera to Play Services removes our process from that failure
 * entirely, and costs nothing on devices where it works: same formats, same
 * result payload, better decoder, no camera permission prompt of our own. The
 * `<CameraView>` path survives only for the minority without Play Services —
 * where the risk is real but unavoidable, and where we have no alternative to
 * offer beyond manual entry, which is already one tap away.
 */

/** Everything the scanner can recognise that's plausible on a loyalty card. */
const SCAN_TYPES = [
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'code93',
  'codabar',
  'itf14',
  'qr',
  'pdf417',
  'aztec',
  'datamatrix',
] as const;

type Step = 'store' | 'method' | 'scan' | 'manual' | 'confirm';

/**
 * Did the Play Services scanner close because the user backed out of it?
 *
 * Backing out is not a failure and must leave the user exactly where they were,
 * with the method list still on screen; every other rejection means the scanner
 * could not do its job and we owe them the manual route with a reason.
 *
 * Matched on the coded error rather than the message, since the message is not
 * localised and not stable. Expo derives the code from the Kotlin exception
 * name, so `BarcodeScanningCancelledException` arrives as
 * `ERR_BARCODE_SCANNING_CANCELLED`; the substring test keeps working if that
 * derivation is ever adjusted. The message is checked too, purely as a second
 * chance — guessing "cancelled" wrong in the safe direction only costs a
 * needless trip to manual entry.
 */
function isScannerCancellation(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const text = `${typeof code === 'string' ? code : ''} ${typeof message === 'string' ? message : ''}`;
  return /cancel/i.test(text);
}

export default function AddCardScreen() {
  const { colors } = useTheme();
  const t = useT();
  const { user, initializing } = useAuth();
  // undefined while auth resolves — addCard refuses until the scope is known,
  // so a card can't be filed under the device bucket by a launch-time race.
  const {
    addCard,
    loading: walletLoading,
    needsSignIn,
  } = useLoyaltyCards(initializing ? undefined : user?.id ?? null);
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('store');
  const [store, setStore] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [symbology, setSymbology] = useState<Symbology>('code128');
  // Explains why we've landed on manual entry, when we got there by failure
  // rather than by choice.
  const [manualReason, setManualReason] = useState<string | null>(null);
  /**
   * Did a scanner produce the current value, or did someone type it?
   *
   * Only a scanner sees a code's real payload. A typed number is the printed
   * one, which for a linear barcode is normally the same thing and for a QR
   * frequently is not — see LoyaltyCard.scanned. Tracked here so the confirm
   * step can say so before the card is saved rather than at the checkout.
   */
  const [scanned, setScanned] = useState(false);
  const [importing, setImporting] = useState(false);

  // Recomputed as the user types, so the warnings are live.
  const diagnosis = diagnoseValue(value);

  /**
   * What this chain's cards are known to use, when it disagrees with what we'd
   * draw. Advisory only — a hint confirmed in one country can be wrong in
   * another, so it never blocks saving.
   */
  const expected = store ? getSupermarket(store)?.cardFormat : undefined;
  const storeExpectation =
    expected && expected !== symbology && !diagnosis.options.includes(expected)
      ? t('cards.storeExpects', {
          store: supermarketLabel(store ?? '') ?? '',
          format: SYMBOLOGY_LABELS[expected],
        })
      : null;

  const chooseStore = (name: string) => {
    setStore(name);
    setStep('method');
  };

  const onScanned = useCallback((scannedType: string, data: string) => {
    // The scanner's payload is the truth. Pick the symbology from what it
    // reported, then clean the value only in the way that symbology allows —
    // a QR code keeps every character, a printed number loses its spacing.
    const sym = symbologyFromScanner(scannedType, data);
    const clean = normalizeForSymbology(sym, data);
    if (!clean) return;
    setSymbology(sym);
    setValue(clean);
    setScanned(true);
    haptics.success();
    setStep('confirm');
  }, []);

  /**
   * Open a scanner — Play Services' where it exists, ours where it doesn't.
   *
   * The listener is attached BEFORE the launch and removed in `finally`,
   * because the native side emits `onModernBarcodeScanned` and only then
   * resolves the promise. Subscribing afterwards would miss the only event we
   * are here for, and leaving it attached would double-handle the next scan.
   *
   * `handled` guards the same result arriving twice — the scanner is meant to
   * fire once per launch, but `onScanned` advances a step, and a second call
   * would advance it again from a state that has already moved on.
   */
  const startScan = useCallback(async () => {
    if (!CameraView.isModernBarcodeScannerAvailable) {
      setStep('scan');
      return;
    }
    let handled = false;
    const subscription = CameraView.onModernBarcodeScanned(({ type, data }) => {
      if (handled) return;
      handled = true;
      onScanned(type, data);
    });
    try {
      await CameraView.launchScanner({ barcodeTypes: [...SCAN_TYPES] });
    } catch (error) {
      // No camera, no ML Kit module, Play Services mid-update: all the same
      // answer from here. Never fall back to mounting our own CameraView —
      // that is the code path this exists to avoid.
      if (!isScannerCancellation(error)) {
        setManualReason(t('cards.scannerUnavailable'));
        setStep('manual');
      }
    } finally {
      subscription.remove();
    }
  }, [onScanned, t]);

  /** Gallery import. Falls through to manual entry on any failure. */
  const importFromLibrary = async () => {
    setImporting(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setManualReason(t('cards.needPhotoAccess'));
        setStep('manual');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (picked.canceled || !picked.assets[0]) return;

      // Wrapped because a failed decode has been known to throw rather than
      // return empty in Android release builds (expo#35011) — a crash here
      // would lose the store the user already picked.
      let found: { type: string; data: string } | null = null;
      try {
        const results = await scanFromURLAsync(picked.assets[0].uri, [...SCAN_TYPES]);
        if (results.length > 0) found = results[0];
      } catch {
        found = null;
      }

      if (!found) {
        setManualReason(
          Platform.OS === 'ios' ? t('cards.importIosLimit') : t('cards.importFailed'),
        );
        setStep('manual');
        return;
      }
      onScanned(found.type, found.data);
    } finally {
      setImporting(false);
    }
  };

  const startManual = () => {
    setManualReason(null);
    setScanned(false);
    setStep('manual');
  };

  const confirmManual = () => {
    const clean = normalizeCardValue(value);
    if (!clean) return;
    // Take the diagnosis' pick, which agrees with guessSymbology but also
    // surfaces the options list the confirm step offers.
    setSymbology(diagnoseValue(clean).recommended);
    setScanned(false);
    setStep('confirm');
  };

  const save = () => {
    if (!store) return;
    const card = addCard({ store, value, symbology, scanned });
    if (!card) return;
    // Feed the store picker's recency ordering, same as item store choices do.
    recordStoreUse(store);
    haptics.success();
    showToast(t('cards.savedToast', { store: supermarketLabel(store) ?? store }));
    // back(), not replace('/cards'): the wallet is already the screen below
    // this one, so replacing would stack a second copy of it and make the next
    // back press look like it did nothing. The wallet re-renders with the new
    // card because both screens read the same store.
    router.back();
  };

  /* ------------------------------------------------------------- sign-in gate */

  // A card needs an owner, so there is nothing to do here without an account.
  // Checked before the camera step too: signing out mid-flow (or arriving by a
  // deep link) must not leave a form that silently refuses to save.
  if (needsSignIn) {
    return (
      <Screen title={t('cards.addTitle')} subtitle={t('cards.signInTitle')}>
        <CardsSignInGate />
      </Screen>
    );
  }

  /* -------------------------------------------------------------- scan step */

  // Full-bleed camera, outside the standard Screen shell.
  if (step === 'scan') {
    return <ScanStep onScanned={onScanned} onCancel={() => setStep('method')} onManual={startManual} />;
  }

  /* ------------------------------------------------------- everything else */

  const storeName = store ? supermarketLabel(store) ?? store : null;

  return (
    <Screen
      title={t('cards.addTitle')}
      subtitle={storeName ?? t('cards.addSubtitle')}
    >
      {step === 'store' && <StoreStep onPick={chooseStore} />}

      {step === 'method' && (
        <>
          <MethodRow
            icon="camera-outline"
            title={t('cards.scanCard')}
            body={t('cards.scanCardHint')}
            onPress={() => void startScan()}
          />
          <MethodRow
            icon="images-outline"
            title={t('cards.importScreenshot')}
            body={t('cards.importScreenshotHint')}
            onPress={importFromLibrary}
            loading={importing}
          />
          <MethodRow
            icon="keypad-outline"
            title={t('cards.enterManually')}
            body={t('cards.enterManuallyHint')}
            onPress={startManual}
          />
          <Pressable onPress={() => setStep('store')} style={styles.backRow} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={colors.muted} />
            <Text style={[type.sub, { color: colors.muted }]}>{t('cards.changeStore')}</Text>
          </Pressable>
        </>
      )}

      {step === 'manual' && (
        <>
          {manualReason && (
            <Card>
              <View style={styles.noticeRow}>
                <Ionicons name="information-circle-outline" size={20} color={colors.warn} />
                <Text style={[type.sub, { color: colors.ink, flex: 1 }]}>{manualReason}</Text>
              </View>
            </Card>
          )}
          <Card>
            <Text style={[type.label, { color: colors.muted }]}>{t('cards.numberLabel')}</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={t('cards.numberPlaceholder')}
              placeholderTextColor={colors.muted}
              autoFocus
              // Not "characters": Code 128 is case-sensitive, so force-upper
              // -casing a number that legitimately contains lowercase would
              // encode a different value than the card carries.
              autoCapitalize="none"
              autoCorrect={false}
              // Not numeric-only: some loyalty numbers carry letters, and the
              // encoder handles both.
              keyboardType="default"
              onSubmitEditing={confirmManual}
              returnKeyType="done"
              style={[
                styles.input,
                { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line },
              ]}
            />
            <Text style={[type.sub, { color: colors.muted }]}>{t('cards.numberHint')}</Text>
            {/* Live diagnosis. The point is to catch, before saving, the two
                cases that otherwise only surface as a refused card at the till:
                a mistyped check digit, and a printed number longer than the
                barcode actually encodes. */}
            {diagnosis.warning && (
              <View style={styles.noticeRow}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.warn} />
                <Text style={[type.sub, { color: colors.ink, flex: 1 }]}>
                  {diagnosis.warning === 'nonStandardLength'
                    ? t('cards.warnNonStandard', { count: diagnosis.digits })
                    : t('cards.warnCheckDigit', {
                        format: SYMBOLOGY_LABELS[
                          diagnosis.warning === 'ean13CheckFailed'
                            ? 'ean13'
                            : diagnosis.warning === 'upcaCheckFailed'
                              ? 'upca'
                              : 'ean8'
                        ],
                      })}
                </Text>
              </View>
            )}
            {/* Chain-specific expectation, when we have one and it disagrees. */}
            {storeExpectation && (
              <View style={styles.noticeRow}>
                <Ionicons name="information-circle-outline" size={18} color={colors.accent} />
                <Text style={[type.sub, { color: colors.ink, flex: 1 }]}>{storeExpectation}</Text>
              </View>
            )}
          </Card>
          <PrimaryButton
            label={t('common.continue')}
            onPress={confirmManual}
            disabled={!normalizeCardValue(value)}
          />
          <Pressable onPress={() => setStep('method')} style={styles.backRow} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={colors.muted} />
            <Text style={[type.sub, { color: colors.muted }]}>{t('common.back')}</Text>
          </Pressable>
        </>
      )}

      {step === 'confirm' && (
        <>
          <Card>
            <Text style={[type.label, { color: colors.muted }]}>{t('cards.checkTitle')}</Text>
            <Text style={[type.sub, { color: colors.muted }]}>{t('cards.checkBody')}</Text>
            <View style={styles.preview}>
              <CardCode symbology={symbology} value={value} width={280} />
            </View>
            {/* The exact symbology, not just barcode-vs-QR. A till expecting
                EAN-13 rejects the same digits drawn as Code 128, so when a value
                qualifies for a retail format the user has to be able to say so.
                Only formats this value can actually encode are offered. */}
            <View style={styles.formatBlock}>
              <Text style={[type.label, { color: colors.muted }]}>{t('cards.formatLabel')}</Text>
              <View style={styles.chips}>
                {diagnosis.options.map((option) => {
                  const active = option === symbology;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setSymbology(option)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.chip,
                        {
                          borderColor: active ? colors.accent : colors.line,
                          backgroundColor: active ? colors.accentSoft : colors.surface,
                        },
                      ]}
                    >
                      <Text
                        style={[type.sub, { color: active ? colors.accent : colors.ink }]}
                        numberOfLines={1}
                      >
                        {SYMBOLOGY_LABELS[option]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {storeExpectation && (
                <Text style={[type.sub, { color: colors.muted }]}>{storeExpectation}</Text>
              )}
            </View>
            {/*
              A QR the user did not scan.

              This is the one combination the app cannot get right on its own,
              and it fails in the most convincing way possible. A linear barcode
              on a loyalty card normally encodes exactly the digits printed
              under it, so typing them reproduces the card. A QR is chosen
              precisely because it can hold more — an internal id, a URL — and
              the printed number is then just a label for humans. Drawn from
              that number the QR is well-formed, scans fine, and carries a
              payload the till has never seen.

              Nothing here can tell which kind a given retailer uses, so this
              says what it does know: where the value came from.
            */}
            {symbology === 'qr' && !scanned && (
              <View style={styles.noticeRow}>
                <Ionicons name="warning-outline" size={20} color={colors.warn} />
                <Text style={[type.sub, { color: colors.ink, flex: 1 }]}>
                  {t('cards.typedQrWarning')}
                </Text>
              </View>
            )}
          </Card>
          {/* Held until the wallet knows whose it is, so saving can't quietly
              no-op during the launch-time auth race. */}
          <PrimaryButton label={t('cards.saveCard')} onPress={save} loading={walletLoading} />
          <Pressable onPress={startManual} style={styles.backRow} hitSlop={8}>
            <Ionicons name="create-outline" size={18} color={colors.accent} />
            <Text style={[type.sub, { color: colors.accent }]}>{t('cards.editNumber')}</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

/* ---------------------------------------------------------------- store step */

/**
 * Which chain is this card for. Reuses the same recency-ordered catalogue as
 * the per-item store picker, so a shop you use often is near the top here too.
 */
function StoreStep({ onPick }: { onPick: (store: string) => void }) {
  const { colors } = useTheme();
  const t = useT();
  const prefs = useStorePrefs();
  const [custom, setCustom] = useState('');
  const options = orderedStoreOptions(prefs);

  const clean = custom.trim();

  return (
    <>
      <Card>
        <Text style={[type.label, { color: colors.muted }]}>{t('cards.storeLabel')}</Text>
        <View style={styles.chips}>
          {options.map((option) => {
            const id = option.id;
            const label = option.kind === 'chain' ? option.chain.name : id;
            return (
              <Pressable
                key={`${option.kind}:${id}`}
                onPress={() => onPick(id)}
                style={[styles.chip, { borderColor: colors.line, backgroundColor: colors.surface }]}
              >
                <SupermarketBadge store={id} size={20} />
                <Text style={[type.sub, { color: colors.ink }]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card>
        <Text style={[type.label, { color: colors.muted }]}>{t('cards.otherStore')}</Text>
        <TextInput
          value={custom}
          onChangeText={setCustom}
          placeholder={t('cards.otherStorePlaceholder')}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => clean && onPick(clean)}
          style={[
            styles.input,
            { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line },
          ]}
        />
      </Card>

      <PrimaryButton
        label={t('common.continue')}
        onPress={() => clean && onPick(clean)}
        disabled={!clean}
      />
    </>
  );
}

/* ----------------------------------------------------------------- scan step */

function ScanStep({
  onScanned,
  onCancel,
  onManual,
}: {
  onScanned: (type: string, data: string) => void;
  onCancel: () => void;
  onManual: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const [permission, requestPermission] = useCameraPermissions();
  // The camera fires repeatedly while a code is in frame; latch so we navigate
  // once instead of pushing the confirm step over and over.
  const [locked, setLocked] = useState(false);

  if (!permission) {
    return (
      <View style={[styles.camFallback, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.camFallback, { backgroundColor: colors.bg }]}>
        <ScrollView {...scrollIndicator} contentContainerStyle={styles.permWrap}>
          <Ionicons name="camera-outline" size={44} color={colors.muted} />
          <Text style={[type.h2, { color: colors.ink, textAlign: 'center' }]}>
            {t('cards.cameraNeededTitle')}
          </Text>
          <Text style={[type.sub, { color: colors.muted, textAlign: 'center' }]}>
            {t('cards.cameraNeededBody')}
          </Text>
          {/* canAskAgain false means the OS won't show the prompt any more, so
              offering "Allow" again would do nothing — send them to typing. */}
          {permission.canAskAgain ? (
            <PrimaryButton label={t('cards.allowCamera')} onPress={() => void requestPermission()} />
          ) : (
            <PrimaryButton label={t('cards.enterManually')} onPress={onManual} />
          )}
          <Pressable onPress={onCancel} style={styles.backRow} hitSlop={8}>
            <Text style={[type.sub, { color: colors.muted }]}>{t('common.cancel')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.camRoot}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: [...SCAN_TYPES] }}
        onBarcodeScanned={({ type, data }) => {
          if (locked) return;
          setLocked(true);
          onScanned(type, data);
        }}
      />
      <SafeAreaView style={styles.camOverlay}>
        <Text style={styles.camHint}>{t('cards.scanHint')}</Text>
        {/* A window to aim through — scanning isn't restricted to it, but it
            tells the user how close to hold the card. */}
        <View style={styles.reticle} />
        <View style={styles.camActions}>
          <Pressable onPress={onManual} style={styles.camButton} hitSlop={8}>
            <Text style={styles.camButtonText}>{t('cards.enterManually')}</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={styles.camButton} hitSlop={8}>
            <Text style={styles.camButtonText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

/* --------------------------------------------------------------- method rows */

function MethodRow({
  icon,
  title,
  body,
  onPress,
  loading = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  onPress: () => void;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={loading}>
      <Card>
        <View style={styles.methodRow}>
          <Ionicons name={icon} size={24} color={colors.accent} />
          <View style={styles.grow}>
            <Text style={[type.body, { color: colors.ink }]}>{title}</Text>
            <Text style={[type.sub, { color: colors.muted }]}>{body}</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          )}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    letterSpacing: 1,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    // Translations run long (Dutch/German especially), so a chip may need to
    // wrap to its own row rather than overflow.
    maxWidth: '100%',
  },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  preview: { alignItems: 'center', paddingTop: spacing.sm },
  formatBlock: { gap: spacing.sm, paddingTop: spacing.sm },

  camRoot: { flex: 1, backgroundColor: '#000000' },
  camFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  permWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
  camOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.xl,
  },
  camHint: {
    ...type.body,
    color: '#FFFFFF',
    textAlign: 'center',
    // Legible over whatever the camera happens to be pointing at.
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowRadius: 6,
  },
  reticle: {
    width: '86%',
    aspectRatio: 1.6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: radii.md,
  },
  camActions: { flexDirection: 'row', gap: spacing.md },
  camButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  camButtonText: { ...type.body, color: '#FFFFFF' },
});

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
import { PrimaryButton } from '@/components/form';
import { Screen } from '@/components/screen';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { useToast } from '@/components/toast';
import {
  guessSymbology,
  normalizeCardValue,
  normalizeForSymbology,
  symbologyFromScanner,
  type Symbology,
} from '@/lib/barcode';
import { haptics } from '@/lib/haptics';
import { useLoyaltyCards } from '@/lib/loyalty-cards';
import { orderedStoreOptions, recordStoreUse, useStorePrefs } from '@/lib/store-prefs';
import { supermarketLabel } from '@/lib/supermarkets';
import { useAuth } from '@/store/auth';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

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
 * 1. **Scan the card** — live camera. The one that works everywhere.
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

export default function AddCardScreen() {
  const { colors } = useTheme();
  const t = useT();
  const { user, initializing } = useAuth();
  // undefined while auth resolves — addCard refuses until the scope is known,
  // so a card can't be filed under the device bucket by a launch-time race.
  const { addCard, loading: walletLoading } = useLoyaltyCards(
    initializing ? undefined : user?.id ?? null,
  );
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('store');
  const [store, setStore] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [symbology, setSymbology] = useState<Symbology>('code128');
  // Explains why we've landed on manual entry, when we got there by failure
  // rather than by choice.
  const [manualReason, setManualReason] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

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
    haptics.success();
    setStep('confirm');
  }, []);

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
    setStep('manual');
  };

  const confirmManual = () => {
    const clean = normalizeCardValue(value);
    if (!clean) return;
    setSymbology(guessSymbology(clean));
    setStep('confirm');
  };

  const save = () => {
    if (!store) return;
    const card = addCard({ store, value, symbology });
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
            onPress={() => setStep('scan')}
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
        <ScrollView contentContainerStyle={styles.permWrap}>
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

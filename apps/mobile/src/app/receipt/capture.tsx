import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form';
import { PressScale } from '@/components/press-scale';
import { useToast } from '@/components/toast';
import { haptics } from '@/lib/haptics';
import {
  CAPTURE_QUALITY,
  FALLBACK_QUALITY,
  MAX_SHOTS,
  pickPictureSize,
  tooLarge,
} from '@/lib/receipt-capture';
import { runScan, stashRun } from '@/lib/receipt-run';
import { useGroceries } from '@/store/groceries';
import { useLocale } from '@/store/locale';
import { radii, spacing, type, useScrollIndicator, useTheme } from '@/theme';

/**
 * Photograph a receipt.
 *
 * ---------------------------------------------------------------------------
 * Multi-shot, because receipts are the wrong shape
 * ---------------------------------------------------------------------------
 *
 * A weekly shop prints a metre of paper. Held far enough back to fit in one
 * frame, the type is smaller than the sensor can resolve and the decimal points
 * go first — which is the worst possible thing to lose, because a receipt that
 * reads 1,67 as 167 still reconciles against nothing and still looks like an
 * answer.
 *
 * So the shopper takes it in sections, close enough to read, and the extractor
 * is told to merge what two photographs show twice. That merge is the reason
 * OVERLAP is asked for in the hint rather than left to chance: the model can
 * only recognise a repeated line if the repetition is actually in both frames.
 *
 * ---------------------------------------------------------------------------
 * Why the camera is mounted here, given what cards/add.tsx says about that
 * ---------------------------------------------------------------------------
 *
 * The loyalty-card scanner goes out of its way NOT to mount `<CameraView>` —
 * CameraX can throw from its own background thread on devices reporting zero
 * cameras, and nothing in JavaScript can catch it. That warning stands and is
 * worth reading before touching this file.
 *
 * It is not followed here because the alternative does not exist. That screen
 * had one: Play Services' scanner, which opens the camera in ANOTHER process
 * and hands back a string. The equivalent for photographs is
 * `ImagePicker.launchCameraAsync`, and it is out of the question for a
 * different reason — it offers `quality` and no way to bound resolution, so it
 * returns a twelve-megapixel JPEG. Base64 that and it is over the size ceiling
 * receipt-scan enforces, on most phones, most of the time. A feature that fails
 * at the till for the majority is worse than one that cannot run on a handset
 * with no camera, where it could never have run anyway.
 *
 * `pictureSize` — the prop that makes the difference — exists only on a mounted
 * CameraView. So: mounted, with `onMountError` catching the failures that CAN
 * be caught, and no pretence about the ones that cannot.
 */

interface Shot {
  uri: string;
  base64: string;
}

export default function ReceiptCaptureScreen() {
  const { colors } = useTheme();
  const { t, language } = useLocale();
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lists } = useGroceries();
  const [permission, requestPermission] = useCameraPermissions();
  const scrollIndicator = useScrollIndicator();

  const camera = useRef<CameraView>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [ready, setReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [mountFailed, setMountFailed] = useState(false);

  const list = lists.find((l) => l.id === id);

  /**
   * Ask the camera what sizes it has, once it exists.
   *
   * Only reachable after `onCameraReady`, which is also the gate on the
   * shutter — so by the time a shot can be taken, `pictureSize` has either been
   * chosen or deliberately left unset. A device offering nothing big enough
   * keeps its own default, which is the right answer for a camera that is
   * already smaller than we would have asked for.
   */
  const onCameraReady = useCallback(async () => {
    try {
      const sizes = (await camera.current?.getAvailablePictureSizesAsync()) ?? [];
      const chosen = pickPictureSize(sizes);
      if (chosen) setPictureSize(chosen);
    } catch {
      // Not fatal, and not worth a message: the camera's default resolution
      // still produces a photograph, and `tooLarge` catches it downstream if
      // that photograph turns out to be enormous.
    }
    setReady(true);
  }, []);

  /**
   * One shot.
   *
   * Taken twice at most: `pictureSize` bounds the pixels, so an oversized
   * result should be impossible, but "should be impossible" and a hard ceiling
   * at the far end of a supermarket's wifi are a bad pairing. The retry drops
   * the JPEG quality rather than asking the shopper to do anything, because
   * from their side the first attempt did not visibly happen.
   */
  const shoot = useCallback(async () => {
    if (!ready || busy || shots.length >= MAX_SHOTS) return;
    setBusy(true);
    haptics.tick();
    try {
      for (const quality of [CAPTURE_QUALITY, FALLBACK_QUALITY]) {
        const photo = await camera.current?.takePictureAsync({ quality, base64: true });
        const base64 = photo?.base64;
        if (!photo || !base64) break;
        if (tooLarge(base64) && quality !== FALLBACK_QUALITY) continue;
        if (tooLarge(base64)) break;
        setShots((prev) => [...prev, { uri: photo.uri, base64 }]);
        haptics.success();
        setBusy(false);
        return;
      }
      showToast(t('receipt.shotFailed'));
    } catch {
      showToast(t('receipt.shotFailed'));
    }
    setBusy(false);
  }, [busy, ready, shots.length, showToast, t]);

  const removeShot = (index: number) => {
    haptics.tick();
    setShots((prev) => prev.filter((_, i) => i !== index));
  };

  /**
   * Send them.
   *
   * The list is passed as candidates so the matcher has something to match
   * against — a receipt scanned against a list that has since been emptied
   * still reads fine, it just matches nothing, which the review sheet shows as
   * a page of new items.
   */
  const scan = useCallback(async () => {
    if (shots.length === 0 || scanning) return;
    setScanning(true);
    const run = await runScan(
      shots.map((s) => ({ media: 'image/jpeg', data: s.base64 })),
      language,
      (list?.items ?? []).map((it) => ({
        id: it.id,
        name: it.name,
        category: it.category,
      })),
    );
    setScanning(false);

    if (!run) {
      // One message for every failure — an unreachable function, the rate cap,
      // a photograph the model could not read. At a till the difference is not
      // actionable: the answer is always another photograph or typing it in.
      showToast(t('receipt.scanFailed'));
      return;
    }

    haptics.success();
    stashRun(run);
    router.replace({ pathname: '/receipt/review', params: { id: list?.id ?? '' } });
  }, [language, list, scanning, shots, showToast, t]);

  /* ----------------------------------------------------------- permission */

  if (!permission) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!permission.granted || mountFailed) {
    return (
      <SafeAreaView style={[styles.fallback, { backgroundColor: colors.bg }]}>
        <ScrollView {...scrollIndicator} contentContainerStyle={styles.permWrap}>
          <Ionicons name="camera-outline" size={44} color={colors.muted} />
          <Text style={[type.h2, { color: colors.ink, textAlign: 'center' }]}>
            {t('receipt.cameraNeededTitle')}
          </Text>
          <Text style={[type.sub, { color: colors.muted, textAlign: 'center' }]}>
            {mountFailed ? t('receipt.cameraUnavailable') : t('receipt.cameraNeededBody')}
          </Text>
          {/* `canAskAgain` false means the OS will not show the prompt again,
              so an Allow button would do nothing at all. */}
          {!mountFailed && permission.canAskAgain && (
            <PrimaryButton
              label={t('receipt.allowCamera')}
              onPress={() => void requestPermission()}
            />
          )}
          <Pressable onPress={() => router.back()} style={styles.backRow} hitSlop={8}>
            <Text style={[type.sub, { color: colors.muted }]}>{t('common.cancel')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* --------------------------------------------------------------- camera */

  const full = shots.length >= MAX_SHOTS;

  return (
    <View style={styles.root}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        pictureSize={pictureSize}
        onCameraReady={() => void onCameraReady()}
        onMountError={() => setMountFailed(true)}
      />

      <SafeAreaView style={styles.overlay}>
        <View style={styles.top}>
          <Text style={styles.hint}>
            {full ? t('receipt.hintFull') : t('receipt.hint', { max: MAX_SHOTS })}
          </Text>
          <Pressable onPress={() => router.back()} style={styles.close} hitSlop={12}>
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={styles.bottom}>
          {/* What has been taken so far, tappable to drop a bad frame. Shown
              even when empty is pointless, so it isn't. */}
          {shots.length > 0 && (
            <ScrollView
              horizontal
              {...scrollIndicator}
              contentContainerStyle={styles.thumbs}
            >
              {shots.map((shot, i) => (
                <Pressable
                  key={shot.uri}
                  onPress={() => removeShot(i)}
                  accessibilityRole="button"
                  accessibilityLabel={t('receipt.removeShot', { n: i + 1 })}
                >
                  <Image source={{ uri: shot.uri }} style={styles.thumb} contentFit="cover" />
                  <View style={styles.thumbX}>
                    <Ionicons name="close" size={12} color="#FFFFFF" />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={styles.controls}>
            {/* A spacer the width of the Scan button, so the shutter sits in
                the middle of the screen rather than the middle of what is left
                of it — a shutter that moves when a thumbnail appears is a
                shutter you miss. */}
            <View style={styles.side} />

            <PressScale
              onPress={() => void shoot()}
              disabled={!ready || busy || full}
              accessibilityRole="button"
              accessibilityLabel={t('receipt.takeShot')}
              accessibilityState={{ disabled: !ready || busy || full }}
              style={[styles.shutter, (!ready || full) && styles.shutterOff]}
            >
              {busy ? (
                <ActivityIndicator color="#000000" />
              ) : (
                <View style={styles.shutterCore} />
              )}
            </PressScale>

            <View style={styles.side}>
              {shots.length > 0 && (
                <PressScale
                  onPress={() => void scan()}
                  disabled={scanning}
                  accessibilityRole="button"
                  style={[styles.scanBtn, { backgroundColor: colors.accent }]}
                >
                  {scanning ? (
                    <ActivityIndicator color={colors.accentInk} />
                  ) : (
                    <Text style={[type.body, styles.scanLabel, { color: colors.accentInk }]}>
                      {t('receipt.scan')}
                    </Text>
                  )}
                </PressScale>
              )}
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  permWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
  overlay: { flex: 1, justifyContent: 'space-between' },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
  },
  hint: {
    ...type.sub,
    flex: 1,
    color: '#FFFFFF',
    // Legible over whatever the camera is pointing at.
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 6,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  bottom: { gap: spacing.md, paddingBottom: spacing.lg },
  thumbs: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  thumb: {
    width: 54,
    height: 72,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: '#222222',
  },
  thumbX: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  // Both sides the same width, so the shutter lands in the centre of the
  // SCREEN and stays there whether or not the Scan button is showing.
  side: { width: 96, alignItems: 'flex-end' },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  shutterOff: { opacity: 0.4 },
  shutterCore: {
    width: 54,
    height: 54,
    borderRadius: radii.pill,
    backgroundColor: '#FFFFFF',
  },
  scanBtn: {
    minWidth: 88,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanLabel: { fontWeight: '600' },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
});

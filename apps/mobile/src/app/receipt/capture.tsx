import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { MeshBackground } from '@/components/mesh-background';
import { InteractionManager } from 'react-native';
import { goBack } from '@/lib/navigate';
import {
  isReceiptSource,
  PDF_MEDIA,
  pickReceiptDocument,
  pickReceiptPhotos,
  type ReceiptSource,
} from '@/lib/receipt-source';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/form';
import { PressScale } from '@/components/press-scale';
import { ScanOverlay } from '@/components/scan-overlay';
import { Safe } from '@/components/safe';
import { ScreenNoticeView, useScreenNotice } from '@/components/screen-notice';
import { haptics } from '@/lib/haptics';
import {
  CAPTURE_QUALITY,
  FALLBACK_QUALITY,
  MAX_SHOTS,
  pickPictureSize,
  tooLarge,
} from '@/lib/receipt-capture';
import { runScan, stashRun, type ScanPhase } from '@/lib/receipt-run';
import { captureException } from '@/lib/monitoring';
import type { ScanInput } from '@/lib/receipt';
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
  /*
   * This screen is a fullScreenModal, so the root toast renders BEHIND it and
   * every message it raised was invisible until the screen was dismissed — see
   * components/screen-notice, which is where these go now.
   */
  const notice = useScreenNotice();
  /*
   * The screen stays on for as long as this one is open.
   *
   * A scan takes the better part of a minute and the phone's auto-lock is
   * commonly thirty seconds. Locking suspends the JS thread, the upload in
   * flight dies with it, and the scan has to be started again — while the model
   * call it abandoned has already run to completion and been paid for. So the
   * default lock turns a slow feature into one that silently costs money and
   * delivers nothing.
   *
   * Unconditional rather than gated on `scanning`, the same as shop mode: the
   * whole of this screen is a phone held over a receipt or waiting on one, and
   * the moment before the shutter is exactly as bad a time to sleep as the
   * moment after. It releases on unmount.
   *
   * This does not cover a lock the shopper asks for, or leaving the app. Those
   * need the scan to survive being abandoned, which is a different fix.
   */
  useKeepAwake();
  const { id, source: sourceParam } = useLocalSearchParams<{ id: string; source?: string }>();
  /*
   * Which of the three ways in this is. Defaults to the camera, so a link or a
   * restored route from before this existed still means what it used to.
   */
  const source: ReceiptSource = isReceiptSource(sourceParam) ? sourceParam : 'camera';
  const fromCamera = source === 'camera';
  const { lists } = useGroceries();
  const [permission, requestPermission] = useCameraPermissions();
  const scrollIndicator = useScrollIndicator();

  const camera = useRef<CameraView>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  /*
   * The shot just taken, not yet kept.
   *
   * A live camera preview cannot tell you whether the PRICES came out legible,
   * and that is the only thing that matters here — a blurred receipt reads as a
   * receipt right up until the review sheet is full of nonsense. So every shot
   * gets looked at full-screen before it counts, and the way back is one tap.
   */
  const [pending, setPending] = useState<Shot | null>(null);
  const [ready, setReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>('reading');
  const [mountFailed, setMountFailed] = useState(false);
  /** The chosen PDF's filename, so the progress screen names what it is reading. */
  const [pdfName, setPdfName] = useState<string | null>(null);
  /** Whether a picker is open, so the button cannot stack a second one. */
  const [picking, setPicking] = useState(false);

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
    if (!ready || busy || pending || shots.length >= MAX_SHOTS) return;
    setBusy(true);
    haptics.tick();
    try {
      for (const quality of [CAPTURE_QUALITY, FALLBACK_QUALITY]) {
        const photo = await camera.current?.takePictureAsync({ quality, base64: true });
        const base64 = photo?.base64;
        if (!photo || !base64) break;
        if (tooLarge(base64) && quality !== FALLBACK_QUALITY) continue;
        if (tooLarge(base64)) break;
        // Held, not kept. `keep` below is what appends it.
        setPending({ uri: photo.uri, base64 });
        haptics.success();
        setBusy(false);
        return;
      }
      notice.show(t('receipt.shotFailed'));
    } catch {
      notice.show(t('receipt.shotFailed'));
    }
    setBusy(false);
  }, [busy, pending, ready, shots.length, notice, t]);

  const keep = () => {
    if (!pending) return;
    haptics.tick();
    setShots((prev) => [...prev, pending]);
    setPending(null);
  };

  const retake = () => {
    haptics.tick();
    setPending(null);
  };

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
  /**
   * Send whatever we have — photographs or a PDF.
   *
   * Takes the payload rather than reading `shots`, because there are three
   * sources now and only one of them fills that array. Everything after the
   * upload is identical: the same progress phases, the same one message for
   * every failure, the same hand-off to the review sheet.
   */
  const send = useCallback(
    async (input: ScanInput) => {
    setPhase('reading');
    setScanning(true);
    const outcome = await runScan(
      input,
      language,
      (list?.items ?? []).map((it) => ({
        id: it.id,
        name: it.name,
        category: it.category,
      })),
      setPhase,
    );
    setScanning(false);

    if (!outcome.ok) {
      /*
       * One message per REASON, which replaced one message for everything.
       *
       * The old note here argued that at a till the difference is not
       * actionable, so every failure said "we could not read that receipt — try
       * a clearer photo". That holds only while the thing being scanned is a
       * photograph. A shop's emailed PDF is text, and being told to photograph
       * it more clearly is advice that cannot be followed, about a file that was
       * never at fault. It is also the sentence a shopper sees when the function
       * is simply not deployed.
       *
       * `refused` keeps the generic sentence because its cause is ours and not
       * theirs — but only the image path adds "try a clearer photo", and the
       * status goes to the log so the cause is recoverable afterwards.
       */
      const { failure } = outcome;
      if (failure.reason === 'refused') {
        captureException(new Error(`receipt-scan refused: ${failure.status}`), {
          status: failure.status,
          detail: failure.detail,
          kind: input.kind,
        });
      }
      notice.show(
        t(
          failure.reason === 'offline'
            ? 'receipt.scanOffline'
            : failure.reason === 'timeout'
              ? 'receipt.scanTimeout'
              : input.kind === 'document'
                ? 'receipt.scanFailedFile'
                : 'receipt.scanFailed',
        ),
      );
      return;
    }

    const { run } = outcome;
    haptics.success();
    stashRun(run);
    router.replace({ pathname: '/receipt/review', params: { id: list?.id ?? '' } });
    },
    [language, list, notice, t],
  );

  const scan = useCallback(() => {
    if (shots.length === 0 || scanning) return;
    void send({
      kind: 'images',
      images: shots.map((s) => ({ media: 'image/jpeg', data: s.base64 })),
    });
  }, [scanning, send, shots]);

  /*
   * ---------------------------------------------------------------------------
   * THE TWO SOURCES THAT ARE NOT THE CAMERA
   * ---------------------------------------------------------------------------
   *
   * Launched once, on arrival, because picking IS the screen for them — there
   * is nothing to look at behind an OS picker, and a screen that waits for a
   * tap before opening one is a tap that means nothing.
   *
   * `opened` is a ref rather than state: a second launch would stack a second
   * picker on iOS, and this effect re-runs whenever any of its dependencies
   * settle. It must fire exactly once per mount.
   *
   * Cancelling goes back rather than leaving an empty screen. The person
   * changed their mind at the picker; there is nothing here for them.
   */
  const openPicker = useCallback(async () => {
    if (picking) return;
    setPicking(true);
    try {
      if (source === 'photos') {
        const picked = await pickReceiptPhotos();
        if (picked.status === 'picked') {
          // Into the same strip the camera fills, so they are confirmed and
          // removable exactly as photographs taken here are.
          setShots(picked.images);
          return;
        }
        // Cancelled is the one that leaves; every other answer is something
        // gone wrong, and the person stays on a screen that can try again.
        if (picked.status === 'cancelled') {
          goBack();
          return;
        }
        notice.show(
          t(
            picked.status === 'denied'
              ? 'receipt.photosDenied'
              : picked.status === 'tooLarge'
                ? 'receipt.photoTooLarge'
                : 'receipt.pickerFailed',
          ),
        );
        return;
      }

      const picked = await pickReceiptDocument();
      if (picked.status === 'cancelled') {
        goBack();
        return;
      }
      if (picked.status !== 'picked') {
        /*
         * Four refusals, four sentences. `unavailable` is the one that is not
         * the shopper's doing at all — this binary predates the PDF path — and
         * telling them their file was too large would send them off to shrink
         * something that was never the problem.
         */
        notice.show(
          t(
            picked.status === 'wrongType'
              ? 'receipt.notAPdf'
              : picked.status === 'unavailable'
                ? 'receipt.pdfNeedsUpdate'
                : picked.status === 'tooLarge'
                  ? 'receipt.pdfTooLarge'
                  : picked.status === 'busy'
                    ? 'receipt.pdfPickerBusy'
                    : 'receipt.pickerFailed',
          ),
        );
        return;
      }
      /*
       * Straight to the scan. There is no confirm step for a PDF: it is not a
       * photograph, its legibility is not in question, and a thumbnail of page
       * one would be a decision nobody can make anything of.
       */
      setPdfName(picked.name);
      await send({ kind: 'document', media: PDF_MEDIA, data: picked.data });
    } finally {
      setPicking(false);
    }
  }, [picking, source, send, notice, t]);

  /*
   * ---------------------------------------------------------------------------
   * OPENING THE PICKER, AFTER THE SCREEN IS ACTUALLY THERE
   * ---------------------------------------------------------------------------
   *
   * This ran straight out of a mount effect and did nothing at all: on iOS an
   * OS picker asked for while the screen is still being presented is a
   * presentation onto a view controller that is not on screen yet, and UIKit
   * declines it silently. `runAfterInteractions` waits for the navigation
   * animation to finish, which is a promise about SCHEDULING and not a
   * guarantee that the screen's view controller is done being presented.
   *
   * ---------------------------------------------------------------------------
   * ...and why the PDF source is no longer opened this way at all
   * ---------------------------------------------------------------------------
   *
   * For photographs an early call is merely wasted. For documents it is
   * permanent damage, and this is the whole of "I clicked Choose but it isn't
   * opening anything, and then I got a message that it did not work".
   *
   * Read DocumentPickerModule.swift. `getDocumentAsync` throws immediately if
   * the module's `pickingContext` is non-nil, and that context is cleared in
   * exactly two places: the two delegate callbacks. So a picker that is
   * presented but whose delegate never fires — which is what a swallowed
   * presentation IS — leaves the context set for the life of the process, and
   * every later call throws PickingInProgressException. One badly timed
   * automatic call poisons the feature until the app is restarted, which is why
   * pressing Choose afterwards does nothing either.
   *
   * expo-image-picker has no such guard: it overwrites its context rather than
   * refusing. That asymmetry is why the photo path works and this one did not,
   * and it is why only this one changes.
   *
   * A tap is the fix. It cannot happen before the screen is interactive, which
   * is the one thing an effect cannot promise — and expo-document-picker's own
   * documentation says as much about calling it on mount.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (source !== 'photos' || opened.current) return;
    opened.current = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void openPicker();
    });
    return () => task.cancel();
  }, [source, openPicker]);

  /* ----------------------------------------------------------- permission */

  /*
   * The camera's permission is the camera's problem.
   *
   * Asking a shopper who chose "Upload a photo" to grant camera access would be
   * asking for something the screen is not about to use — and on iOS a refusal
   * there is permanent, so a needless prompt costs them the camera path
   * forever. Both gates below are therefore behind `fromCamera`.
   */
  if (fromCamera && !permission) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (fromCamera && (!permission?.granted || mountFailed)) {
    return (
      <Safe style={[styles.fallback, { backgroundColor: colors.bg }]}>
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
          {!mountFailed && permission?.canAskAgain && (
            <PrimaryButton
              label={t('receipt.allowCamera')}
              onPress={() => void requestPermission()}
            />
          )}
          <Pressable onPress={() => goBack()} style={styles.backRow} hitSlop={8}>
            <Text style={[type.sub, { color: colors.muted }]}>{t('common.cancel')}</Text>
          </Pressable>
        </ScrollView>
      </Safe>
    );
  }

  /* --------------------------------------------------------------- camera */

  const full = shots.length >= MAX_SHOTS;

  return (
    <View style={styles.root}>
      {/* Only when it is the source. Mounting a camera to sit behind a gallery
          picker spins the hardware up for nothing and, on Android, is a visible
          delay before a screen the user did not come here to look at. */}
      {fromCamera ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          pictureSize={pictureSize}
          onCameraReady={() => void onCameraReady()}
          onMountError={() => setMountFailed(true)}
        />
      ) : (
        <MeshBackground />
      )}

      {/* Over the camera for the whole wait. It also takes the touches, so the
          shutter cannot be pressed while a scan is in flight — the `busy` and
          `scanning` flags guard that too, but a live-looking shutter under a
          progress screen is a confusing thing to leave reachable. */}
      {scanning && (
        <ScanOverlay uris={shots.map((s) => s.uri)} phase={phase} label={pdfName} />
      )}

      {/* Look at it before it counts. */}
      {pending && !scanning && (
        <ConfirmShot uri={pending.uri} onKeep={keep} onRetake={retake} />
      )}

      {/*
        The camera's own chrome, and ONLY while the camera is what you are
        looking at.
    
        Both of the screens above are absoluteFill and both are rendered before
        this, so without the guard this draws over them: the capture hint landed
        on top of "Can you read the amounts?" as one unreadable line of two
        sentences, and the Scan button sat over "Use photo". Two overlays, three
        sets of controls, all live at once — and the wrong one on top, because
        painting order is document order and this is last.
    
        Guarded here rather than inside each piece. A screen that has been
        replaced should stop existing, not have its parts individually talked
        out of drawing.
      */}
      {/*
        The two sources that are not the camera get their own body.
        
        They were falling through to the camera's chrome — the capture hint, the
        shutter, the Scan button — over a black screen with no camera behind it.
        That is what "a black screen with the same quotes" was: instructions for
        photographing a receipt, on a screen that was supposed to be opening a
        file picker.
        
        A button rather than a spinner, because the auto-open above is a promise
        about scheduling and not a guarantee. If it ever fails to fire there is
        still a way forward and a way out, which is the whole difference between
        this and what was there before.
      */}
      {!fromCamera && !pending && !scanning && (
        <Safe style={styles.pickWrap}>
          {shots.length === 0 ? (
            /* Nothing chosen yet — ask, and give a way out. */
            <View style={styles.pickBody}>
              <Ionicons
                name={source === 'photos' ? 'images-outline' : 'document-text-outline'}
                size={40}
                color={colors.muted}
              />
              <Text style={[type.h2, styles.pickText, { color: colors.ink }]}>
                {t(`receiptSource.${source}Title`)}
              </Text>
              <Text style={[type.sub, styles.pickText, { color: colors.muted }]}>
                {t(`receiptSource.${source}Hint`, { max: MAX_SHOTS })}
              </Text>
              <View style={styles.pickAction}>
                <PrimaryButton
                  label={t(picking ? 'receiptSource.opening' : 'receiptSource.choose')}
                  onPress={() => void openPicker()}
                  disabled={picking}
                />
              </View>
              <Pressable onPress={() => goBack()} style={styles.backRow} hitSlop={8}>
                <Text style={[type.sub, { color: colors.muted }]}>{t('common.cancel')}</Text>
              </Pressable>
            </View>
          ) : (
            /*
             * CHOSEN, AND NOW WHAT.
             *
             * This branch did not exist, and its absence is the whole of "I
             * selected a photo but it didn't come through": the pick succeeded,
             * `shots` filled, and the screen went on rendering "Choose a photo"
             * with a Choose button — no thumbnails, no way to scan, no sign
             * anything had happened. The photographs were in memory the entire
             * time with nothing on screen able to reach them.
             *
             * The same three affordances the camera's own review strip has:
             * see what you picked, drop a bad one, send them.
             */
            <View style={styles.pickBody}>
              <Text style={[type.h2, styles.pickText, { color: colors.ink }]}>
                {t('receiptSource.chosen', { count: shots.length })}
              </Text>
              {/* The × badge is 18px and sits on a dark thumbnail, which is not
                  an affordance anybody finds — the empty state above earns its
                  hint line and so does this one. */}
              <Text style={[type.sub, styles.pickText, { color: colors.muted }]}>
                {t('receiptSource.chosenHint')}
              </Text>
              <ScrollView
                horizontal
                {...scrollIndicator}
                style={styles.pickStrip}
                contentContainerStyle={styles.pickThumbs}
              >
                {shots.map((shot, i) => (
                  <Pressable
                    key={shot.uri}
                    onPress={() => removeShot(i)}
                    accessibilityRole="button"
                    accessibilityLabel={t('receipt.removeShot', { n: i + 1 })}
                  >
                    <Image
                      source={{ uri: shot.uri }}
                      style={[styles.pickThumb, { borderColor: colors.line }]}
                      contentFit="cover"
                    />
                    <View style={styles.thumbX}>
                      <Ionicons name="close" size={12} color="#FFFFFF" />
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.pickAction}>
                <PrimaryButton label={t('receipt.scan')} onPress={() => scan()} />
              </View>
              <Pressable
                onPress={() => void openPicker()}
                style={styles.backRow}
                hitSlop={8}
                disabled={picking}
              >
                <Text style={[type.sub, { color: colors.accent }]}>
                  {t('receiptSource.chooseAgain')}
                </Text>
              </Pressable>
            </View>
          )}
        </Safe>
      )}

      {fromCamera && !pending && !scanning && (
      <Safe style={styles.overlay}>
        <View style={styles.top}>
          <Text style={styles.hint}>
            {full ? t('receipt.hintFull') : t('receipt.hint', { max: MAX_SHOTS })}
          </Text>
          <Pressable onPress={() => goBack()} style={styles.close} hitSlop={12}>
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
      </Safe>
      )}

      {/*
        Last, so it is on top of every body above — and INSIDE this screen,
        which is the whole point of it existing. See components/screen-notice:
        this route is a fullScreenModal, so the app's toast renders behind it
        and none of the messages raised here were ever seen at the moment they
        were raised.
      */}
      <ScreenNoticeView notice={notice} />
    </View>
  );
}

/**
 * The shot, before it counts.
 *
 * ---------------------------------------------------------------------------
 * Why a receipt in particular needs this
 * ---------------------------------------------------------------------------
 *
 * A live camera preview is small, moving, and shows the paper — not the
 * capture. What it cannot tell you is whether the PRICES came out legible, and
 * that is the only property that matters: a blurred receipt looks exactly like
 * a receipt right up until the review sheet is full of nonsense, several
 * seconds and one vision call later.
 *
 * So the question is asked at the only moment it is cheap to answer, and the
 * caption asks the specific thing rather than "is this ok" — you cannot judge a
 * photograph in the abstract, but you can absolutely tell whether you can read
 * the amounts.
 *
 * `contentFit="contain"`, not cover: this is for inspection, and cropping the
 * edges off the thing being inspected would hide the failure most likely to
 * matter — a section of the receipt that fell outside the frame.
 */
function ConfirmShot({
  uri,
  onKeep,
  onRetake,
}: {
  uri: string;
  onKeep: () => void;
  onRetake: () => void;
}) {
  const { colors } = useTheme();
  const t = useLocale().t;

  return (
    <View style={styles.confirmRoot}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />

      <Safe style={styles.confirmChrome} edges={['top', 'bottom']}>
        <Text style={styles.hint}>{t('receipt.checkShot')}</Text>

        <View style={styles.confirmActions}>
          <PressScale
            onPress={onRetake}
            accessibilityRole="button"
            style={[styles.confirmBtn, styles.retakeBtn]}
          >
            <Ionicons name="refresh" size={18} color="#FFFFFF" />
            <Text style={[type.body, styles.retakeLabel]}>{t('receipt.retake')}</Text>
          </PressScale>

          <PressScale
            onPress={onKeep}
            accessibilityRole="button"
            style={[styles.confirmBtn, { backgroundColor: colors.accent }]}
          >
            <Ionicons name="checkmark" size={18} color={colors.accentInk} />
            <Text style={[type.body, { color: colors.accentInk, fontWeight: '600' }]}>
              {t('receipt.useShot')}
            </Text>
          </PressScale>
        </View>
      </Safe>
    </View>
  );
}

const styles = StyleSheet.create({
  // The gallery / file body. Centred, because there is nothing behind it to
  // align to — unlike the camera, whose chrome hugs the frame.
  pickWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  /*
   * A definite width, so the button below can fill it.
   *
   * This was width-by-content, which on a centred column means "as wide as the
   * widest child" — and the widest child was the words "1 chosen". The action
   * had nothing to stretch to and shrink-wrapped to its own label.
   */
  pickBody: { width: '100%', maxWidth: 320, alignItems: 'center', gap: spacing.md },
  pickText: { textAlign: 'center' },
  /** The one child that spans the column: this screen has a single action. */
  pickAction: { alignSelf: 'stretch' },
  /*
   * `flexGrow: 0`, and it is the whole reason this screen had a hole in it.
   *
   * React Native gives a HORIZONTAL ScrollView `flexGrow: 1` in its own base
   * style, which in a column means it takes every spare pixel of HEIGHT. So the
   * strip of chosen photos pushed the Scan button to the bottom of the screen
   * and left a third of a screen of nothing between them — while the branch
   * with no strip in it, the empty state, centred correctly. That difference is
   * what named the cause.
   */
  pickStrip: { flexGrow: 0, alignSelf: 'stretch' },
  /*
   * Centred until there are enough to scroll. `flexGrow` on the CONTENT (not on
   * the scroller) is what lets one photograph sit in the middle of the strip
   * rather than against its left edge, and stops mattering the moment the
   * content is wider than the frame.
   */
  pickThumbs: { gap: spacing.sm, flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  /*
   * Bigger than the camera's 54x72, deliberately. That strip is one row of
   * chrome over a live viewfinder and has to stay out of the way; this is the
   * whole screen, and the thumbnail is the only evidence the right photograph
   * was picked — at 54 wide a receipt is a grey smudge.
   */
  pickThumb: {
    width: 108,
    height: 144,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: '#222222',
  },
  confirmRoot: { ...StyleSheet.absoluteFill, backgroundColor: '#000000' },
  confirmChrome: { flex: 1, justifyContent: 'space-between', padding: spacing.lg },
  confirmActions: { flexDirection: 'row', gap: spacing.md },
  confirmBtn: {
    flexGrow: 1,
    // A zero basis so the two are exactly half each whatever the labels say in
    // German — the same pairing the list screen's action row uses.
    flexBasis: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
  },
  retakeBtn: { backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  retakeLabel: { color: '#FFFFFF' },
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

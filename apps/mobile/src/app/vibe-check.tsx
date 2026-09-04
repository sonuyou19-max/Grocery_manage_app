import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassView } from '@/components/glass';
import { ListPickerSheet } from '@/components/list-picker-sheet';
import { MeshBackground } from '@/components/mesh-background';
import { haptics } from '@/lib/haptics';
import { emojiFor } from '@/lib/item-emoji';
import { SPRING, springTo } from '@/lib/motion';

/*
 * Two durations that are deliberately NOT from the shared vocabulary.
 *
 * Both are one-shot reveals on the app's one hero screen, and both are slower
 * than anything in DURATION on purpose — they are meant to be watched, and the
 * closest shared class (`travel`, 480ms) would make the deck arrive rather than
 * unfold. A vocabulary that swallowed these would be the system overruling the
 * design, which is the opposite of what it is for.
 *
 * Named rather than typed inline, which is the whole rule: a number that names
 * itself is a decision somebody took, and an anonymous one in the middle of a
 * withTiming call is a number nobody has ever looked at twice. check-motion
 * bans the second and allows the first.
 */
/** The glow behind the deck coming up, once, as the screen settles. */
const GLOW_MS = 700;
/** The progress ring filling to its value. Long enough to be followed. */
const FILL_MS = 1100;
import { isDue, lastBoughtLabel, normalizeKey } from '@/lib/pantry-intel';
import { useHomeListAdd } from '@/lib/use-home-list-add';
import { useT } from '@/store/locale';
import { useAuth } from '@/store/auth';
import { useGroceries } from '@/store/groceries';
import { useVibeDeck, usePantryIntel, type DeckCard } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * Pantry Vibe Check — a 10-second swipe ritual over the items the app thinks
 * are running low. Left = "Almost Out" (adds it to a list), right = "Still Good"
 * (teaches the model to wait longer). Weighty physics, soft haptics, then a glow
 * and "All Set." on the last card.
 */
/**
 * The gate. This route is reachable by deep link, so guarding the Pantry tab
 * alone would leave a back door straight into the feature an account unlocks.
 *
 * A redirect rather than a teaser: arriving here is only ever the result of a
 * link or a stale navigation state, never of a guest tapping something, so
 * there is nothing to tease — the honest response is to put them where the
 * invitation actually lives.
 */
export default function VibeCheckScreen() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/(tabs)/pantry" />;
  return <SignedInVibeCheck />;
}

function SignedInVibeCheck() {
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { deck } = useVibeDeck();
  const { stats, markAlmostOut, markStillGood } = usePantryIntel();
  const { lists } = useGroceries();
  const { addToHomeList, addToChosenList } = useHomeListAdd();

  // Frozen ORDER captured when the deck opens; membership stays live below so a
  // card another household member resolves drops off this device's stack too.
  const [cards] = useState<DeckCard[]>(deck);
  // Keys the user has personally swiped this session.
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [done, setDone] = useState(false);

  // Items still due right now, minus anything still waiting on a list —
  // recomputed from shared stats, so another member's swipe removes it here.
  // Only UNCHECKED rows count as queued: a ticked row is something already
  // bought, and treating it as queued would hide the item from the deck for good.
  const validKeys = useMemo(() => {
    const excluded = new Set<string>();
    for (const list of lists) {
      for (const it of list.items) if (!it.checked) excluded.add(normalizeKey(it.name));
    }
    const now = Date.now();
    const s = new Set<string>();
    for (const key in stats) if (isDue(stats[key], now) && !excluded.has(key)) s.add(key);
    return s;
  }, [stats, lists]);

  // The live stack: frozen order, minus what anyone has resolved.
  const remaining = useMemo(
    () => cards.filter((c) => validKeys.has(c.key) && !handled.has(c.key)),
    [cards, validKeys, handled],
  );
  const top = remaining[0];

  // A swiped card with no usable home list, waiting on a destination choice.
  const [pendingPick, setPendingPick] = useState<DeckCard | null>(null);

  const THRESHOLD = width * 0.28;
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lastTickX = useSharedValue(0);
  const pastThreshold = useSharedValue(false);

  // Latest value reachable from gesture callbacks.
  const topRef = useRef<DeckCard | undefined>(top);
  topRef.current = top;

  // Reset the drag whenever the visible top card changes.
  useEffect(() => {
    tx.value = 0;
    ty.value = 0;
    lastTickX.value = 0;
    pastThreshold.value = false;
  }, [top?.key, tx, ty, lastTickX, pastThreshold]);

  // When the stack empties, celebrate once and bow out — but not while a
  // destination is still being chosen. The last card can empty the deck and
  // open the picker in the same gesture, and auto-closing then would dismiss
  // the picker before the item was ever filed.
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (remaining.length === 0 && !pendingPick && !celebratedRef.current) {
      celebratedRef.current = true;
      setDone(true);
      if (cards.length > 0) haptics.success();
      const timer = setTimeout(() => router.back(), cards.length > 0 ? 1900 : 1500);
      return () => clearTimeout(timer);
    }
  }, [remaining.length, cards.length, pendingPick]);

  const commit = (dir: 'left' | 'right') => {
    const card = topRef.current;
    if (!card) return;
    if (dir === 'left') {
      // Straight back to the list this item lives on. Only when it has no
      // usable home do we interrupt the deck to ask — and then the add (and
      // the almost-out signal) happen once a list is chosen.
      if (addToHomeList(card.display, card.category)) {
        markAlmostOut(card.key);
      } else {
        setPendingPick(card);
      }
    } else {
      markStillGood(card.key);
    }
    setHandled((prev) => {
      const n = new Set(prev);
      n.add(card.key);
      return n;
    });
  };

  const pickList = (listId: string, listName: string) => {
    const card = pendingPick;
    setPendingPick(null);
    if (!card) return;
    addToChosenList(listId, listName, card.display, card.category);
    markAlmostOut(card.key);
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY * 0.25; // rubber-band: vertical barely moves
      // Soft rapid tick as it slides.
      if (Math.abs(tx.value - lastTickX.value) > 22) {
        lastTickX.value = tx.value;
        runOnJS(haptics.tick)();
      }
      // One solid thud the moment releasing would complete the swipe.
      const beyond = Math.abs(tx.value) > THRESHOLD;
      if (beyond !== pastThreshold.value) {
        pastThreshold.value = beyond;
        if (beyond) runOnJS(haptics.snap)();
      }
    })
    .onEnd((e) => {
      const flung = Math.abs(tx.value) > THRESHOLD || Math.abs(e.velocityX) > 800;
      if (flung) {
        const dir = tx.value < 0 ? 'left' : 'right';
        ty.value = withSpring(ty.value + 40, { ...SPRING.fling, velocity: e.velocityY });
        // Carries the throw: a hard fling snaps off screen, a gentle push past
        // the threshold drifts out. Under the old fixed 240ms both left at
        // exactly the same speed, which is the single clearest tell that a
        // gesture stopped being physical the moment the finger lifted.
        //
        // Advance only once the card is fully gone and tx is reset, so the next
        // card appears centered instead of flashing in from off-screen.
        tx.value = withSpring(
          dir === 'left' ? -width * 1.5 : width * 1.5,
          { ...SPRING.fling, velocity: e.velocityX },
          (fin) => {
            if (fin) {
              tx.value = 0;
              ty.value = 0;
              runOnJS(commit)(dir);
            }
          },
        );
      } else {
        tx.value = springTo(0, e.velocityX);
        ty.value = springTo(0, e.velocityY);
      }
    });

  const topStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-10, 0, 10], Extrapolation.CLAMP)}deg` },
    ],
  }));

  const leftGlow = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-THRESHOLD, 0], [0.7, 0], Extrapolation.CLAMP),
  }));
  const rightGlow = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, THRESHOLD], [0, 0.7], Extrapolation.CLAMP),
  }));
  const leftIcon = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-THRESHOLD, -THRESHOLD * 0.2, 0], [1, 0.2, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(tx.value, [-THRESHOLD, 0], [1.2, 0.6], Extrapolation.CLAMP) }],
  }));
  const rightIcon = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, THRESHOLD * 0.2, THRESHOLD], [0, 0.2, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(tx.value, [0, THRESHOLD], [0.6, 1.2], Extrapolation.CLAMP) }],
  }));

  return (
    <View style={styles.root}>
      <MeshBackground dim />

      {/* Soft directional wash behind the card — fades to transparent, no hard edge */}
      {!done && (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, leftGlow]} pointerEvents="none">
            <LinearGradient
              colors={[colors.warn, 'transparent']}
              start={{ x: 0, y: 0.35 }}
              end={{ x: 0.95, y: 0.55 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, rightGlow]} pointerEvents="none">
            <LinearGradient
              colors={['transparent', colors.accent]}
              start={{ x: 0.05, y: 0.45 }}
              end={{ x: 1, y: 0.65 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </>
      )}

      <View style={styles.safe}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="close" size={26} color="rgba(255,255,255,0.7)" />
          </Pressable>
          <View style={styles.headerMid}>
            <Text style={[type.label, styles.headerTitle]}>{t('lists.vibeTitle')}</Text>
            {!done && remaining.length > 0 && (
              <Text style={styles.headerCount}>
                {t('vibeCheck.left', { count: remaining.length })}
              </Text>
            )}
          </View>
          <View style={{ width: 26 }} />
        </View>

        {done ? (
          <Celebration empty={cards.length === 0} />
        ) : (
          <>
            {/* Card stack */}
            <View style={styles.deck}>
              {/* Reveal icons sit behind the card */}
              <Animated.View style={[styles.revealIcon, leftIcon]} pointerEvents="none">
                <Ionicons name="cart" size={64} color={colors.warn} />
                {/* Same wording as the Pantry tab's left swipe — one action,
                    two surfaces, so it reads as the same thing. */}
                <Text style={[styles.revealLabel, { color: colors.warn }]}>
                  {t('pantry.addToList')}
                </Text>
              </Animated.View>
              <Animated.View style={[styles.revealIcon, rightIcon]} pointerEvents="none">
                <Ionicons name="checkmark-circle" size={64} color={colors.accent} />
                <Text style={[styles.revealLabel, { color: colors.accent }]}>
                  {t('pantry.stillGood')}
                </Text>
              </Animated.View>

              {/* Back cards for depth */}
              {remaining[2] && <BackCard depth={2} />}
              {remaining[1] && <BackCard depth={1} />}

              {/* Top, draggable card */}
              {top && (
                <GestureDetector gesture={pan}>
                  <Animated.View style={[styles.cardWrap, topStyle]} key={top.key}>
                    <VibeCard card={top} />
                  </Animated.View>
                </GestureDetector>
              )}
            </View>

            {/* Swipe hint + progress */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
              <Text style={styles.hint}>{t('vibeCheck.swipeHint')}</Text>
              <Text style={styles.remaining}>
                {t('vibeCheck.toReview', { count: remaining.length })}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Only shown for an item with no usable home list — everything else is
          filed silently, confirmed by a toast. */}
      <ListPickerSheet
        visible={pendingPick != null}
        title={pendingPick ? t('pantry.addTo', { item: pendingPick.display }) : t('pantry.addToList')}
        onCancel={() => setPendingPick(null)}
        onPick={pickList}
      />
    </View>
  );
}

/** The star: a big glass card with the item name and a muted subtitle. */
function VibeCard({ card }: { card: DeckCard }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <GlassView radius={24} style={styles.card}>
      {/* Staples say so, so it's clear why this one is at the front of the deck.
          Word plus icon, never the icon alone. */}
      {card.keepStocked && (
        <View style={styles.stapleTag}>
          <Ionicons name="bookmark" size={12} color={colors.accent} />
          <Text style={[type.sub, { color: colors.accent }]}>{t('staple.badge')}</Text>
        </View>
      )}
      {/* Big and above the name, not inline: this card is the whole screen, and
          the picture is what you read from across the kitchen. */}
      <Text style={styles.cardEmoji} accessibilityElementsHidden importantForAccessibility="no">
        {emojiFor(card.display, card.category)}
      </Text>
      <Text style={[styles.itemName, { color: colors.ink }]} numberOfLines={3} adjustsFontSizeToFit>
        {card.display}
      </Text>
      <Text style={[styles.itemSub, { color: colors.muted }]}>
        {lastBoughtLabel(card.lastPurchasedAt, Date.now(), t)}
      </Text>
    </GlassView>
  );
}

/** Static card peeking from behind the top one, for depth. */
function BackCard({ depth }: { depth: number }) {
  return (
    <View
      style={[
        styles.cardWrap,
        styles.backCard,
        { transform: [{ translateY: depth * 14 }, { scale: 1 - depth * 0.05 }], opacity: 1 - depth * 0.35 },
      ]}
      pointerEvents="none"
    >
      <GlassView radius={24} style={styles.card}>
        <View />
      </GlassView>
    </View>
  );
}

/** "All Set." glow + a light particle burst when the deck is cleared. */
function Celebration({ empty }: { empty: boolean }) {
  const t = useT();
  const glow = useSharedValue(0);
  useEffect(() => {
    glow.value = withTiming(1, { duration: GLOW_MS });
  }, [glow]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.6, 1.15], Extrapolation.CLAMP) }],
  }));

  return (
    <View style={styles.celebrate}>
      {/* Soft radial bloom: concentric translucent rings, brightest at the
          centre, fully contained so nothing clips the screen edges. */}
      <Animated.View style={[styles.bloomWrap, glowStyle]} pointerEvents="none">
        <View style={[styles.ring, { width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(95,184,120,0.10)' }]}>
          <View style={[styles.ring, { width: 210, height: 210, borderRadius: 105, backgroundColor: 'rgba(95,184,120,0.14)' }]}>
            <View style={[styles.ring, { width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(95,184,120,0.22)' }]} />
          </View>
        </View>
      </Animated.View>
      {!empty && <Confetti />}
      <Text style={[styles.allSet, { color: '#FFFFFF' }]}>
        {empty ? t('vibeCheck.emptyTitle') : t('vibeCheck.allSet')}
      </Text>
      <Text style={styles.allSetSub}>
        {empty ? t('vibeCheck.emptySub') : t('vibeCheck.allSetSub')}
      </Text>
    </View>
  );
}

const CONFETTI = Array.from({ length: 18 });

function Confetti() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {CONFETTI.map((_, i) => (
        <Particle key={i} index={i} />
      ))}
    </View>
  );
}

const PARTICLE_COLORS = ['#5FB878', '#8CC63F', '#D9A83F', '#FFFFFF'];

function Particle({ index }: { index: number }) {
  const { width, height } = useWindowDimensions();
  const p = useSharedValue(0);
  const angle = (index / 18) * Math.PI * 2;
  const dist = 120 + (index % 5) * 34;
  const dx = Math.cos(angle) * dist;
  const dy = Math.sin(angle) * dist - 40;

  useEffect(() => {
    p.value = withTiming(1, { duration: FILL_MS });
  }, [p]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.15, 1], [0, 1, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: dx * p.value },
      { translateY: dy * p.value + 60 * p.value * p.value },
      { scale: interpolate(p.value, [0, 1], [1, 0.4], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: width / 2 - 4,
          top: height / 2 - 40,
          backgroundColor: PARTICLE_COLORS[index % PARTICLE_COLORS.length],
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  headerMid: { alignItems: 'center', gap: 2 },
  headerTitle: { color: 'rgba(255,255,255,0.9)' },
  headerCount: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },

  deck: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardWrap: {
    position: 'absolute',
    width: '82%',
    aspectRatio: 0.72,
    maxHeight: '78%',
  },
  backCard: {},
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  cardEmoji: { fontSize: 64, textAlign: 'center', lineHeight: 74 },
  itemName: { fontSize: 46, fontWeight: '800', letterSpacing: -1.4, textAlign: 'center' },
  itemSub: { fontSize: 14, fontWeight: '500', textAlign: 'center' },
  stapleTag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },

  revealIcon: { position: 'absolute', alignItems: 'center', gap: spacing.xs },
  revealLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },

  footer: { paddingHorizontal: spacing.lg, alignItems: 'center', gap: spacing.sm },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: '600' },
  remaining: { color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: '600' },

  celebrate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  bloomWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ring: { alignItems: 'center', justifyContent: 'center' },
  allSet: { fontSize: 44, fontWeight: '800', letterSpacing: -1.6 },
  allSetSub: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '500' },
  particle: { position: 'absolute', width: 8, height: 8, borderRadius: 2 },

});

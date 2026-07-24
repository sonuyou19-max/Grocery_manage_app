import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { MeshBackground } from '@/components/mesh-background';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { haptics } from '@/lib/haptics';
import { isDue, lastBoughtLabel, normalizeKey } from '@/lib/pantry-intel';
import { useT } from '@/store/locale';
import { useGroceries } from '@/store/groceries';
import { useVibeDeck, usePantryIntel, type DeckCard } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * Pantry Vibe Check — a 10-second swipe ritual over the items the app thinks
 * are running low. Left = "Almost Out" (adds it to a list), right = "Still Good"
 * (teaches the model to wait longer). Weighty physics, soft haptics, then a glow
 * and "All Set." on the last card.
 */
export default function VibeCheckScreen() {
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { deck } = useVibeDeck();
  const { stats, markAlmostOut, markStillGood } = usePantryIntel();
  const { lists, addList, addParsedItem } = useGroceries();

  // Frozen ORDER captured when the deck opens; membership stays live below so a
  // card another household member resolves drops off this device's stack too.
  const [cards] = useState<DeckCard[]>(deck);
  // Keys the user has personally swiped this session.
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [done, setDone] = useState(false);

  // Items still due right now, minus anything already queued on a list —
  // recomputed from shared stats, so another member's swipe removes it here.
  const validKeys = useMemo(() => {
    const excluded = new Set<string>();
    for (const list of lists) for (const it of list.items) excluded.add(normalizeKey(it.name));
    const now = Date.now();
    const s = new Set<string>();
    for (const key in stats) if (isDue(stats[key], now) && !excluded.has(key)) s.add(key);
    return s;
  }, [stats, lists]);

  // Every item currently on any list, so we never queue a duplicate.
  const listedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const list of lists) for (const it of list.items) s.add(normalizeKey(it.name));
    return s;
  }, [lists]);

  // The live stack: frozen order, minus what anyone has resolved.
  const remaining = useMemo(
    () => cards.filter((c) => validKeys.has(c.key) && !handled.has(c.key)),
    [cards, validKeys, handled],
  );
  const top = remaining[0];

  // Where "Almost Out" items go — defaults to the first (top) list.
  const [destListId, setDestListId] = useState<string | null>(lists[0]?.id ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatingList, setCreatingList] = useState(false);
  const destList = lists.find((l) => l.id === destListId) ?? lists[0];

  const THRESHOLD = width * 0.28;
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lastTickX = useSharedValue(0);
  const pastThreshold = useSharedValue(false);

  // Latest values reachable from gesture callbacks.
  const topRef = useRef<DeckCard | undefined>(top);
  topRef.current = top;
  const destRef = useRef<string | null>(destListId);
  destRef.current = destList?.id ?? null;
  const listedRef = useRef(listedKeys);
  listedRef.current = listedKeys;

  // Reset the drag whenever the visible top card changes.
  useEffect(() => {
    tx.value = 0;
    ty.value = 0;
    lastTickX.value = 0;
    pastThreshold.value = false;
  }, [top?.key, tx, ty, lastTickX, pastThreshold]);

  // When the stack empties, celebrate once and bow out.
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (remaining.length === 0 && !celebratedRef.current) {
      celebratedRef.current = true;
      setDone(true);
      if (cards.length > 0) haptics.success();
      const timer = setTimeout(() => router.back(), cards.length > 0 ? 1900 : 1500);
      return () => clearTimeout(timer);
    }
  }, [remaining.length, cards.length]);

  const addToList = (card: DeckCard) => {
    // Never queue a duplicate: if it's already on any list, don't write it.
    if (listedRef.current.has(card.key)) return;
    let listId = destRef.current;
    if (!listId) {
      listId = addList(t('vibeCheck.defaultListName'));
      setDestListId(listId);
    }
    addParsedItem(listId, { name: card.display, category: card.category, quantity: null, unit: null });
  };

  const commit = (dir: 'left' | 'right') => {
    const card = topRef.current;
    if (!card) return;
    if (dir === 'left') {
      addToList(card); // self-guards against duplicates across all lists
      markAlmostOut(card.key);
    } else {
      markStillGood(card.key);
    }
    setHandled((prev) => {
      const n = new Set(prev);
      n.add(card.key);
      return n;
    });
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
        ty.value = withTiming(ty.value + 40, { duration: 240 });
        // Advance only once the card is fully gone and tx is reset, so the next
        // card appears centered instead of flashing in from off-screen.
        tx.value = withTiming(dir === 'left' ? -width * 1.5 : width * 1.5, { duration: 240 }, (fin) => {
          if (fin) {
            tx.value = 0;
            ty.value = 0;
            runOnJS(commit)(dir);
          }
        });
      } else {
        tx.value = withSpring(0, { damping: 18, stiffness: 160 });
        ty.value = withSpring(0, { damping: 18, stiffness: 160 });
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
                <Text style={[styles.revealLabel, { color: colors.warn }]}>
                  {t('vibeCheck.almostOut')}
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

            {/* Destination + hint */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
              <Pressable onPress={() => setPickerOpen(true)} style={styles.destPill}>
                <Ionicons name="cart-outline" size={16} color="rgba(255,255,255,0.85)" />
                <Text style={styles.destText} numberOfLines={1}>
                  {t('vibeCheck.addingTo', {
                    list: destList ? destList.name : t('vibeCheck.aNewList'),
                  })}
                </Text>
                <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.6)" />
              </Pressable>
              <Text style={styles.hint}>{t('vibeCheck.swipeHint')}</Text>
              <Text style={styles.remaining}>
                {t('vibeCheck.toReview', { count: remaining.length })}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Destination picker */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
          <GlassView radius={radii.lg} style={styles.pickerCard}>
            <Text style={[type.h2, { color: colors.ink }]}>{t('vibeCheck.addLowTo')}</Text>
            <Pressable
              style={styles.pickerRow}
              onPress={() => {
                setPickerOpen(false);
                setCreatingList(true);
              }}
            >
              <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
              <Text style={[type.body, { color: colors.accent, flex: 1 }]}>
                {t('lists.newListInline')}
              </Text>
            </Pressable>
            {lists.map((l) => {
              const active = l.id === destList?.id;
              return (
                <Pressable
                  key={l.id}
                  style={styles.pickerRow}
                  onPress={() => {
                    setDestListId(l.id);
                    setPickerOpen(false);
                  }}
                >
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={active ? colors.accent : colors.muted}
                  />
                  <Text style={[type.body, { color: colors.ink, flex: 1 }]} numberOfLines={1}>
                    {l.name}
                  </Text>
                </Pressable>
              );
            })}
          </GlassView>
        </Pressable>
      </Modal>

      <TextPromptModal
        visible={creatingList}
        title={t('lists.newList')}
        placeholder={t('vibeCheck.newListPlaceholder')}
        confirmLabel={t('lists.create')}
        onCancel={() => setCreatingList(false)}
        onSubmit={(name) => {
          const id = addList(name);
          setDestListId(id);
          setCreatingList(false);
        }}
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
    glow.value = withTiming(1, { duration: 700 });
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
    p.value = withTiming(1, { duration: 1100 });
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
  itemName: { fontSize: 46, fontWeight: '800', letterSpacing: -1.4, textAlign: 'center' },
  itemSub: { fontSize: 14, fontWeight: '500', textAlign: 'center' },

  revealIcon: { position: 'absolute', alignItems: 'center', gap: spacing.xs },
  revealLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },

  footer: { paddingHorizontal: spacing.lg, alignItems: 'center', gap: spacing.sm },
  destPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    maxWidth: '90%',
  },
  destText: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: '600' },
  remaining: { color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: '600' },

  celebrate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  bloomWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ring: { alignItems: 'center', justifyContent: 'center' },
  allSet: { fontSize: 44, fontWeight: '800', letterSpacing: -1.6 },
  allSetSub: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '500' },
  particle: { position: 'absolute', width: 8, height: 8, borderRadius: 2 },

  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3,5,3,0.6)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  pickerCard: { padding: spacing.lg, gap: spacing.xs },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
});

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassView } from '@/components/glass';
import { MeshBackground } from '@/components/mesh-background';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { haptics } from '@/lib/haptics';
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
  const { width } = useWindowDimensions();
  const { deck } = useVibeDeck();
  const { markAlmostOut, markStillGood } = usePantryIntel();
  const { lists, addList, addParsedItem } = useGroceries();

  // Freeze the deck for this session so mutating stats mid-run doesn't reshuffle.
  const [cards] = useState<DeckCard[]>(deck);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(cards.length === 0);

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

  // Keep the latest card/destination reachable from gesture callbacks.
  const topRef = useRef<DeckCard | undefined>(cards[0]);
  topRef.current = cards[index];
  const destRef = useRef<string | null>(destListId);
  destRef.current = destList?.id ?? null;

  useEffect(() => {
    tx.value = 0;
    ty.value = 0;
    lastTickX.value = 0;
    pastThreshold.value = false;
  }, [index, tx, ty, lastTickX, pastThreshold]);

  // Opened with an empty deck — show the reassurance, then bow out.
  useEffect(() => {
    if (cards.length === 0) {
      const t = setTimeout(() => router.back(), 1600);
      return () => clearTimeout(t);
    }
  }, [cards.length]);

  const addToList = (card: DeckCard) => {
    let listId = destRef.current;
    if (!listId) {
      listId = addList('Shopping list');
      setDestListId(listId);
    }
    addParsedItem(listId, { name: card.display, category: card.category, quantity: null, unit: null });
  };

  const commit = (dir: 'left' | 'right') => {
    const card = topRef.current;
    if (card) {
      if (dir === 'left') {
        markAlmostOut(card.key);
        addToList(card);
      } else {
        markStillGood(card.key);
      }
    }
    const next = index + 1;
    if (next >= cards.length) {
      haptics.success();
      setDone(true);
      setTimeout(() => router.back(), 1900);
    } else {
      setIndex(next);
    }
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
    opacity: interpolate(tx.value, [-THRESHOLD, 0], [0.9, 0], Extrapolation.CLAMP),
  }));
  const rightGlow = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, THRESHOLD], [0, 0.9], Extrapolation.CLAMP),
  }));
  const leftIcon = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-THRESHOLD, -THRESHOLD * 0.2, 0], [1, 0.2, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(tx.value, [-THRESHOLD, 0], [1.2, 0.6], Extrapolation.CLAMP) }],
  }));
  const rightIcon = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, THRESHOLD * 0.2, THRESHOLD], [0, 0.2, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(tx.value, [0, THRESHOLD], [0.6, 1.2], Extrapolation.CLAMP) }],
  }));

  const remaining = cards.length - index;

  return (
    <View style={styles.root}>
      <MeshBackground dim />

      {/* Soft directional glow behind the card */}
      {!done && (
        <>
          <Animated.View style={[styles.glow, styles.glowLeft, { backgroundColor: colors.warn }, leftGlow]} />
          <Animated.View style={[styles.glow, styles.glowRight, { backgroundColor: colors.accent }, rightGlow]} />
        </>
      )}

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="close" size={26} color="rgba(255,255,255,0.7)" />
          </Pressable>
          <View style={styles.headerMid}>
            <Text style={[type.label, styles.headerTitle]}>Pantry Vibe Check</Text>
            {!done && cards.length > 0 && (
              <Text style={styles.headerCount}>
                {index + 1} of {cards.length}
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
                <Text style={[styles.revealLabel, { color: colors.warn }]}>Almost out</Text>
              </Animated.View>
              <Animated.View style={[styles.revealIcon, rightIcon]} pointerEvents="none">
                <Ionicons name="checkmark-circle" size={64} color={colors.accent} />
                <Text style={[styles.revealLabel, { color: colors.accent }]}>Still good</Text>
              </Animated.View>

              {/* Back cards for depth */}
              {cards[index + 2] && <BackCard depth={2} />}
              {cards[index + 1] && <BackCard depth={1} />}

              {/* Top, draggable card */}
              {cards[index] && (
                <GestureDetector gesture={pan}>
                  <Animated.View style={[styles.cardWrap, topStyle]} key={cards[index].key}>
                    <VibeCard card={cards[index]} />
                  </Animated.View>
                </GestureDetector>
              )}
            </View>

            {/* Destination + hint */}
            <View style={styles.footer}>
              <Pressable onPress={() => setPickerOpen(true)} style={styles.destPill}>
                <Ionicons name="cart-outline" size={16} color="rgba(255,255,255,0.85)" />
                <Text style={styles.destText} numberOfLines={1}>
                  Adding to {destList ? destList.name : 'a new list'}
                </Text>
                <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.6)" />
              </Pressable>
              <Text style={styles.hint}>
                ← Almost out{'      '}Still good →
              </Text>
              <Text style={styles.remaining}>{remaining} to review</Text>
            </View>
          </>
        )}
      </SafeAreaView>

      {/* Destination picker */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
          <GlassView radius={radii.lg} style={styles.pickerCard}>
            <Text style={[type.h2, { color: colors.ink }]}>Add low items to</Text>
            <Pressable
              style={styles.pickerRow}
              onPress={() => {
                setPickerOpen(false);
                setCreatingList(true);
              }}
            >
              <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
              <Text style={[type.body, { color: colors.accent, flex: 1 }]}>New list…</Text>
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
        title="New list"
        placeholder="e.g. Restock run"
        confirmLabel="Create"
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
  return (
    <GlassView radius={24} style={styles.card}>
      <Text style={[styles.itemName, { color: colors.ink }]} numberOfLines={3} adjustsFontSizeToFit>
        {card.display}
      </Text>
      <Text style={[styles.itemSub, { color: colors.muted }]}>{card.subtitle}</Text>
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
  const { colors } = useTheme();
  const glow = useSharedValue(0);
  useEffect(() => {
    glow.value = withTiming(1, { duration: 700 });
  }, [glow]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0, 1], [0, 0.55], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.6, 1.4], Extrapolation.CLAMP) }],
  }));

  return (
    <View style={styles.celebrate}>
      <Animated.View style={[styles.celebrateGlow, { backgroundColor: colors.accent }, glowStyle]} />
      {!empty && <Confetti />}
      <Text style={[styles.allSet, { color: '#FFFFFF' }]}>{empty ? 'Nothing to review' : 'All Set.'}</Text>
      <Text style={styles.allSetSub}>
        {empty ? 'Your pantry looks stocked.' : 'Nice — that took ten seconds.'}
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

  glow: { position: 'absolute', width: 460, height: 460, borderRadius: 230, top: '22%' },
  glowLeft: { left: -200 },
  glowRight: { right: -200 },
  revealIcon: { position: 'absolute', alignItems: 'center', gap: spacing.xs },
  revealLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },

  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, alignItems: 'center', gap: spacing.sm },
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
  celebrateGlow: { position: 'absolute', width: 320, height: 320, borderRadius: 160 },
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

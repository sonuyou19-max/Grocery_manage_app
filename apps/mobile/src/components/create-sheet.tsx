import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { GlassView } from '@/components/glass';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { haptics } from '@/lib/haptics';
import { usePlusGate } from '@/lib/plus-gate';
import { useGroceries } from '@/store/groceries';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * "Create something new" — what the centre button opens.
 *
 * ---------------------------------------------------------------------------
 * Two options, and only one of them costs money
 * ---------------------------------------------------------------------------
 *
 * A blank list is free and always will be; importing a recipe is Plus. Both
 * live behind one button, which means the sheet has to make the difference
 * obvious BEFORE the tap rather than after it — a free user who taps "Import
 * recipe" and lands on a paywall they did not expect has been sold to, not
 * offered something. So the Plus row carries the badge, in the gradient the
 * subscription owns everywhere else in the app, and the free row deliberately
 * carries nothing at all.
 *
 * The paywall is still where a free tap goes. That is the specified behaviour
 * and it is the right one: the alternative — hiding the row entirely — means
 * nobody ever discovers the feature exists.
 *
 * ---------------------------------------------------------------------------
 * It grows out of the button
 * ---------------------------------------------------------------------------
 *
 * The transform origin is the bottom centre of the card, which is where the
 * create button sits — the button is horizontally centred in the bar, and the
 * card's bottom margin is what separates them. Scaling from there means the
 * sheet unfolds out of the thing that was pressed and folds back into it,
 * rather than arriving from off-screen with no stated relationship to it.
 *
 * Anchoring to the button's MEASURED position was the other option and it is
 * not worth it: the two are already aligned on the only axis where a mismatch
 * would be visible, and measuring would couple this component to the tab bar's
 * layout for a correction nobody can see.
 */

/** Long enough to read as a movement, short enough not to sit in the way. */
const OPEN_MS = 220;
const CLOSE_MS = 160;

export function CreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const t = useT();
  const { addList } = useGroceries();
  const { locked, requirePlus } = usePlusGate();
  const [naming, setNaming] = useState(false);
  /*
   * The Modal has to outlive `visible` so the closing animation has something
   * to play on — RN would otherwise tear the window down on the same frame the
   * prop flips and the fold-away would never be seen. `mounted` is therefore
   * driven up by the prop and down by the animation's own completion.
   */
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
    } else {
      progress.value = withTiming(
        0,
        { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
        (done) => {
          if (done) runOnJS(setMounted)(false);
        },
      );
    }
  }, [visible, progress]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    // 0.82, not 0: shrinking to nothing reads as a card being destroyed. A
    // shallow scale reads as one folding away, which is the thing being said.
    transform: [{ scale: 0.82 + progress.value * 0.18 }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const openNewList = (name: string) => {
    const id = addList(name);
    setNaming(false);
    onClose();
    router.push({ pathname: '/list/[id]', params: { id } });
  };

  const onRecipe = () => {
    onClose();
    // The gate decides, not this component. `locked` is false for a trial user
    // and for everyone while the tier is switched off, so this row simply works
    // until billing goes live — see lib/plus-gate.ts.
    if (locked) requirePlus();
    else router.push('/recipe');
  };

  return (
    <>
      <Modal
        visible={mounted && !naming}
        transparent
        // "none": the scale/fade below IS the transition. RN's own fade would
        // run underneath it and the two would fight.
        animationType="none"
        onRequestClose={onClose}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, backdropStyle]} />
        <Pressable style={styles.backdrop} onPress={onClose}>
          {/* Stops a tap on the sheet itself from closing it. */}
          <Pressable onPress={() => {}}>
            <Animated.View style={[styles.origin, cardStyle]}>
            <GlassView radius={radii.lg} style={styles.card}>
              <Text style={[type.h2, { color: colors.ink }]}>{t('create.title')}</Text>

              <Pressable
                style={[styles.row, { borderColor: colors.line }]}
                onPress={() => {
                  haptics.tick();
                  setNaming(true);
                }}
              >
                <View style={[styles.iconBox, { backgroundColor: colors.accentSoft }]}>
                  <Ionicons name="list-outline" size={22} color={colors.accent} />
                </View>
                <View style={styles.grow}>
                  <Text style={[type.body, { color: colors.ink }]}>{t('create.blankTitle')}</Text>
                  <Text style={[type.sub, { color: colors.muted }]}>{t('create.blankBody')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>

              <Pressable
                style={[styles.row, { borderColor: colors.line }]}
                onPress={() => {
                  haptics.tick();
                  onRecipe();
                }}
              >
                <View style={[styles.iconBox, { backgroundColor: colors.plusSoft }]}>
                  <Ionicons name="sparkles" size={20} color={colors.plusInk} />
                </View>
                <View style={styles.grow}>
                  <View style={styles.titleRow}>
                    <Text style={[type.body, { color: colors.ink }]}>{t('create.recipeTitle')}</Text>
                    <LinearGradient
                      colors={[colors.plusFrom, colors.plusTo]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.badge}
                    >
                      <Text style={[type.label, styles.badgeText]}>{t('plus.badge')}</Text>
                    </LinearGradient>
                  </View>
                  <Text style={[type.sub, { color: colors.muted }]}>{t('create.recipeBody')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            </GlassView>
            </Animated.View>
          </Pressable>
        </Pressable>
      </Modal>

      <TextPromptModal
        visible={naming}
        title={t('lists.newList')}
        placeholder={t('lists.newListPlaceholder')}
        confirmLabel={t('lists.create')}
        onCancel={() => {
          setNaming(false);
          onClose();
        }}
        onSubmit={openNewList}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // The dim is its own layer so it can fade with the card instead of snapping
  // on and off with the Modal window.
  dim: { backgroundColor: 'rgba(12,18,10,0.45)' },
  backdrop: { flex: 1, justifyContent: 'flex-end', padding: spacing.lg },
  // Bottom centre: where the create button is. Everything scales out of and
  // back into that point.
  origin: { transformOrigin: 'center bottom' },
  card: { padding: spacing.lg, gap: spacing.md, marginBottom: spacing.xxl },
  grow: { flex: 1, minWidth: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  badgeText: { color: '#FFFFFF' },
});

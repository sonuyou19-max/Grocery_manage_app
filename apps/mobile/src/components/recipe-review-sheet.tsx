import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { GlassView } from '@/components/glass';
import { ItemEmoji } from '@/components/item-emoji';
import { haptics } from '@/lib/haptics';
import { useDeferUntilClosed } from '@/lib/modal-nav';
import {
  checkedCount,
  cleanRecipeName,
  inPantryCount,
  reviewRows,
  scaleQuantity,
  type ParsedRecipe,
  type ReviewRow,
} from '@/lib/recipe';
import { categorizeSync } from '@/lib/categorize';
import { useT } from '@/store/locale';
import { usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * What Korb found, before anything is written.
 *
 * Nothing here touches a list until the button at the bottom is pressed. A
 * parser reading somebody else's web page will occasionally return nonsense,
 * and the cost of that landing straight in a shopping list — silently, ten
 * wrong rows to delete by hand — is the difference between a feature people
 * trust and one they try once.
 *
 * ---------------------------------------------------------------------------
 * It owns its own exit — and the moment it is truly gone
 * ---------------------------------------------------------------------------
 *
 * This used to be a plain `<Modal visible={recipe != null} animationType=
 * "slide">`, and the parent found out it had closed by watching `recipe`
 * flip to null — which happens on the SAME frame the parent asks it to close,
 * not the frame the native window actually finishes animating away on. Three
 * times running, that gap is where a navigation landed while the native
 * window was still on top of the screen it was navigating to: the blank
 * white cover in the bug reports, gone the instant you tap Back because the
 * screen underneath was correct the whole time.
 *
 * So the Modal's own `visible` is now `mounted`, a LOCAL state this component
 * drives itself: it flips true the instant `recipe` arrives, and false only
 * once a JS-timed fade has actually finished playing — the same pattern
 * create-sheet.tsx uses for the same reason. `onDismissed` fires one frame
 * after that, via `useDeferUntilClosed` (see lib/modal-nav.ts), which is the
 * extra beat native needs to tear the window down. A caller that navigates
 * from `onDismissed` — recipe.tsx does — is navigating into a screen that has
 * genuinely already replaced this one, not one still fading out on top of it.
 */
export function RecipeReviewSheet({
  recipe,
  mode,
  onClose,
  onConfirm,
  onDismissed,
}: {
  recipe: ParsedRecipe | null;
  /** `create` names a new list; `append` adds to the one already open. */
  mode: 'create' | 'append';
  onClose: () => void;
  onConfirm: (name: string, rows: ReviewRow[]) => void;
  /**
   * Fires once this sheet has ACTUALLY closed — its own exit animation done,
   * one more frame for the native window. Fires for every close, cancel or
   * confirm alike; the caller decides whether that means "go somewhere" or
   * "nothing to do", exactly like `onConfirm` already decides what to write.
   */
  onDismissed?: () => void;
}) {
  const { colors } = useTheme();
  const t = useT();
  const { stats } = usePantryIntel();

  const [name, setName] = useState('');
  const [servings, setServings] = useState<number | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);

  /** Long enough to read as a movement, short enough not to sit in the way. */
  const OPEN_MS = 220;
  const CLOSE_MS = 160;
  const open = recipe != null;
  const [mounted, setMounted] = useState(open);
  const progress = useSharedValue(open ? 1 : 0);
  const whenReallyClosed = useDeferUntilClosed(mounted);
  // The prop, not captured directly in the effect below: `onDismissed` is a
  // fresh arrow function on the parent's every render, and putting it in that
  // effect's deps would re-arm the queued action on every one of them while
  // the sheet sits open. A ref always holds the latest without doing that.
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
      // Armed on every open, not once: `whenClosed` only remembers the LATEST
      // action, and each open needs its own turn to report back when it ends.
      whenReallyClosed(() => onDismissedRef.current?.());
    } else {
      progress.value = withTiming(
        0,
        { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
        (done) => {
          if (done) runOnJS(setMounted)(false);
        },
      );
    }
  }, [open, progress, whenReallyClosed]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 32 }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  // Re-seed whenever a new recipe arrives. Keyed on the object identity rather
  // than its contents: a second import of the same URL is still a fresh start.
  useEffect(() => {
    if (!recipe) return;
    setName(cleanRecipeName(recipe.name) || t('recipe.untitled'));
    setServings(recipe.servings);
    setRows(reviewRows(recipe.items, stats, Date.now()));
  }, [recipe]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * How much the quantities are multiplied by.
   *
   * Both halves come from the same import, so this is 1 until the user touches
   * the stepper — and when the source never stated a serving count there is no
   * baseline, no stepper, and no scaling at all. A scaler with an invented
   * baseline silently rewrites every quantity against a number nobody supplied.
   */
  const original = recipe?.servings ?? null;
  const factor = original && servings ? servings / original : 1;

  const adding = useMemo(() => checkedCount(rows), [rows]);
  const known = useMemo(() => inPantryCount(rows), [rows]);

  /**
   * How far up the stepper goes.
   *
   * A flat 50 was wrong for a recipe that already states more than that: the
   * server accepts any stated count up to 100, so a 60-serving recipe arrived
   * with 60 as its baseline and a + button that did nothing, because it was
   * already over the ceiling. It could only be scaled down.
   *
   * Doubling, floored at 50, means the answer is always "at least twice what
   * the recipe makes, and never less than 50" — which is the same promise for
   * a four-serving dinner as for a sixty-serving batch. The bound exists to
   * stop absurd input, not to be exact.
   */
  const maxServings = Math.max(50, (original ?? 0) * 2);

  const step = (delta: number) => {
    if (servings == null) return;
    const next = Math.min(maxServings, Math.max(1, servings + delta));
    if (next === servings) return;
    haptics.tick();
    setServings(next);
  };

  const toggle = (key: string) => {
    haptics.tick();
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, checked: !r.checked } : r)));
  };

  const confirm = () => {
    haptics.success();
    // Quantities are scaled at the moment of adding, not as the stepper moves,
    // so the rows keep the source's numbers and one rounding is applied once.
    onConfirm(
      name.trim() || t('recipe.untitled'),
      rows
        .filter((r) => r.checked)
        .map((r) => ({
          ...r,
          quantity: r.quantity == null ? null : scaleQuantity(r.quantity, r.unit, factor),
        })),
    );
  };

  return (
    <Modal
      visible={mounted}
      transparent
      // "none": the fade/slide below IS the transition, JS-driven so we know
      // exactly when it finishes. RN's own "slide" would run underneath it,
      // the two would fight, and we'd be back to not knowing when it's done.
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, backdropStyle]} />
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View style={sheetStyle}>
          <GlassView over="content" radius={radii.lg} style={styles.card}>
            <View style={styles.grabber} />

            {mode === 'create' ? (
              /* Editable, because scrapers return "Best Ever Curry Recipe |
                 Foodie Blog" and nobody should be stuck with that as a list
                 name. cleanRecipeName has already had a go at it. */
              <TextInput
                value={name}
                onChangeText={setName}
                style={[type.h2, styles.name, { color: colors.ink, borderColor: colors.line }]}
                placeholder={t('recipe.untitled')}
                placeholderTextColor={colors.muted}
              />
            ) : (
              <Text style={[type.h2, { color: colors.ink }]}>{t('recipe.addToList')}</Text>
            )}

            {original != null && servings != null && (
              <View style={styles.scaler}>
                <Stepper icon="remove" onPress={() => step(-1)} colors={colors} />
                <View style={styles.scalerMid}>
                  <Text style={[type.body, { color: colors.ink }]}>
                    {t('recipe.servings', { count: servings })}
                  </Text>
                  {servings !== original && (
                    /* Says WHY the numbers moved. Without it a doubled recipe
                       looks like the parser got the quantities wrong. */
                    <Text style={[type.sub, { color: colors.muted }]}>
                      {t('recipe.scaledFrom', { count: original })}
                    </Text>
                  )}
                </View>
                <Stepper icon="add" onPress={() => step(1)} colors={colors} />
              </View>
            )}

            {known > 0 && (
              <Text style={[type.sub, { color: colors.muted }]}>
                {t('recipe.alreadyHave', { count: known, total: rows.length })}
              </Text>
            )}

            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              {rows.map((r) => (
                <Pressable key={r.key} style={styles.row} onPress={() => toggle(r.key)}>
                  <View
                    style={[
                      styles.box,
                      {
                        borderColor: r.checked ? colors.accent : colors.line,
                        backgroundColor: r.checked ? colors.accent : 'transparent',
                      },
                    ]}
                  >
                    {r.checked && <Ionicons name="checkmark" size={14} color={colors.accentInk} />}
                  </View>
                  <ItemEmoji name={r.name} category={categorizeSync(r.name)} />
                  <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                    {r.name}
                  </Text>
                  {r.quantity != null && (
                    <Text style={[type.sub, { color: colors.muted }]}>
                      {formatQty(scaleQuantity(r.quantity, r.unit, factor))}
                      {r.unit ? ` ${r.unit}` : ''}
                    </Text>
                  )}
                  {r.state !== 'missing' && (
                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: r.state === 'low' ? colors.warnSoft : colors.accentSoft },
                      ]}
                    >
                      <Text
                        style={[
                          type.label,
                          styles.badgeText,
                          { color: r.state === 'low' ? colors.warn : colors.accent },
                        ]}
                      >
                        {t(r.state === 'low' ? 'recipe.runningLow' : 'recipe.inPantry')}
                      </Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              onPress={confirm}
              disabled={adding === 0}
              style={[styles.cta, { backgroundColor: colors.accent, opacity: adding === 0 ? 0.5 : 1 }]}
            >
              <Text style={[type.body, { color: colors.accentInk }]}>
                {adding === 0 ? t('recipe.nothingChosen') : t('recipe.addCount', { count: adding })}
              </Text>
            </Pressable>
          </GlassView>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 0.75 rather than 0.75000000001, and 200 rather than 200.0. */
const formatQty = (n: number): string => String(Math.round(n * 100) / 100);

function Stepper({
  icon,
  onPress,
  colors,
}: {
  icon: 'add' | 'remove';
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[styles.step, { borderColor: colors.line }]}>
      <Ionicons name={icon} size={18} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Its own layer so it can fade with the card instead of snapping on and off
  // with the Modal window.
  dim: { backgroundColor: 'rgba(12,18,10,0.45)' },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  card: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.4)',
  },
  name: { borderBottomWidth: 1, paddingBottom: spacing.xs },
  scaler: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  scalerMid: { flex: 1, alignItems: 'center' },
  step: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { maxHeight: 320 },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  badgeText: { fontSize: 9, letterSpacing: 0.6 },
  cta: { paddingVertical: spacing.md, borderRadius: radii.pill, alignItems: 'center' },
});

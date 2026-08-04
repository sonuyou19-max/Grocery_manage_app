import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeshBackground } from '@/components/mesh-background';
import { RecipeReviewSheet } from '@/components/recipe-review-sheet';
import { useToast } from '@/components/toast';
import { categorizeSync } from '@/lib/categorize';
import { haptics } from '@/lib/haptics';
import { importRecipe, type ImportOutcome } from '@/lib/recipe-import';
import { usePlusGate } from '@/lib/plus-gate';
import { looksLikeUrl, type ParsedRecipe, type ReviewRow } from '@/lib/recipe';
import { useGroceries } from '@/store/groceries';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

type Phase = 'idle' | 'fetching' | 'reading';

/**
 * Import a recipe: one field, one button, and a great deal of care about what
 * happens when it does not work.
 *
 * ---------------------------------------------------------------------------
 * A route, not a modal
 * ---------------------------------------------------------------------------
 *
 * This can take five seconds and it can fail, and a modal that fails is a trap:
 * an error with nowhere to go but "cancel". A pushed screen can hold the
 * failure, keep what the user pasted, and offer the next thing to try.
 *
 * ---------------------------------------------------------------------------
 * One field, not a URL/Text switch
 * ---------------------------------------------------------------------------
 *
 * A segmented control would make the user classify their own paste, which is
 * the computer's job — anything that parses as a URL is a link and everything
 * else is a recipe. See `looksLikeUrl`.
 */
export default function RecipeImportScreen() {
  const { colors } = useTheme();
  const t = useT();
  const { addList, addParsedItem, addOrReviveItem, lists } = useGroceries();
  /** Set when opened from inside a list: append there rather than create. */
  const { to } = useLocalSearchParams<{ to?: string }>();
  const target = to ? lists.find((l) => l.id === to) : undefined;
  const { showToast } = useToast();
  const { locked } = usePlusGate();

  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ImportOutcome['status'] | null>(null);
  const [recipe, setRecipe] = useState<ParsedRecipe | null>(null);
  const [clip, setClip] = useState<string | null>(null);
  /** Where to go once the review sheet has actually gone. See `onConfirm`. */
  const [leaving, setLeaving] = useState<{ id: string; append: boolean } | null>(null);

  /**
   * The gate, checked here as well as at the two buttons that open this screen.
   *
   * Those buttons already call requirePlus() when locked, so this only fires
   * for a route reached another way — a deep link, a notification, a restored
   * navigation state after the trial expired mid-session. Every other Plus
   * feature is a card inside a gated tab; this is the only one with its own URL,
   * so it is the only one that needs the check twice.
   *
   * replace(), not push(): backing out of the paywall should land wherever the
   * user was, not on the screen they were not allowed to open.
   */
  useEffect(() => {
    if (locked) router.replace('/paywall');
  }, [locked]);

  /**
   * The clipboard chip is most of this screen's value.
   *
   * People arrive having just copied a link from a browser or a chat. Without
   * this the flow is: open Korb, tap +, tap import, long-press the field, tap
   * paste. With it, it is one tap. Read once on mount and never again — polling
   * the clipboard is the kind of thing that makes an OS show a warning toast.
   */
  useEffect(() => {
    void (async () => {
      try {
        const text = await Clipboard.getStringAsync();
        if (text && looksLikeUrl(text)) setClip(text.trim());
      } catch {
        // No clipboard access is not an error worth telling anyone about.
      }
    })();
  }, []);

  const run = async (raw: string) => {
    const value = raw.trim();
    if (!value || phase !== 'idle') return;
    haptics.tick();
    setError(null);
    const isUrl = looksLikeUrl(value);
    setPhase(isUrl ? 'fetching' : 'reading');

    // A URL has two real stages and one spinner sitting there for six seconds
    // reads as a hang, so the label moves once the fetch is plausibly done.
    const advance = isUrl ? setTimeout(() => setPhase('reading'), 1800) : null;
    const outcome = await importRecipe(isUrl ? { url: value } : { text: value });
    if (advance) clearTimeout(advance);
    setPhase('idle');

    if (outcome.status === 'ok') {
      haptics.success();
      setRecipe(outcome.recipe);
    } else {
      setError(outcome.status);
    }
  };

  /**
   * Write the chosen rows. The sheet has already done the choosing.
   *
   * Appending uses addOrReviveItem rather than addParsedItem, so importing a
   * second curry into a list that already has onions on it un-ticks the onions
   * instead of adding a second row — the same rule every other add path in the
   * app follows.
   *
   * -------------------------------------------------------------------------
   * Why this does not navigate here
   * -------------------------------------------------------------------------
   *
   * It used to, and it landed on a blank white screen. Two separate faults, and
   * fixing either alone would have left the other:
   *
   *   The review sheet is a react-native <Modal>, which on Android is its own
   *   native window. `setRecipe(null)` and `router.replace(...)` batch into one
   *   commit, so the screen underneath was being torn down and replaced while
   *   that window was still dismissing. The stack lands, the modal window is
   *   still on top of it, and what you see is the empty window.
   *
   *   For the ?to= case it was also navigating to a route already in the stack.
   *   Coming from a list, the stack is [tabs, list/X, recipe]; replacing the top
   *   with list/X gives two entries with the same key, and the duplicate renders
   *   nothing.
   *
   * So: unmount the sheet, wait for it to be gone, and only then move — and for
   * an append, don't move at all. Going back to the list the user was already
   * looking at is both the correct stack operation and what they asked for.
   */
  const onConfirm = (name: string, rows: ReviewRow[]) => {
    const id = target?.id ?? addList(name);
    for (const r of rows) {
      const parsed = {
        name: r.name,
        category: categorizeSync(r.name),
        quantity: r.quantity,
        unit: r.unit,
      };
      if (target) addOrReviveItem(id, parsed);
      else addParsedItem(id, parsed);
    }
    showToast(t('recipe.added', { count: rows.length, list: target?.name ?? name }));
    // Same commit: the Modal unmounts, and the effect below picks up the move.
    setRecipe(null);
    setLeaving({ id, append: target != null });
  };

  useEffect(() => {
    if (!leaving) return;
    // The effect already runs after the commit that unmounted the Modal; this
    // additionally waits out its dismissal animation, which is the part Android
    // does on its own schedule.
    const task = InteractionManager.runAfterInteractions(() => {
      if (leaving.append) {
        // Back to the list that opened this. It re-reads the store on render,
        // so the imported rows are simply there.
        router.back();
      } else {
        // replace, not push: backing out of a list built from an import should
        // reach the app, not the import screen it came from.
        router.replace({ pathname: '/list/[id]', params: { id: leaving.id } });
      }
    });
    return () => task.cancel();
  }, [leaving]);

  const busy = phase !== 'idle';

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} disabled={busy}>
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[type.h1, { color: colors.ink }]}>{t('recipe.title')}</Text>
          <Text style={[type.sub, { color: colors.muted }]}>{t('recipe.subtitle')}</Text>

          {clip && !busy && (
            <Pressable
              onPress={() => {
                setInput(clip);
                void run(clip);
              }}
              style={[styles.clip, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
            >
              <Ionicons name="clipboard-outline" size={18} color={colors.accent} />
              <View style={styles.grow}>
                <Text style={[type.sub, { color: colors.accent }]}>{t('recipe.pasteClip')}</Text>
                <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                  {clip.replace(/^https?:\/\//, '')}
                </Text>
              </View>
            </Pressable>
          )}

          <TextInput
            value={input}
            onChangeText={setInput}
            editable={!busy}
            multiline
            placeholder={t('recipe.placeholder')}
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface },
            ]}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {error && (
            /* Every failure names the manual path and keeps what was pasted.
               Scraping the open web fails often and normally; a dead end here
               is why somebody never tries the feature twice. */
            <View style={[styles.error, { borderColor: colors.warn, backgroundColor: colors.warnSoft }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.warn} />
              <Text style={[type.sub, styles.grow, { color: colors.ink }]}>
                {t(`recipe.error.${error}`)}
              </Text>
            </View>
          )}

          <Pressable
            onPress={() => void run(input)}
            disabled={busy || !input.trim()}
            style={[
              styles.cta,
              { backgroundColor: colors.accent, opacity: busy || !input.trim() ? 0.5 : 1 },
            ]}
          >
            {busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color={colors.accentInk} />
                <Text style={[type.body, { color: colors.accentInk }]}>
                  {t(phase === 'fetching' ? 'recipe.fetching' : 'recipe.reading')}
                </Text>
              </View>
            ) : (
              <Text style={[type.body, { color: colors.accentInk }]}>{t('recipe.go')}</Text>
            )}
          </Pressable>

          {/* The copyright position, where a user can see it. */}
          <Text style={[type.sub, styles.centred, { color: colors.muted }]}>
            {t('recipe.ingredientsOnly')}
          </Text>
        </ScrollView>
      </SafeAreaView>

      <RecipeReviewSheet
        recipe={recipe}
        mode={target ? 'append' : 'create'}
        onClose={() => setRecipe(null)}
        onConfirm={onConfirm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, alignItems: 'flex-end' },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  grow: { flex: 1, minWidth: 0 },
  centred: { textAlign: 'center' },
  clip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  input: {
    minHeight: 130,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  cta: { paddingVertical: spacing.md, borderRadius: radii.pill, alignItems: 'center' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});

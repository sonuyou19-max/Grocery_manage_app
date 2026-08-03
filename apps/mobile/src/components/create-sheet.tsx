import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

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
 */

/**
 * Whether the importer itself exists yet.
 *
 * It does not. The row ships anyway, marked, because the alternative was a
 * sheet with one option in it — and because a row that says "soon" is honest
 * in a way that a row leading to a paywall for a feature nobody can use yet is
 * not. Flipping this to true and deleting the `soon` branch is the whole
 * client-side change when the importer lands.
 */
const RECIPE_IMPORT_READY = false;

export function CreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const t = useT();
  const { addList } = useGroceries();
  const { locked, requirePlus } = usePlusGate();
  const [naming, setNaming] = useState(false);

  const openNewList = (name: string) => {
    const id = addList(name);
    setNaming(false);
    onClose();
    router.push({ pathname: '/list/[id]', params: { id } });
  };

  const onRecipe = () => {
    if (!RECIPE_IMPORT_READY) return;
    onClose();
    // The gate decides, not this component. `locked` is false for a trial user
    // and for everyone while the tier is switched off, so this row simply works
    // until billing goes live — see lib/plus-gate.ts.
    if (locked) requirePlus();
    else router.push('/paywall');
  };

  return (
    <>
      <Modal
        visible={visible && !naming}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          {/* Stops a tap on the sheet itself from closing it. */}
          <Pressable onPress={() => {}}>
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
                style={[
                  styles.row,
                  { borderColor: colors.line },
                  !RECIPE_IMPORT_READY && styles.soonRow,
                ]}
                disabled={!RECIPE_IMPORT_READY}
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
                  <Text style={[type.sub, { color: colors.muted }]}>
                    {RECIPE_IMPORT_READY ? t('create.recipeBody') : t('create.recipeSoon')}
                  </Text>
                </View>
                {RECIPE_IMPORT_READY && (
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                )}
              </Pressable>
            </GlassView>
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12,18,10,0.45)',
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
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
  soonRow: { opacity: 0.6 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  badgeText: { color: '#FFFFFF' },
});

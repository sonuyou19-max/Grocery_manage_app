import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { GlassView } from '@/components/glass';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { useGroceries } from '@/store/groceries';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

interface ListPickerSheetProps {
  visible: boolean;
  /** Heading, e.g. "Add Milk to". Defaults to the localized "Add to list". */
  title?: string;
  onCancel: () => void;
  /** Called with the chosen (or freshly-created) list id. */
  onPick: (listId: string) => void;
}

/**
 * Reusable "which list?" picker. Reads lists straight from the groceries store
 * (so it always reflects local or household lists), lets you pick one or create
 * a new one inline, and hands the chosen list id back. Used by the pantry
 * "Add to list" swipe and the weekly-list builder.
 */
export function ListPickerSheet({ visible, title, onCancel, onPick }: ListPickerSheetProps) {
  const { colors } = useTheme();
  const t = useT();
  const { lists, addList } = useGroceries();
  const [creating, setCreating] = useState(false);
  const heading = title ?? t('pantry.addToList');

  return (
    <>
      {/* Hidden (not stacked) while the create prompt is up, to avoid two
          transparent modals fighting on Android. */}
      <Modal
        visible={visible && !creating}
        transparent
        animationType="fade"
        onRequestClose={onCancel}
      >
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <GlassView radius={radii.lg} style={styles.card}>
            <Text style={[type.h2, { color: colors.ink }]}>{heading}</Text>

            <Pressable style={styles.row} onPress={() => setCreating(true)}>
              <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
              <Text style={[type.body, { color: colors.accent, flex: 1 }]}>
                {t('lists.newListInline')}
              </Text>
            </Pressable>

            {lists.map((l) => (
              <Pressable key={l.id} style={styles.row} onPress={() => onPick(l.id)}>
                <Ionicons name="list-outline" size={22} color={colors.muted} />
                <Text style={[type.body, { color: colors.ink, flex: 1 }]} numberOfLines={1}>
                  {l.name}
                </Text>
              </Pressable>
            ))}
          </GlassView>
        </Pressable>
      </Modal>

      <TextPromptModal
        visible={creating}
        title={t('lists.newList')}
        placeholder={t('lists.newListPlaceholder')}
        confirmLabel={t('lists.create')}
        onCancel={() => setCreating(false)}
        onSubmit={(name) => {
          const id = addList(name);
          setCreating(false);
          onPick(id);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12,18,10,0.45)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: { padding: spacing.lg, gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
});

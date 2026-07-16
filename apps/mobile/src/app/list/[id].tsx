import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/categorize';
import { euros, parsePriceToCents } from '@/lib/money';
import { useGroceries, useList, type Item } from '@/store/groceries';
import { radii, spacing, type, useTheme } from '@/theme';

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const list = useList(id);
  const { addItem, toggleItem, setItemPrice } = useGroceries();
  const [draft, setDraft] = useState('');

  const grouped = useMemo(() => {
    if (!list) return [];
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      items: list.items.filter((it) => it.category === cat),
    })).filter((g) => g.items.length > 0);
  }, [list]);

  const budget = useMemo(() => {
    const items = list?.items ?? [];
    const priced = items.filter((it) => it.priceCents != null);
    const total = priced.reduce((sum, it) => sum + (it.priceCents ?? 0), 0);
    const inCart = priced
      .filter((it) => it.checked)
      .reduce((sum, it) => sum + (it.priceCents ?? 0), 0);
    return {
      hasPrices: priced.length > 0,
      pricedCount: priced.length,
      totalCount: items.length,
      toBuy: total - inCart,
      inCart,
    };
  }, [list]);

  if (!list) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
        <Text style={[type.body, { color: colors.ink, padding: spacing.xl }]}>
          This list no longer exists.
        </Text>
      </SafeAreaView>
    );
  }

  const checkedCount = list.items.filter((it) => it.checked).length;
  const progress = list.items.length ? checkedCount / list.items.length : 0;

  const promptPrice = (it: Item) => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        it.name,
        'Enter a price (optional)',
        (value) => setItemPrice(list.id, it.id, parsePriceToCents(value ?? '')),
        'plain-text',
        it.priceCents != null ? (it.priceCents / 100).toFixed(2) : '',
        'decimal-pad',
      );
    } else {
      // Android has no Alert.prompt; a small inline price modal comes with the
      // full item editor. For now, seed a demo price so the flow is visible.
      setItemPrice(list.id, it.id, it.priceCents == null ? 199 : null);
    }
  };

  const submit = () => {
    addItem(list.id, draft);
    setDraft('');
  };

  const comingSoon = () =>
    Alert.alert('Voice add', 'Speaking your list arrives with the AI step — coming next.');

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <View style={styles.grow}>
          <Text style={[type.h2, { color: colors.ink }]} numberOfLines={1}>
            {list.name}
          </Text>
          <Text style={[type.sub, { color: colors.muted }]}>
            {list.store ?? 'Any store'} · {checkedCount}/{list.items.length} in cart
          </Text>
        </View>
        <Pressable onPress={() => Alert.alert('Share', 'Household sharing arrives with sign-in.')} hitSlop={12}>
          <Ionicons name="person-add-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      {/* Progress */}
      <View style={[styles.progressTrack, { backgroundColor: colors.line }]}>
        <View
          style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.accent }]}
        />
      </View>

      {/* Budget strip — only shows money once prices are logged */}
      <View style={[styles.budget, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {budget.hasPrices ? (
          <>
            <Stat label="To buy" value={euros(budget.toBuy)} colors={colors} />
            <Stat label="In cart" value={euros(budget.inCart)} colors={colors} />
            <Stat
              label="Priced"
              value={`${budget.pricedCount} of ${budget.totalCount}`}
              colors={colors}
            />
          </>
        ) : (
          <Text style={[type.sub, { color: colors.muted, textAlign: 'center', flex: 1 }]}>
            Tap the price on an item to track spend — optional.
          </Text>
        )}
      </View>

      {/* Items */}
      <ScrollView contentContainerStyle={styles.list}>
        {grouped.map((group) => (
          <View key={group.category}>
            <View style={styles.catRow}>
              <Text style={[type.label, { color: colors.accent }]}>
                {CATEGORY_LABELS[group.category]}
              </Text>
              <View style={[styles.catLine, { backgroundColor: colors.line }]} />
            </View>
            {group.items.map((it) => (
              <View key={it.id} style={[styles.itemRow, { borderBottomColor: colors.line }]}>
                <Pressable onPress={() => toggleItem(list.id, it.id)} hitSlop={8}>
                  <View
                    style={[
                      styles.tick,
                      { borderColor: it.checked ? colors.accent : colors.muted },
                      it.checked && { backgroundColor: colors.accent },
                    ]}
                  >
                    {it.checked && <Ionicons name="checkmark" size={14} color={colors.accentInk} />}
                  </View>
                </Pressable>
                <View style={styles.grow}>
                  <Text
                    style={[
                      type.body,
                      { color: it.checked ? colors.muted : colors.ink },
                      it.checked && styles.struck,
                    ]}
                  >
                    {it.name}
                  </Text>
                </View>
                {it.quantity != null && (
                  <Text style={[type.sub, { color: colors.muted }]}>
                    {it.quantity}
                    {it.unit ? ` ${it.unit}` : ''}
                  </Text>
                )}
                <Pressable onPress={() => promptPrice(it)} hitSlop={8}>
                  {it.priceCents != null ? (
                    <Text style={[type.price, { color: colors.ink }]}>{euros(it.priceCents)}</Text>
                  ) : (
                    <Text style={[type.price, { color: colors.muted, opacity: 0.5 }]}>＋ €</Text>
                  )}
                </Pressable>
              </View>
            ))}
          </View>
        ))}
        {list.items.length === 0 && (
          <Text style={[type.sub, { color: colors.muted, textAlign: 'center', marginTop: spacing.xl }]}>
            Nothing here yet — add your first item below.
          </Text>
        )}
      </ScrollView>

      {/* Add bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.surface }}>
          <View style={[styles.addBar, { borderTopColor: colors.line }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add an item…"
              placeholderTextColor={colors.muted}
              style={[styles.input, { color: colors.ink, backgroundColor: colors.bg, borderColor: colors.line }]}
              returnKeyType="done"
              onSubmitEditing={submit}
            />
            <Pressable onPress={comingSoon} hitSlop={8} style={styles.mic}>
              <Ionicons name="mic-outline" size={22} color={colors.accent} />
            </Pressable>
            <Pressable
              onPress={submit}
              style={[styles.addBtn, { backgroundColor: draft.trim() ? colors.accent : colors.line }]}
            >
              <Ionicons name="add" size={24} color={draft.trim() ? colors.accentInk : colors.muted} />
            </Pressable>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.stat}>
      <Text style={[type.label, { color: colors.muted }]}>{label}</Text>
      <Text style={[type.body, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  progressTrack: { height: 6, borderRadius: 3, marginHorizontal: spacing.lg, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  budget: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radii.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  list: { padding: spacing.lg, gap: spacing.xs, paddingBottom: spacing.xxl },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  catLine: { flex: 1, height: 1 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  struck: { textDecorationLine: 'line-through' },
  addBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  mic: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});

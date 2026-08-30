import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassView } from '@/components/glass';
import { ItemEmoji } from '@/components/item-emoji';
import { Sheet, SheetHandle } from '@/components/sheet';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { DayPicker } from '@/components/day-picker';
import { currencySymbolFor } from '@/i18n';
import { decimalMarkFor } from '@/i18n/regions';
import { UNITS } from '@korb/shared';
import type { ItemCategory } from '@korb/shared';
import { dayDiff, longDayLabel, noonOn } from '@/lib/calendar';
import { haptics } from '@/lib/haptics';
import { useLastPresent } from '@/lib/motion';
import { parseQuantity, totalFor } from '@/lib/purchase-log';
import { orderedStoreOptions, recordStoreUse, useStorePrefs } from '@/lib/store-prefs';
import { useLocale } from '@/store/locale';
import { radii, spacing, type, useScrollIndicator, useTheme } from '@/theme';

/**
 * What was actually bought — the form behind "Add purchase".
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 *
 * The button used to log a purchase the instant it was tapped: today's date,
 * no price, no quantity, no shop. That is the right shape for ticking a row off
 * in the aisle, where the app already knows all four from the list — and the
 * wrong shape entirely for the pantry, where the reason you are reaching for it
 * is that a shop happened which the app does NOT know about. Somebody
 * remembering on Tuesday that they bought bread on Sunday had no way to say so,
 * and the one-tap version silently recorded the wrong day.
 *
 * ---------------------------------------------------------------------------
 * One mandatory field, and it starts filled
 * ---------------------------------------------------------------------------
 *
 * The date is required and every other field is optional, which sounds like a
 * validation rule and is really a statement about what a purchase IS: an event
 * at a time. A price, a size, a shop are things you may or may not remember,
 * and this app has said since its first migration that an unpriced purchase is
 * still a purchase.
 *
 * So the date defaults to today and can never be emptied — there is no state of
 * this form that fails to submit, and no error message, because a required
 * field that is pre-answered correctly is a field nobody can get wrong. The
 * work the requirement does is making the day EDITABLE and visible, not making
 * the shopper prove they filled it in.
 */
export interface PurchaseDraft {
  at: number;
  priceCents: number | null;
  quantity: number | null;
  unit: string | null;
  packs: number;
  store: string | null;
}

export function PurchaseSheet({
  item,
  onClose,
  onSave,
}: {
  /** The item being recorded, or null when the sheet is closed. */
  item: { key: string; display: string; category: ItemCategory } | null;
  onClose: () => void;
  onSave: (draft: PurchaseDraft) => void;
}) {
  const { colors } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const insets = useSafeAreaInsets();
  const { t, currency, money, region, language } = useLocale();
  const storePrefs = useStorePrefs();
  const { height: windowHeight } = useWindowDimensions();
  const decimal = decimalMarkFor(region);

  // Draw the last item through the exit — see useLastPresent. Without it the
  // sheet does not animate away, it stops existing, which on screen is a flash.
  const shown = useLastPresent(item);

  const [at, setAt] = useState(() => Date.now());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [qtyText, setQtyText] = useState('');
  const [unit, setUnit] = useState<string | null>(null);
  const [packs, setPacks] = useState(1);
  const [priceText, setPriceText] = useState('');
  const [store, setStore] = useState<string | null>(null);
  const [customStore, setCustomStore] = useState(false);

  /*
   * A fresh form for every item.
   *
   * Without this the sheet is a singleton whose fields outlive the thing they
   * describe: record €2.30 of bread, open milk, and the price of the bread is
   * sitting in the field waiting to be saved against the milk. Keyed on the
   * item's key rather than on `item` itself, so a re-render that hands over an
   * equal-but-new object does not wipe what somebody is halfway through
   * typing.
   */
  const openKey = item?.key ?? null;
  useEffect(() => {
    if (openKey == null) return;
    setAt(Date.now());
    setCalendarOpen(false);
    setQtyText('');
    setUnit(null);
    setPacks(1);
    setPriceText('');
    setStore(null);
  }, [openKey]);

  if (!shown) return null;

  const total = totalFor(priceText, packs, decimal);
  // Days back from today, which is what the two quick chips are about. Positive
  // is the past; today is 0.
  const back = dayDiff(at, Date.now());

  const pickDay = (ms: number) => {
    setAt(ms);
    setCalendarOpen(false);
  };

  const save = () => {
    haptics.success();
    if (store) recordStoreUse(store);
    onSave({
      at,
      priceCents: total,
      quantity: parseQuantity(qtyText, decimal),
      // A unit with no number attached describes nothing, so it is dropped
      // rather than stored as a lone "kg" the ledger would have to explain.
      unit: parseQuantity(qtyText, decimal) == null ? null : unit,
      packs,
      store,
    });
  };

  return (
    <Sheet visible={item != null} onClose={onClose} scrim gutter={0} motion="slide">
      {/* A real pixel ceiling rather than maxHeight: '85%'. Nothing above this
          card in Sheet has a definite height to resolve a percentage against,
          so the card lays out under a degenerate constraint and GlassView's
          overflow: hidden clips its last rows away — which here would be the
          Save button. purchase-ledger hit this first and wrote it up. */}
      <GlassView
        over="content"
        radius={radii.lg}
        style={[styles.sheet, { maxHeight: Math.round(windowHeight * 0.85) }]}
      >
        <SheetHandle />

        {/* Pinned, like the pantry sheet's: this form scrolls, and the name of
            the thing being recorded is the one line that must never leave. */}
        <View style={[styles.head, { borderColor: colors.line }]}>
          <ItemEmoji name={shown.display} category={shown.category} size={34} tile />
          <View style={styles.grow}>
            <Text style={[type.h2, { color: colors.ink }]} numberOfLines={2}>
              {shown.display}
            </Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {t('purchaseSheet.title')}
            </Text>
          </View>
        </View>

        <ScrollView
          {...scrollIndicator}
          style={styles.scrollArea}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/*
            WHEN — the only thing this form insists on.

            Given the accent card and the top of the sheet because it is both
            the required field and the one most likely to be wrong: the other
            four are blank until somebody types, so they can only be omitted,
            never mistaken. The date always holds a value, and a value that is
            silently wrong is worse than a gap.
          */}
          <View style={[styles.dateCard, { backgroundColor: colors.accentSoft }]}>
            <View style={styles.dateTop}>
              <Ionicons name="calendar" size={18} color={colors.accent} />
              <Text style={[type.label, styles.grow, { color: colors.accent }]}>
                {t('purchaseSheet.whenLabel')}
              </Text>
              {/* Not a badge saying "required". The two chips ARE the answer to
                  the common case, and a form that shouts about its own
                  validation before anybody has got it wrong is nagging. */}
              <DayChip
                label={t('purchaseSheet.today')}
                active={back === 0}
                onPress={() => pickDay(Date.now())}
              />
              <DayChip
                label={t('purchaseSheet.yesterday')}
                active={back === 1}
                onPress={() => pickDay(noonOn(Date.now() - 24 * 60 * 60 * 1000))}
              />
            </View>

            <Pressable
              onPress={() => {
                haptics.tick();
                setCalendarOpen((v) => !v);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: calendarOpen }}
              style={styles.dateRow}
            >
              <Text style={[type.body, styles.grow, { color: colors.ink }]}>
                {longDayLabel(at, language)}
              </Text>
              <Ionicons
                name={calendarOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.accent}
              />
            </Pressable>

            {calendarOpen && <DayPicker value={at} onChange={pickDay} />}
          </View>

          {/* HOW MUCH — size of one pack, then the sum.
              Same two controls, same order and the same arithmetic as the
              list's item sheet, because they are the same question asked from
              a different screen. */}
          <Section icon="cube-outline" label={t('purchaseSheet.sizeLabel')}>
            <View style={styles.qtyRow}>
              <TextInput
                value={qtyText}
                onChangeText={setQtyText}
                placeholder="—"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                style={[
                  styles.input,
                  styles.qtyInput,
                  { color: colors.ink, backgroundColor: colors.bg, borderColor: colors.line },
                ]}
              />
              <View style={[styles.segment, { borderColor: colors.line }]}>
                {UNITS.map((u, i) => {
                  const active = unit === u;
                  return (
                    <Pressable
                      key={u}
                      onPress={() => setUnit(active ? null : u)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={u}
                      style={[
                        styles.segmentCell,
                        i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.line },
                        active && { backgroundColor: colors.accentSoft },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.segmentText, { color: active ? colors.accent : colors.muted }]}
                      >
                        {u}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Section>

          <Section icon="pricetag-outline" label={t('purchaseSheet.priceLabel')}>
            <View style={styles.mathRow}>
              <View
                style={[
                  styles.input,
                  styles.priceCell,
                  { backgroundColor: colors.bg, borderColor: colors.line },
                ]}
              >
                <Text style={[type.body, { color: colors.muted }]}>
                  {currencySymbolFor(currency)}
                </Text>
                <TextInput
                  value={priceText}
                  onChangeText={setPriceText}
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  style={[styles.priceInput, { color: colors.ink }]}
                />
              </View>

              <Text style={[styles.mathOp, { color: colors.muted }]}>×</Text>

              <View style={[styles.stepper, { borderColor: colors.line }]}>
                <Pressable
                  onPress={() => {
                    haptics.tick();
                    setPacks((n) => Math.max(1, n - 1));
                  }}
                  disabled={packs <= 1}
                  accessibilityRole="button"
                  accessibilityLabel={t('itemSheet.packsFewer')}
                  style={[styles.stepBtn, packs <= 1 && styles.stepOff]}
                >
                  <Ionicons name="remove" size={16} color={colors.ink} />
                </Pressable>
                <Text style={[type.body, styles.stepValue, { color: colors.ink }]}>{packs}</Text>
                <Pressable
                  onPress={() => {
                    haptics.tick();
                    setPacks((n) => Math.min(999, n + 1));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('itemSheet.packsMore')}
                  style={styles.stepBtn}
                >
                  <Ionicons name="add" size={16} color={colors.ink} />
                </Pressable>
              </View>

              <Text style={[styles.mathOp, { color: colors.muted }]}>=</Text>

              {/* Derived, never typed — the same rule as the item sheet. A
                  total you can edit is a total that can contradict the two
                  numbers standing next to it. */}
              <View style={[styles.totalCell, { borderColor: colors.line }]}>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  style={[type.body, styles.totalText, { color: colors.ink }]}
                >
                  {money(total ?? 0)}
                </Text>
              </View>
            </View>
          </Section>

          <Section icon="storefront-outline" label={t('purchaseSheet.storeLabel')}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.storeRow}
              keyboardShouldPersistTaps="handled"
            >
              <StoreOption active={store == null} onPress={() => setStore(null)}>
                <Ionicons name="remove-circle-outline" size={22} color={colors.muted} />
                <Text style={[styles.storeLabel, { color: colors.muted }]}>
                  {t('itemSheet.storeNone')}
                </Text>
              </StoreOption>

              {orderedStoreOptions(storePrefs).map((entry) => (
                <StoreOption
                  key={entry.id}
                  active={store === entry.id}
                  onPress={() => setStore(entry.id)}
                >
                  <SupermarketBadge store={entry.id} />
                  <Text style={[styles.storeLabel, { color: colors.ink }]} numberOfLines={1}>
                    {entry.kind === 'chain' ? entry.chain.name : entry.id}
                  </Text>
                </StoreOption>
              ))}

              <StoreOption active={false} onPress={() => setCustomStore(true)}>
                <View style={[styles.customBadge, { borderColor: colors.accent }]}>
                  <Ionicons name="add" size={16} color={colors.accent} />
                </View>
                <Text style={[styles.storeLabel, { color: colors.accent }]} numberOfLines={1}>
                  {t('itemSheet.storeOther')}
                </Text>
              </StoreOption>
            </ScrollView>
          </Section>
        </ScrollView>

        {/* Pinned, both of them. Save is the point of the sheet and Cancel is
            the way out of it, and neither may be something you have to scroll
            a form to reach. */}
        <View
          style={[
            styles.footer,
            { borderColor: colors.line, paddingBottom: spacing.sm + insets.bottom },
          ]}
        >
          <Pressable onPress={onClose} style={styles.cancel} hitSlop={8}>
            <Text style={[type.body, { color: colors.muted }]}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            onPress={save}
            accessibilityRole="button"
            style={[styles.save, { backgroundColor: colors.accent }]}
          >
            <Text style={[type.body, { color: colors.accentInk }]}>
              {t('purchaseSheet.save')}
            </Text>
          </Pressable>
        </View>
      </GlassView>

      <TextPromptModal
        visible={customStore}
        title={t('itemSheet.customStoreTitle')}
        placeholder={t('itemSheet.customStorePlaceholder')}
        confirmLabel={t('itemSheet.customStoreConfirm')}
        onCancel={() => setCustomStore(false)}
        onSubmit={(value) => {
          setStore(value);
          recordStoreUse(value);
          setCustomStore(false);
        }}
      />
    </Sheet>
  );
}

function Section({
  icon,
  label,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={15} color={colors.muted} />
        <Text style={[type.label, { color: colors.muted }]}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function DayChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.dayChip,
        {
          borderColor: active ? colors.accent : colors.line,
          backgroundColor: active ? colors.accent : 'transparent',
        },
      ]}
    >
      <Text style={[type.sub, { color: active ? colors.accentInk : colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

function StoreOption({
  active,
  onPress,
  children,
}: {
  active: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.storeOption,
        {
          borderColor: active ? colors.accent : colors.line,
          backgroundColor: active ? colors.accentSoft : 'transparent',
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { overflow: 'hidden' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1, minWidth: 0 },
  scrollArea: { flexGrow: 0 },
  content: { padding: spacing.lg, gap: spacing.lg },

  dateCard: { borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
  dateTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayChip: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },

  section: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

  input: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.sm, height: 44 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qtyInput: { width: 78, textAlign: 'center' },

  segment: { flex: 1, flexDirection: 'row', borderWidth: 1, borderRadius: radii.md, overflow: 'hidden' },
  segmentCell: { flex: 1, minWidth: 0, paddingVertical: 11, alignItems: 'center' },
  segmentText: { fontSize: 13, fontWeight: '600' },

  mathRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  priceCell: { flex: 1.2, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  priceInput: { flex: 1, minWidth: 0, fontSize: 15 },
  mathOp: { fontSize: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.md, height: 44 },
  stepBtn: { paddingHorizontal: spacing.sm, height: 44, justifyContent: 'center' },
  stepOff: { opacity: 0.35 },
  stepValue: { minWidth: 20, textAlign: 'center', fontVariant: ['tabular-nums'] },
  totalCell: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  totalText: { fontWeight: '700' },

  storeRow: { gap: spacing.sm, paddingRight: spacing.lg },
  storeOption: {
    width: 84,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 4,
  },
  storeLabel: { fontSize: 11, textAlign: 'center' },
  customBadge: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancel: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  save: {
    flex: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
});

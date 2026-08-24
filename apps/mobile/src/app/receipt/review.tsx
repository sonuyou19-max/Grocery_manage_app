import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Frosted } from '@/components/frosted';
import { Safe } from '@/components/safe';
import { useToast } from '@/components/toast';
import { MeshBackground } from '@/components/mesh-background';
import { PressScale } from '@/components/press-scale';
import { Sheet } from '@/components/sheet';
import { currencySymbolFor } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { parsePriceToCents } from '@/lib/money';
import { displayName, type ListCandidate, type ReceiptPurchase } from '@/lib/receipt';
import {
  assign,
  groupPurchases,
  includedCount,
  includedTotal,
  initialDecisions,
  setInclude,
  setPrice,
  pickerOptions,
  unclaimed,
  type Decisions,
} from '@/lib/receipt-review';
import { claimReceipt, planCommit, purchaseInstant, type ListRow } from '@/lib/receipt-commit';
import { takeRun, type ScanRun } from '@/lib/receipt-run';
import { useGroceries } from '@/store/groceries';
import { useHousehold } from '@/store/household';
import { useLocale } from '@/store/locale';
import { usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * Check what the scan read, then import it.
 *
 * ---------------------------------------------------------------------------
 * Three groups, and why they are these three
 * ---------------------------------------------------------------------------
 *
 * A receipt and a shopping list overlap; they are not the same set. Every row
 * on this screen is in exactly one of three states, and each wants a different
 * thing from the person reading it:
 *
 *   ON THE LIST     — a line the matcher landed on one of your rows. Check the
 *                     price, check it landed on the right row. Most will be
 *                     fine; the ones that are not are the reason for the raw
 *                     printed line sitting under every name.
 *
 *   ALSO BOUGHT     — a line that is not on the list. Not a failure: most of a
 *                     real shop was never written down, and capturing it is the
 *                     entire point of scanning a receipt rather than ticking
 *                     boxes. In by default.
 *
 *   NOT ON THE      — a list row nothing claimed. Two different situations
 *   RECEIPT           wearing one face — you didn't buy it, or the scan missed
 *                     it — and nothing here can tell them apart, so it doesn't
 *                     guess. It shows them, and they are the rows the picker
 *                     offers when a line is pointed somewhere new.
 *
 * The third group takes no action of its own. An "unbought" list row is not
 * something this screen has any business changing: the list is still the list,
 * and a receipt that didn't mention the milk is not evidence you don't want it.
 *
 * ---------------------------------------------------------------------------
 * The printed line is always visible
 * ---------------------------------------------------------------------------
 *
 * `CAR EIREN X30` under "Eggs", every row, never collapsed. It is the only
 * thing on the screen that is not an interpretation — the name, the emoji, the
 * category and the match are all things a model decided — so it is the only
 * thing anyone can check an interpretation against. Hiding it behind a tap
 * would make the check optional, and a check nobody performs is decoration.
 *
 * ---------------------------------------------------------------------------
 * Brand sits beside the name and never inside it
 * ---------------------------------------------------------------------------
 *
 * "Alpro" is drawn as its own muted chip, not folded into "Alpro almond milk".
 * The moment a brand becomes part of a name it becomes part of the item's
 * identity: item_key is generated from the name, so `Alpro almond milk` and
 * `almond milk` would be two different things forever, with two price
 * histories, neither of which is the price history of almond milk.
 */

/** How the row's amount is displayed while it is not being edited. */
type Editing = { key: string; text: string } | null;

export default function ReceiptReviewScreen() {
  const { t, money, currency } = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lists, toggleItem, updateItem } = useGroceries();
  const { logPurchase } = usePantryIntel();
  const { activeId } = useHousehold();
  const { showToast } = useToast();

  /*
   * Read once, in state, because takeRun() CONSUMES the stash — calling it in
   * the render body would hand the first paint a scan and every render after
   * it nothing, so the screen would blank on the first keystroke.
   */
  const [run] = useState<ScanRun | null>(() => takeRun());
  const [decisions, setDecisions] = useState<Decisions>(() =>
    run ? initialDecisions(run.purchases, run.matches) : new Map(),
  );
  const [editing, setEditing] = useState<Editing>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  const list = lists.find((l) => l.id === id);
  const rows: ListRow[] = useMemo(
    () =>
      (list?.items ?? []).map((it) => ({
        id: it.id,
        name: it.name,
        category: it.category,
        checked: it.checked,
      })),
    [list],
  );
  // The matcher's view of the same rows. `checked` is the planner's business
  // only — which row a receipt line IS has nothing to do with whether the
  // shopper already ticked it.
  const candidates: ListCandidate[] = rows;

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  const purchases = run?.purchases ?? [];
  const { matched, extra } = useMemo(
    () => groupPurchases(purchases, decisions),
    [purchases, decisions],
  );
  const missing = useMemo(() => unclaimed(candidates, decisions), [candidates, decisions]);

  const total = includedTotal(purchases, decisions);
  const count = includedCount(purchases, decisions);

  if (!run) {
    // No stash: arrived by a back gesture after the run was consumed, or by a
    // deep link. Nothing to show and nothing recoverable — the photographs are
    // gone with the capture screen.
    return (
      <View style={styles.root}>
        <MeshBackground />
        <Safe style={styles.safe} edges={['top']}>
          <Header title={t('receipt.reviewTitle')} subtitle={null} />
          <Text style={[type.sub, styles.empty, { color: colors.muted }]}>
            {t('receipt.nothingToReview')}
          </Text>
        </Safe>
      </View>
    );
  }

  const { receipt } = run;

  /*
   * WHEN this shopping happened, as the import will actually record it.
   *
   * Two bugs in one line before this. It printed the raw ISO string —
   * `2028-07-30T19:55:00` — which is a machine's spelling of a date, in front of
   * somebody checking their groceries.
   *
   * And it printed the value off the PAPER while the import used a different
   * one. purchaseInstant rejects a date more than a year out and falls back to
   * now, which is right: a receipt read as 2028 must not file a purchase two
   * years into a history that cannot show it. But the header went on displaying
   * 2028, so the screen and the write disagreed and nothing said so. Now the
   * header shows the instant that will be used, and says when the printed one
   * was not believed.
   */
  const chosen = purchaseInstant(receipt.purchasedAt, Date.now());
  const printed = receipt.purchasedAt ? Date.parse(receipt.purchasedAt) : NaN;
  const when = {
    label: new Date(chosen).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    // Only when the paper gave a date AND we declined to use it. A receipt with
    // no legible date at all is ordinary and needs no explaining.
    substituted: Number.isFinite(printed) && printed !== chosen,
  };

  const sections = [
    { key: 'matched' as const, title: t('receipt.groupMatched'), data: matched },
    { key: 'extra' as const, title: t('receipt.groupExtra'), data: extra },
  ].filter((s) => s.data.length > 0);

  /** Commit the field that is open, if any. Called on blur and on submit. */
  const commitEdit = () => {
    if (!editing) return;
    const cents = parsePriceToCents(editing.text);
    // An unparseable field leaves the amount alone rather than zeroing it: a
    // half-typed price is a price mid-thought, not a decision to pay nothing.
    if (cents != null) setDecisions((d) => setPrice(d, editing.key, cents));
    setEditing(null);
  };

  /**
   * Write it.
   *
   * ---------------------------------------------------------------------------
   * The order is the idempotency
   * ---------------------------------------------------------------------------
   *
   * The receipt row is claimed FIRST, against `unique (household_id,
   * fingerprint)`. A conflict means this paper has been imported before — by
   * this device a moment ago, or by a housemate's phone — and the right answer
   * is to write nothing and say so. People re-scan when they are unsure the
   * first one worked, which is exactly when a second copy of a week's spend
   * would otherwise land.
   *
   * `committing` guards the double-tap, which the claim would also catch; it is
   * here because catching it at the database costs a round trip and shows the
   * shopper a "already imported" message for their own second tap.
   *
   * The purchases then go through `logPurchase` — the same function a check-off
   * uses — so the amendment window, the burn-rate update and the pantry upsert
   * are the ones the app already has, not a second copy written for receipts.
   */
  const commit = async () => {
    if (committing || !run) return;
    if (!activeId) {
      // No household, nowhere to write: receipts.household_id is not null and
      // RLS answers to membership. Reachable by signing out mid-review.
      showToast(t('receipt.needHousehold'));
      return;
    }

    setCommitting(true);
    const plan = planCommit(run.receipt, run.purchases, decisions, rows, Date.now());
    const claim = await claimReceipt(activeId, plan.receipt);

    if (claim.kind !== 'ok') {
      setCommitting(false);
      showToast(t(claim.kind === 'duplicate' ? 'receipt.alreadyImported' : 'receipt.importFailed'));
      return;
    }

    for (const p of plan.purchases) {
      logPurchase(p.name, p.category, { ...p.detail, receiptId: claim.receiptId });
    }
    /*
     * Then the list rows themselves.
     *
     * Without this the import wrote a perfect purchase log and left the list
     * saying €0.00 with an empty quantity — the receipt's numbers existed, in
     * the one place nobody opens. Patch before tick: a ticked row starts the
     * sweep that can take it off the list, and it should carry its price when
     * it goes.
     *
     * `patches` and `tick` are both empty unless a row matched, which cannot
     * happen without a list; the check is here so a list deleted mid-review
     * cannot throw over writes that have already succeeded.
     */
    if (list) {
      for (const { itemId, patch } of plan.patches) updateItem(list.id, itemId, patch);
      for (const itemId of plan.tick) toggleItem(list.id, itemId);
    }

    haptics.success();
    showToast(t('receipt.imported', { count: plan.purchases.length }));
    // back(), not replace: the list is the screen under this one, and it
    // re-renders from the same store with the rows now ticked.
    router.back();
  };

  const renderRow = (p: ReceiptPurchase, order: number) => {
    const d = decisions.get(p.key);
    if (!d) return null;
    const target = d.itemId != null ? byId.get(d.itemId) : null;
    const isEditing = editing?.key === p.key;

    return (
      <Animated.View
        entering={FadeInDown.delay(Math.min(order, 12) * 28).duration(240)}
        style={[styles.row, { borderColor: colors.line }, !d.include && styles.excluded]}
      >
        <Pressable
          onPress={() => {
            haptics.tick();
            setDecisions((prev) => setInclude(prev, p.key, !d.include));
          }}
          hitSlop={8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: d.include }}
          accessibilityLabel={p.name}
        >
          <Ionicons
            name={d.include ? 'checkbox' : 'square-outline'}
            size={22}
            color={d.include ? colors.accent : colors.muted}
          />
        </Pressable>

        {/* Outside the text column, beside the checkbox. Inside it, the glyph
            and the name competed for the same flexible width — and an emoji
            never needs to shrink. */}
        <Text style={styles.emoji}>{p.emoji ?? '🧾'}</Text>

        <View style={styles.grow}>
          {/* The expansion, not the till's abbreviations — those are the two
              lines underneath. See displayName. */}
          <Text style={[type.body, { color: colors.ink }]} numberOfLines={2}>
            {displayName(p)}
          </Text>

          {/* The till's own words, always. */}
          {p.raw.map((raw) => (
            <Text key={raw} style={[type.label, { color: colors.muted }]} numberOfLines={1}>
              {raw}
            </Text>
          ))}

          {/* Brand and match sit together on a wrapping row UNDER the name.
              Beside it they were a third claimant on one line of a phone —
              `DOUWE EGBERTS oploskoffie dessert glas 200g` plus a chip plus a
              price does not fit, and the chip was the piece that got pushed off
              the screen edge. */}
          <View style={styles.metaRow}>
            {/* Its own chip. Never part of the name — see the header. */}
            {p.brand && (
              <View style={[styles.brand, { borderColor: colors.line }]}>
                <Text style={[type.label, { color: colors.muted }]} numberOfLines={1}>
                  {p.brand}
                </Text>
              </View>
            )}
            <Pressable
              onPress={() => {
                haptics.tick();
                setPicking(p.key);
              }}
              hitSlop={6}
              accessibilityRole="button"
              style={styles.shrink}
            >
              <Text
                style={[type.label, { color: target ? colors.accent : colors.muted }]}
                numberOfLines={1}
              >
                {target
                  ? t('receipt.onList', { name: target.name })
                  : t('receipt.notOnList')}
                {'  '}
                <Ionicons name="chevron-down" size={11} />
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Editable, because the one number worth correcting is this one. A
            weighed line the model read as 1,67 when the paper says 16,7 is
            invisible in the name and obvious in the amount. */}
        {/* A column of its OWN, fixed width, that never shrinks.
            This is the overlap. The amount used to be a bare sibling of a text
            column that had nothing stopping it growing, so a long product name
            ran straight under the price and the two painted on top of each
            other. Reserving the width means the name has a real boundary to
            wrap against — and the row does not jump when you tap into the
            field, because both states are the same size. */}
        <View style={styles.amountCol}>
          {isEditing ? (
            <View style={[styles.amountBox, { borderColor: colors.accent }]}>
              <Text style={[type.label, { color: colors.muted }]}>
                {currencySymbolFor(currency)}
              </Text>
              <TextInput
                value={editing.text}
                onChangeText={(text) => setEditing({ key: p.key, text })}
                onBlur={commitEdit}
                onSubmitEditing={commitEdit}
                keyboardType="decimal-pad"
                returnKeyType="done"
                autoFocus
                selectTextOnFocus
                style={[styles.amountInput, { color: colors.ink }]}
              />
            </View>
          ) : (
            <Pressable
              onPress={() => {
                haptics.tick();
                setEditing({ key: p.key, text: (d.priceCents / 100).toFixed(2) });
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('receipt.editAmount')}
            >
              <Text
                style={[type.body, styles.amountText, { color: colors.ink }]}
                numberOfLines={1}
              >
                {money(d.priceCents)}
              </Text>
            </Pressable>
          )}
        </View>
      </Animated.View>
    );
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <Safe style={styles.safe} edges={['top']}>
        <Header
          title={t('receipt.reviewTitle')}
          subtitle={`${receipt.store ?? t('receipt.unknownStore')} · ${when.label}`}
        />

        <SectionList
          sections={sections}
          keyExtractor={(p) => p.key}
          stickySectionHeadersEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.list, { paddingBottom: spacing.xxl }]}
          ListHeaderComponent={
            <View style={styles.head}>
              {/*
                The banner, first and plainly.

                It says one specific thing: the lines we read do not add up to
                the total the receipt prints about itself. That is not the same
                as "something is wrong with your shopping" and it is not the
                same as a failed scan — it means at least one number on this
                screen is not the number on the paper, and there is no way to
                know which. Hence: check before trusting, with the receipt's own
                complaints listed underneath.
              */}
              {!receipt.reconciled && (
                <View style={[styles.banner, { borderColor: colors.warn }]}>
                  <Ionicons name="warning-outline" size={20} color={colors.warn} />
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: colors.ink }]}>
                      {t('receipt.notReconciled')}
                    </Text>
                    {receipt.problems.map((p) => (
                      <Text key={p} style={[type.label, { color: colors.muted }]}>
                        {p}
                      </Text>
                    ))}
                  </View>
                </View>
              )}

              {when.substituted && (
                <View style={[styles.banner, { borderColor: colors.line }]}>
                  <Ionicons name="calendar-outline" size={20} color={colors.muted} />
                  <Text style={[type.sub, styles.grow, { color: colors.ink }]}>
                    {t('receipt.dateSubstituted', {
                      printed: new Date(printed).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }),
                      used: when.label,
                    })}
                  </Text>
                </View>
              )}

              <View style={styles.totals}>
                <Total label={t('receipt.paid')} value={money(receipt.paidCents)} />
                {receipt.depositCents !== 0 && (
                  <Total label={t('receipt.deposit')} value={money(receipt.depositCents)} />
                )}
                {receipt.discountCents !== 0 && (
                  <Total label={t('receipt.discount')} value={money(receipt.discountCents)} />
                )}
              </View>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <Frosted over="mesh" style={styles.sectionHead}>
              <Text style={[type.label, { color: colors.ink }]}>{section.title}</Text>
              <Text style={[type.label, { color: colors.muted }]}>
                {'·'} {section.data.length}
              </Text>
            </Frosted>
          )}
          renderItem={({ item, index, section }) =>
            renderRow(item, section.key === 'matched' ? index : matched.length + index)
          }
          ListFooterComponent={
            missing.length > 0 ? (
              <View style={styles.missing}>
                <Text style={[type.label, { color: colors.muted }]}>
                  {t('receipt.groupMissing')}
                </Text>
                <Text style={[type.sub, { color: colors.muted }]}>
                  {t('receipt.groupMissingBody')}
                </Text>
                <View style={styles.missingRows}>
                  {missing.map((c) => (
                    <View key={c.id} style={[styles.chip, { borderColor: colors.line }]}>
                      <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                        {c.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null
          }
        />

        {/*
          What the import comes to, and nothing about whether it "should".

          Deliberately not compared with the receipt's own total to raise an
          alarm: unticking a line is a legitimate thing to do and would trip any
          such check on the first tap. Whether the SCAN agrees with the paper is
          a different question and has the banner above.
        */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Frosted over="content" style={styles.footerInner}>
            <View style={styles.grow}>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t('receipt.importing', { count })}
              </Text>
              <Text style={[type.h2, { color: colors.ink }]}>{money(total)}</Text>
            </View>
            {/* Nothing to import is a real state — untick every row and the
                button has no work to do. */}
            <PressScale
              onPress={() => void commit()}
              disabled={committing || count === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: committing || count === 0 }}
              style={[
                styles.importBtn,
                { backgroundColor: colors.accent },
                (committing || count === 0) && styles.importOff,
              ]}
            >
              {committing ? (
                <ActivityIndicator color={colors.accentInk} />
              ) : (
                <Text style={[type.body, { color: colors.accentInk }]}>{t('receipt.import')}</Text>
              )}
            </PressScale>
          </Frosted>
        </View>
      </Safe>

      {/*
        The picker. Offers the rows nothing has claimed, plus whatever this line
        already holds — without that second part, re-opening the picker on a
        matched line would show every option EXCEPT the one currently chosen.
      */}
      <Sheet visible={picking != null} onClose={() => setPicking(null)} align="end" scrim>
        <Text style={[type.h2, { color: colors.ink }]}>{t('receipt.pickTitle')}</Text>
        <Pressable
          onPress={() => {
            if (picking) setDecisions((d) => assign(d, picking, null));
            setPicking(null);
          }}
          style={[styles.pickRow, { borderColor: colors.line }]}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.muted} />
          <Text style={[type.body, { color: colors.ink }]}>{t('receipt.notOnList')}</Text>
        </Pressable>
        {pickerOptions(candidates, decisions, picking).map((c) => (
          <Pressable
            key={c.id}
            onPress={() => {
              haptics.tick();
              if (picking) setDecisions((d) => assign(d, picking, c.id));
              setPicking(null);
            }}
            style={[styles.pickRow, { borderColor: colors.line }]}
          >
            <Ionicons name="cart-outline" size={20} color={colors.accent} />
            <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
              {c.name}
            </Text>
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string | null }) {
  const { colors } = useTheme();
  const t = useLocale().t;
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
      >
        <Ionicons name="chevron-back" size={26} color={colors.ink} />
      </Pressable>
      <View style={styles.grow}>
        <Text style={[type.h2, { color: colors.ink }]}>{title}</Text>
        {subtitle ? (
          <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.total}>
      <Text style={[type.label, { color: colors.muted }]}>{label}</Text>
      <Text style={[type.body, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  empty: { padding: spacing.xl, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  list: { paddingHorizontal: spacing.lg },
  head: { gap: spacing.md, paddingBottom: spacing.md },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  totals: { flexDirection: 'row', gap: spacing.lg },
  total: { gap: 2 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Dimmed, not removed: a row that vanishes when you untick it takes its own
  // untick button with it.
  excluded: { opacity: 0.45 },
  emoji: { fontSize: 17, lineHeight: 22 },
  brand: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    // Shrinks before it overflows. A brand long enough to need the whole row
    // is a brand worth truncating, not one worth pushing off the screen.
    flexShrink: 1,
    maxWidth: 130,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: 2,
  },
  shrink: { flexShrink: 1, minWidth: 0 },
  /*
   * The price column.
   *
   * `flexShrink: 0` is the load-bearing half: without it Yoga is free to
   * squeeze this to nothing when the text column asks for more room, which is
   * how a name ended up painted across a price. Wide enough for €1 234,56 in
   * the longest of the seven locales' formats.
   */
  amountCol: { width: 96, flexShrink: 0, alignItems: 'flex-end' },
  amountText: { textAlign: 'right' },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    alignSelf: 'stretch',
  },
  amountInput: { flex: 1, fontSize: 16, paddingVertical: spacing.sm, textAlign: 'right' },
  missing: { gap: spacing.sm, paddingTop: spacing.lg },
  missingRows: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    maxWidth: '100%',
  },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  footerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  importBtn: {
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  importOff: { opacity: 0.4 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

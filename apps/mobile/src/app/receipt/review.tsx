import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Frosted } from '@/components/frosted';
import { GlassView } from '@/components/glass';
import { Safe } from '@/components/safe';
import { useToast } from '@/components/toast';
import { MeshBackground } from '@/components/mesh-background';
import { PressScale } from '@/components/press-scale';
import { Sheet } from '@/components/sheet';
import { currencySymbolFor } from '@/i18n';
import { cascade } from '@/lib/cascade';
import { haptics } from '@/lib/haptics';
import { decimalMarkFor } from '@/i18n/regions';
import { parsePriceToCents } from '@/lib/money';
import {
  displayName,
  productName,
  type ListCandidate,
  type ReceiptProblem,
  type ReceiptPurchase,
} from '@/lib/receipt';
import {
  assign,
  groupPurchases,
  includedCount,
  includedTotal,
  initialDecisions,
  mergeLateMatches,
  offBy,
  collapseRaw,
  parseAmount,
  setAmount,
  setInclude,
  setPacks,
  setUnitPrice,
  unitPriceOf,
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
import { radii, spacing, type, useScrollIndicator, useTheme } from '@/theme';

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

/**
 * Which chip is open, and what has been typed into it.
 *
 * The field is part of the state rather than three separate states because only
 * one chip is ever open: opening a second must close the first, and two booleans
 * can disagree about that in a way one discriminated value cannot.
 */
type EditField = 'price' | 'packs' | 'size';
type Editing = { key: string; field: EditField; text: string } | null;

export default function ReceiptReviewScreen() {
  const { t, money, currency, region } = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollIndicator = useScrollIndicator();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lists, toggleItem, updateItem, addBoughtItem } = useGroceries();
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
  /*
   * The AI matcher's answers, arriving after the sheet is already up.
   *
   * Guarded twice over. `mergeLateMatches` refuses to touch a purchase that is
   * already assigned or a list row already spoken for, and `alive` stops the
   * write entirely once this screen has gone — a setState after an import has
   * navigated away is a warning at best and a resurrected sheet at worst.
   */
  useEffect(() => {
    if (!run) return;
    let alive = true;
    run.settle.then((matches) => {
      if (alive) setDecisions((prev) => mergeLateMatches(prev, matches));
    });
    return () => {
      alive = false;
    };
  }, [run]);

  /*
   * THE RECEIPT'S CONVENTION, NOT THE READER'S.
   *
   * Everything typed on this screen is a correction to a number printed on
   * paper, so the paper decides what a comma means. A Belgian scanning a
   * British till would otherwise read a corrected "1.50" as one and a half
   * thousand — their own convention applied to somebody else's receipt.
   *
   * The device's country is the fallback and only that: it is used when the
   * model could not tell from the paper, or when the scan came from a
   * deployment that predates the field.
   */
  const decimal =
    run?.receipt.decimalComma == null
      ? decimalMarkFor(region)
      : run.receipt.decimalComma
        ? ','
        : '.';

  const [editing, setEditing] = useState<Editing>(null);
  const [picking, setPicking] = useState<string | null>(null);
  /*
   * The picker's height, measured rather than guessed.
   *
   * Well under the window on purpose: this answers "which item is this?" about
   * a row the shopper was just looking at, and a picker that covers that row
   * has hidden the question it is asking. Nine list items used to run the whole
   * screen with no way to scroll.
   */
  const { height: windowHeight } = useWindowDimensions();
  const pickerCap = Math.round(windowHeight * 0.6);
  // The estimate only paints the first frame, before onLayout has fired; the
  // sheet is still animating in for another 220ms after that.
  const [pickHeadHeight, setPickHeadHeight] = useState(72);
  const onPickHeadLayout = (e: LayoutChangeEvent) =>
    setPickHeadHeight(e.nativeEvent.layout.height);
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
  /*
   * The last comparison, against the number on the paper rather than against
   * the model's own arithmetic. Null when it cannot mean anything — see offBy.
   */
  const gap = run
    ? offBy(purchases, decisions, run.receipt.paidCents, run.receipt.depositCents, run.receipt.discountCents)
    : null;

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

  /**
   * Commit the chip that is open, if any. Called on blur and on submit.
   *
   * Every branch fails the same way: an unparseable field leaves the value
   * alone rather than zeroing it. A half-typed price is a price mid-thought,
   * not a decision to pay nothing — and the same is true of a pack count
   * somebody has just cleared in order to retype.
   */
  const commitEdit = () => {
    if (!editing) return;
    const { key, field, text } = editing;

    if (field === 'price') {
      const cents = parsePriceToCents(text, decimal);
      // The PER-PACK price. setUnitPrice multiplies it back up, so the total —
      // which is what gets imported and summed — follows the shopper's edit.
      if (cents != null) setDecisions((d) => setUnitPrice(d, key, cents));
    } else if (field === 'packs') {
      const n = Number(text.replace(',', '.'));
      if (Number.isFinite(n) && n >= 1) setDecisions((d) => setPacks(d, key, n));
    } else {
      /*
       * "750g", "1 L", "33cl" — the shapes printed on packaging, which is what
       * people are copying from. A bare number keeps the unit the row already
       * had, so correcting 1L to 2L does not mean retyping the unit.
       */
      const parsed = parseAmount(text, decimal);
      if (parsed) {
        setDecisions((d) => {
          const current = d.get(key);
          const unit = parsed.quantity == null ? null : parsed.unit ?? current?.unit ?? null;
          return setAmount(d, key, parsed.quantity, unit);
        });
      }
    }
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
      /*
       * And the lines nobody wrote down, as rows that are already bought.
       *
       * Last, so a failure part-way through cannot leave a list holding new
       * rows for a shop whose matched rows never got their prices. These are
       * the only writes here that ADD something, which makes them the ones to
       * do once everything else has worked.
       */
      for (const row of plan.adds) addBoughtItem(list.id, row, row.detail);
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
    /*
     * Derived, never stored. Three packs at €2.09 are 69.67 cents each, the
     * chip says €0.70, and three times seventy is €2.10 — so the total stays
     * the stored figure and this is what the chip shows.
     */
    const unitCents = unitPriceOf(d);

    return (
      <Animated.View
        entering={cascade(order)}
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
          {/*
            The PRODUCT, which is what this becomes. The brand and the size sit
            below it rather than inside it — that separation is the whole point:
            it is what lets "milk" stay one item across Delhaize's litre and
            Alpro's, and what makes their prices comparable at all.
          */}
          <Text style={[type.body, { color: colors.ink }]} numberOfLines={2}>
            {productName(p)}
          </Text>

          {/*
            Everything the receipt knew that is NOT the product's identity.

            The brand keeps its own chip rather than joining a run of muted
            text: it is the field this whole separation exists for, and making
            it visually distinct is what says "this is a property of the
            purchase, not part of what the thing is". The size and count follow
            it as plain text — they are measurements, not identities.
          */}
          {p.brand && (
            <View style={styles.factRow}>
              <View style={[styles.brand, { borderColor: colors.line }]}>
                <Text style={[type.label, { color: colors.muted }]} numberOfLines={1}>
                  {p.brand}
                </Text>
              </View>
            </View>
          )}

          {/*
            The till's own words, always — but each distinct line once.

            Four cartons of milk print four identical rows, and showing all four
            spent sixty pixels saying one thing on the screen where height is
            what lets you hold the paper beside the phone. The printing is the
            only thing here that is not an interpretation, so it stays; the
            repetition does not, and the count says what was dropped.
          */}
          {collapseRaw(p.raw).map(({ text, count }) => (
            <Text key={text} style={[type.label, { color: colors.muted }]} numberOfLines={1}>
              {text}
              {count > 1 ? `  ×${count}` : ''}
            </Text>
          ))}

          {/* Brand and match sit together on a wrapping row UNDER the name.
              Beside it they were a third claimant on one line of a phone —
              `DOUWE EGBERTS oploskoffie dessert glas 200g` plus a chip plus a
              price does not fit, and the chip was the piece that got pushed off
              the screen edge. */}
          <View style={styles.metaRow}>
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

        {/*
          THE EDITABLE GROUP: price, size, pack count, then the total.

          A column of its OWN, fixed width, that never shrinks. This is the
          overlap that bit before — the amount used to be a bare sibling of a
          text column with nothing stopping it growing, so a long product name
          ran under the price and the two painted on top of each other.
          Reserving the width gives the name a real boundary to wrap against,
          and the row does not jump when a chip opens because every state is the
          same size.

          A dashed outline means "typing here changes this". Nothing else on the
          row borrows it — the match pill is the row's only green thing, so
          green keeps meaning "matched to your list" and dashes keep meaning
          "editable". Two signals, two jobs.
        */}
        <View style={styles.amountCol}>
          <View style={styles.chipRow}>
            <EditChip
              accessibilityLabel={t('receipt.editPrice')}
              open={isEditing && editing.field === 'price'}
              text={editing?.text ?? ''}
              onChangeText={(text) => setEditing({ key: p.key, field: 'price', text })}
              onOpen={() => setEditing({ key: p.key, field: 'price', text: (unitCents / 100).toFixed(2) })}
              onDone={commitEdit}
              keyboardType="decimal-pad"
              colors={colors}
            >
              {money(unitCents)}
            </EditChip>

            {/*
              The size. Empty is a real state and looks different: no fill, grey
              dashes, an ellipsis — a gap you may fill rather than a value you
              might mistake for one.
            */}
            <EditChip
              accessibilityLabel={t('receipt.editSize')}
              open={isEditing && editing.field === 'size'}
              empty={d.quantity == null}
              text={editing?.text ?? ''}
              onChangeText={(text) => setEditing({ key: p.key, field: 'size', text })}
              onOpen={() =>
                setEditing({
                  key: p.key,
                  field: 'size',
                  text: d.quantity == null ? '' : `${d.quantity}${d.unit ?? ''}`,
                })
              }
              onDone={commitEdit}
              colors={colors}
            >
              {d.quantity == null ? '···' : `${d.quantity} ${d.unit ?? ''}`.trim()}
            </EditChip>

            {/*
              A pack count of one is not missing — the receipt said one — so it
              gets a real chip rather than the placeholder. Only a genuine
              unknown earns the ellipsis, or every row of every receipt would
              carry one.
            */}
            <EditChip
              accessibilityLabel={t('receipt.editPacks')}
              open={isEditing && editing.field === 'packs'}
              text={editing?.text ?? ''}
              onChangeText={(text) => setEditing({ key: p.key, field: 'packs', text })}
              onOpen={() => setEditing({ key: p.key, field: 'packs', text: String(d.packs) })}
              onDone={commitEdit}
              keyboardType="number-pad"
              colors={colors}
            >
              {`× ${d.packs}`}
            </EditChip>
          </View>

          {/*
            The total: arithmetic, so no outline, no fill, nothing that invites a
            tap a tap could not honour. Only when the product arrived as more
            than one pack — below that the price chip already IS the total, and
            printing it twice says nothing.
          */}
          {d.packs > 1 && (
            <View style={styles.totalRow}>
              <Text style={[type.label, { color: colors.muted }]}>{t('receipt.lineTotal')}</Text>
              <Text style={[type.price, { color: colors.ink }]}>{money(d.priceCents)}</Text>
            </View>
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
                      <Text key={p.code} style={[type.label, { color: colors.muted }]}>
                        {phrase(p, t, money)}
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
              {/* Only when every line is in and the gap is real. A receipt that
                  adds up says nothing here. */}
              {gap != null && (
                <Text style={[type.label, { color: colors.warn }]}>
                  {t('receipt.offBy', { amount: money(Math.abs(gap)) })}
                </Text>
              )}
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
      <Sheet visible={picking != null} onClose={() => setPicking(null)} align="end" scrim gutter={spacing.md}>
        {/*
          A CARD, which this sheet did not have.

          <Sheet> supplies the scrim, the motion and a wrapper that can shrink —
          it deliberately supplies no surface, because a menu and a bottom sheet
          want different ones. The rows were handed to it bare, so the picker
          rendered with no fill at all and the review sheet showed straight
          through it. Every other sheet in this app wraps its children in a
          GlassView for exactly this reason.

          `over="content"` and not "mesh": there is a list of prices behind this,
          not the gradient background, and the translucent variant would let it
          read through — see components/frosted.
        */}
        <GlassView over="content" radius={radii.lg} style={[styles.picker, { maxHeight: pickerCap }]}>
          <View style={styles.pickHead} onLayout={onPickHeadLayout}>
            <Text style={[type.h2, { color: colors.ink }]}>{t('receipt.pickTitle')}</Text>
            {/* The line being answered about. The question is meaningless
                without it, and it is now behind a card. */}
            {picking && (
              <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                {run.purchases.find((p) => p.key === picking)?.raw[0] ?? ''}
              </Text>
            )}
          </View>

          {/*
            Capped with a MEASURED number rather than a percentage, and scrolled.

            A nine-item list ran the full height of the screen and could not be
            scrolled, so the rows past the fold were unreachable. The cap is
            deliberately well under the window: this answers "which item is
            this?" about a row the shopper was just looking at, and a picker that
            covers that row has hidden the question.

            The measured header is subtracted for the same reason the purchase
            ledger measures its own — see check-modal-nav, which pins that one.
          */}
          <ScrollView
            {...scrollIndicator}
            style={[styles.pickScroll, { maxHeight: Math.max(140, pickerCap - pickHeadHeight) }]}
            contentContainerStyle={styles.pickList}
            bounces={false}
          >
            <Pressable
              onPress={() => {
                haptics.tick();
                if (picking) setDecisions((d) => assign(d, picking, null));
                setPicking(null);
              }}
              style={[styles.pickRow, { borderColor: colors.line }]}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.muted} />
              <Text style={[type.body, { color: colors.ink }]}>{t('receipt.notOnList')}</Text>
            </Pressable>
            {pickerOptions(candidates, decisions, picking).map((c) => {
              const mine = picking != null && decisions.get(picking)?.itemId === c.id;
              /*
                A row another line holds is offered, not hidden — see
                pickerOptions. What it must not be is silent about it: tapping
                here MOVES the row, and the line that had it becomes "not on
                your list", so the shopper is told which line that is before
                they choose rather than discovering it afterwards.
              */
              const heldBy =
                c.takenBy == null
                  ? null
                  : run.purchases.find((p) => p.key === c.takenBy)?.raw[0] ?? null;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    haptics.tick();
                    if (picking) setDecisions((d) => assign(d, picking, c.id));
                    setPicking(null);
                  }}
                  style={[styles.pickRow, { borderColor: colors.line }]}
                >
                  <Ionicons
                    name={mine ? 'checkmark-circle' : 'cart-outline'}
                    size={20}
                    color={mine ? colors.accent : c.takenBy ? colors.muted : colors.accent}
                  />
                  <View style={styles.pickBody}>
                    <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {heldBy != null && (
                      <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                        {t('receipt.heldBy', { line: heldBy })}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </GlassView>
      </Sheet>
    </View>
  );
}

/**
 * A failed check, in the reader's own words and their own currency.
 *
 * ---------------------------------------------------------------------------
 * Why this is not the server's job
 * ---------------------------------------------------------------------------
 *
 * It was, and it showed. The reconciler wrote the sentence and the sheet
 * printed it, so a shopper holding a receipt that says €48,02 was told
 *
 *     ITEMS ADD UP TO 4827 BUT THE RECEIPT SAYS 5020
 *     THE LINES TOTAL 4718 BUT 4802 WAS PAID
 *
 * — cents as bare integers, and English, on a phone that might be running in
 * any of the seven languages this app ships. Neither is fixable on a server:
 * the decimal separator, the symbol and its position come from the reader's
 * locale, and so does the language. Both live here.
 *
 * The count case says the two numbers it accepts. That is deliberate: it looks
 * like hedging and it is the honest thing to print, because the chains genuinely
 * disagree about whether four cartons of milk are four articles or one, and a
 * message naming a single expected figure would be wrong for half of them.
 */

/**
 * A number you can tap and type over.
 *
 * ---------------------------------------------------------------------------
 * The dashed outline is the whole feature
 * ---------------------------------------------------------------------------
 *
 * Every figure on this screen was already editable and nothing said so: the
 * price was rendered as text in the same weight and colour as the name beside
 * it, and people do not tap text. The outline is the only thing that changed
 * about the affordance — the tap target, the parsing and the commit were all
 * already there.
 *
 * Dashed rather than solid because solid reads as a field that is already
 * yours, and most of these are the till's reading, correct as printed. A dashed
 * edge says "you may" rather than "you must".
 *
 * ---------------------------------------------------------------------------
 * One size in every state
 * ---------------------------------------------------------------------------
 *
 * Closed, open and empty are the same box. The chips sit in a row of three and
 * a row of three that reflows when one of them gains a cursor is a row that
 * moves under the finger arriving at it. So the border width does not change
 * between states either — only its colour and its dash.
 */
function EditChip({
  children,
  open,
  empty,
  text,
  onChangeText,
  onOpen,
  onDone,
  keyboardType,
  accessibilityLabel,
  colors,
}: {
  children: string;
  open: boolean;
  empty?: boolean;
  text: string;
  onChangeText: (text: string) => void;
  onOpen: () => void;
  onDone: () => void;
  keyboardType?: 'decimal-pad' | 'number-pad';
  accessibilityLabel: string;
  colors: { ink: string; muted: string; line: string; accent: string };
}) {
  if (open) {
    return (
      <View style={[styles.editChip, styles.editChipOpen, { borderColor: colors.accent }]}>
        <TextInput
          value={text}
          onChangeText={onChangeText}
          onBlur={onDone}
          onSubmitEditing={onDone}
          keyboardType={keyboardType}
          returnKeyType="done"
          autoFocus
          selectTextOnFocus
          style={[styles.chipInput, { color: colors.ink }]}
        />
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => {
        haptics.tick();
        onOpen();
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.editChip, { borderColor: empty ? colors.line : colors.accent }]}
    >
      <Text
        style={[styles.chipText, { color: empty ? colors.muted : colors.ink }]}
        numberOfLines={1}
      >
        {children}
      </Text>
    </Pressable>
  );
}

function phrase(
  p: ReceiptProblem,
  t: (key: string, options?: Record<string, unknown>) => string,
  money: (cents: number) => string,
): string {
  switch (p.code) {
    case 'line':
      return t('receipt.problemLine', { count: p.lines });
    case 'goods':
      return t('receipt.problemGoods', { got: money(p.got), printed: money(p.printed) });
    case 'paid':
      return t('receipt.problemPaid', { got: money(p.got), printed: money(p.printed) });
    case 'count':
      return t('receipt.problemCount', {
        units: p.units,
        lines: p.asLines,
        printed: p.printed,
      });
  }
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
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: 2,
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
  /*
   * Wide enough for three chips, fixed so it never shrinks.
   *
   * Fixed is the important half. The amount used to be a bare sibling of a text
   * column that had nothing stopping it growing, so a long product name ran
   * under the price and the two painted over each other. A reserved width gives
   * the name a boundary to wrap against.
   */
  amountCol: { width: 164, flexShrink: 0, alignItems: 'flex-end', gap: 5 },
  // Wraps rather than overflows: on a narrow phone the pack chip drops to a
  // second line and the group stays right-aligned, which still reads.
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 5,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  /*
   * One box in every state — closed, open and empty. The chips sit in a row of
   * three, and a row that reflows when one of them gains a cursor is a row that
   * moves out from under the finger arriving at it. So the padding and the
   * border WIDTH are constant here; only colour and dash change.
   */
  editChip: {
    minWidth: 44,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Open: the dashes resolve to a solid ring. Same width, same padding.
  editChipOpen: { borderStyle: 'solid' },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  chipInput: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    minWidth: 32,
    padding: 0,
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
  // flexShrink is the static half of the inline maxHeight — it is what lets the
  // cap actually squeeze the card rather than the card overflowing it.
  picker: { flexShrink: 1, overflow: 'hidden' },
  pickHead: { gap: 2, padding: spacing.lg, paddingBottom: spacing.sm },
  pickScroll: { flexGrow: 0, flexShrink: 1 },
  pickList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Takes the width so the "already on ..." line wraps to one truncated line
  // under the name rather than pushing the name out of the row.
  pickBody: { flex: 1 },
});

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardCode } from '@/components/card-code';
import { CardsSignInGate } from '@/components/cards-sign-in-gate';
import { EmptyState } from '@/components/empty-state';
import { FormatToggle } from '@/components/format-toggle';
import { Fab } from '@/components/fab';
import { GlassView } from '@/components/glass';
import { MeshBackground } from '@/components/mesh-background';
import { formatCardValue, formatOf } from '@/lib/barcode';
import { haptics } from '@/lib/haptics';
import { useLoyaltyCards, type LoyaltyCard } from '@/lib/loyalty-cards';
import { customInitials, getSupermarket, supermarketLabel } from '@/lib/supermarkets';
import { useAuth } from '@/store/auth';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * The card wallet — every loyalty card, stacked.
 *
 * Cards overlap so only each one's top strip shows, and the stack **rolls** as
 * you scroll: a card that reaches the top edge pins there and compresses into a
 * tight pile instead of scrolling away, so the chain you're looking for is
 * always reachable and you never lose your place in a long wallet. Scrolling
 * back down releases them again.
 *
 * Tapping a card opens it full-size, because the only moment that matters for
 * this feature is holding a phone up to a scanner at the till.
 *
 * These cards are device-local and private to the signed-in user — see
 * lib/loyalty-cards.ts for why, and how that's enforced.
 */

/** Vertical gap between resting cards: enough to read the store name. */
const STEP = 78;
/** Gap between cards once pinned at the top — a tight, overlapping pile. */
const PIN_STEP = 12;
/** Credit-card proportions, so it reads as a card at a glance. */
const CARD_ASPECT = 1.6;

export default function CardsScreen() {
  const { colors } = useTheme();
  const t = useT();
  const { user, initializing } = useAuth();
  // undefined while the session is still being restored, so someone who *is*
  // signed in never gets flashed the sign-in prompt on the way in.
  const { cards, loading, needsSignIn, removeCard, setCardFormat } = useLoyaltyCards(
    initializing ? undefined : user?.id ?? null,
  );
  const { width } = useWindowDimensions();
  const [openId, setOpenId] = useState<string | null>(null);

  const cardWidth = width - spacing.lg * 2;
  const cardHeight = Math.round(cardWidth / CARD_ASPECT);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  // Room for every card at its resting position, plus the last card's body.
  const stackHeight = cards.length > 0 ? (cards.length - 1) * STEP + cardHeight : 0;

  const open = cards.find((c) => c.id === openId) ?? null;

  const confirmRemove = (card: LoyaltyCard) => {
    Alert.alert(
      t('cards.removeTitle'),
      t('cards.removeBody', { store: supermarketLabel(card.store) ?? card.store }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('cards.remove'),
          style: 'destructive',
          onPress: () => {
            setOpenId(null);
            removeCard(card.id);
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
          <View style={styles.grow}>
            <Text style={[type.h2, { color: colors.ink }]}>{t('cards.title')}</Text>
            <Text style={[type.sub, { color: colors.muted }]} numberOfLines={2}>
              {cards.length > 0
                ? t('cards.countAndPrivacy', { count: cards.length })
                : t('cards.subtitle')}
            </Text>
          </View>
        </View>

        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            // The stack is absolutely positioned, so the scroll view needs an
            // explicit height to have anything to scroll.
            cards.length > 0 && { height: stackHeight + spacing.xxl * 3 },
          ]}
        >
          {needsSignIn ? (
            <CardsSignInGate />
          ) : (
            cards.length === 0 &&
            !loading && (
              <EmptyState
                icon="card-outline"
                title={t('cards.emptyTitle')}
                body={t('cards.emptyBody')}
              />
            )
          )}

          {cards.map((card, index) => (
            <StackedCard
              key={card.id}
              card={card}
              index={index}
              scrollY={scrollY}
              width={cardWidth}
              height={cardHeight}
              onPress={() => {
                haptics.tick();
                setOpenId(card.id);
              }}
            />
          ))}
        </Animated.ScrollView>
      </SafeAreaView>

      {/* Hidden until there's an account to attach a card to — the gate above
          is the way forward, not a Fab that would only bounce off it. Pushed
          route, so there's no tab bar to clear. */}
      {!needsSignIn && (
        <Fab
          label={t('cards.addCard')}
          onPress={() => router.push('/cards/add')}
          aboveTabBar={false}
        />
      )}

      {/* Full-size card, for holding up to a scanner. */}
      <Modal
        visible={open !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenId(null)}
      >
        {open && (
          <Pressable style={styles.backdrop} onPress={() => setOpenId(null)}>
            {/* Stop taps on the card itself from dismissing — a hand resting on
                the phone at the till shouldn't close it. */}
            <Pressable onPress={() => {}}>
              <GlassView radius={radii.lg} style={styles.openCard}>
                <View style={styles.openHead}>
                  <BrandMark store={open.store} size={34} />
                  <Text style={[type.h2, { color: colors.ink, flex: 1 }]} numberOfLines={2}>
                    {supermarketLabel(open.store) ?? open.store}
                  </Text>
                </View>

                <CardCode symbology={open.symbology} value={open.value} width={cardWidth - spacing.lg} />

                <Text style={[type.sub, { color: colors.muted, textAlign: 'center' }]}>
                  {t('cards.showAtTill')}
                </Text>

                {/* Fixable at the till, which is the point. Whether a chain reads
                    1D or 2D isn't in the number, so the first sign of a wrong
                    guess is usually a scanner refusing the card — and standing at
                    a checkout is the worst possible moment to have to re-add it. */}
                <FormatToggle
                  label={t('cards.wontScanLabel')}
                  value={formatOf(open.symbology)}
                  onChange={(format) => {
                    haptics.tick();
                    setCardFormat(open.id, format);
                  }}
                />

                <View style={styles.openActions}>
                  <Pressable onPress={() => confirmRemove(open)} hitSlop={8} style={styles.openAction}>
                    <Ionicons name="trash-outline" size={18} color={colors.crit} />
                    <Text style={[type.sub, { color: colors.crit }]}>{t('cards.remove')}</Text>
                  </Pressable>
                  <Pressable onPress={() => setOpenId(null)} hitSlop={8} style={styles.openAction}>
                    <Text style={[type.body, { color: colors.accent }]}>{t('common.done')}</Text>
                  </Pressable>
                </View>
              </GlassView>
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </View>
  );
}

/**
 * One card in the rolling stack.
 *
 * Resting position is `index * STEP`. As the list scrolls up, the card travels
 * with it until it would pass its pinned slot near the top, at which point it
 * stops — so cards accumulate into a compressed pile rather than disappearing.
 */
function StackedCard({
  card,
  index,
  scrollY,
  width,
  height,
  onPress,
}: {
  card: LoyaltyCard;
  index: number;
  scrollY: ReturnType<typeof useSharedValue<number>>;
  width: number;
  height: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const chain = getSupermarket(card.store);
  const label = supermarketLabel(card.store) ?? card.store;
  const brand = chain?.color ?? colors.surface;
  const ink = chain ? (chain.darkText ? '#1B2417' : '#FFFFFF') : colors.ink;

  const animated = useAnimatedStyle(() => {
    const rest = index * STEP;
    const pinned = index * PIN_STEP;
    const travelled = rest - scrollY.value;
    // The roll: clamp at the pinned slot instead of letting the card leave.
    const y = Math.max(travelled, pinned);
    // Shrink very slightly on the way into the pile, which reads as depth and
    // keeps the pinned cards from looking like a flat ladder.
    const scale = interpolate(
      travelled,
      [pinned, pinned + STEP],
      [0.96, 1],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateY: y }, { scale }] };
  });

  return (
    <Animated.View
      style={[
        styles.stacked,
        { width, height, zIndex: index },
        animated,
      ]}
    >
      <Pressable onPress={onPress} style={styles.fill}>
        <View style={[styles.face, { backgroundColor: brand, borderColor: colors.line }]}>
          <View style={styles.faceHead}>
            <BrandMark store={card.store} size={28} />
            <Text style={[type.body, { color: ink, flex: 1 }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
          {/* The number sits below the fold, visible only once this card is the
              bottom-most (fully revealed) one. */}
          <Text style={[type.price, { color: ink, opacity: 0.85 }]} numberOfLines={1}>
            {formatCardValue(card.symbology, card.value)}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Brand monogram on a plate that works on top of the brand colour itself —
 * SupermarketBadge fills with the brand colour, which would vanish against a
 * card face painted the same colour.
 */
function BrandMark({ store, size }: { store: string; size: number }) {
  const chain = getSupermarket(store);
  const initials = chain?.initials ?? customInitials(store);
  const { colors } = useTheme();
  const onBrand = Boolean(chain);

  return (
    <View
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: onBrand ? 'rgba(255,255,255,0.9)' : colors.accentSoft,
        },
      ]}
    >
      <Text
        style={[
          styles.markText,
          { fontSize: size * 0.4, color: onBrand ? '#1B2417' : colors.accent },
        ]}
        numberOfLines={1}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  grow: { flex: 1, minWidth: 0 },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  scrollContent: { paddingHorizontal: spacing.lg, flexGrow: 1 },
  // left: 0 is the *padding* edge, not the border edge — absolute children are
  // positioned inside the container's padding. Adding spacing.lg again here
  // would double the inset and push each card off the right side.
  stacked: { position: 'absolute', left: 0, top: 0 },
  face: {
    flex: 1,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    justifyContent: 'space-between',
    // A real shadow is what separates one card from the next in the pile.
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 6,
  },
  faceHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { alignItems: 'center', justifyContent: 'center' },
  markText: { fontWeight: '800' },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12,18,10,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  openCard: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  openHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'stretch',
  },
  openActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    paddingTop: spacing.xs,
  },
  openAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
});

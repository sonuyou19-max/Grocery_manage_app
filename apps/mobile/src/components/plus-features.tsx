import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { PLUS_ALSO, PLUS_PILLARS } from '@/lib/plus-pillars';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * What Plus does, as three swipeable pillars. The one view, used everywhere.
 *
 * ---------------------------------------------------------------------------
 * Paging by measurement, not by assumption
 * ---------------------------------------------------------------------------
 *
 * The page width is the window width, and every offset derives from it: the
 * card is inset from the page rather than the page being sized to the card. The
 * alternative — a fixed card width with computed gaps — is the same mistake the
 * tab bar's highlight made, where the arithmetic was right about a layout the
 * renderer wasn't producing. Here `pagingEnabled` and the dot index both read
 * the same number the ScrollView is actually using.
 *
 * ---------------------------------------------------------------------------
 * Why the cards are the surface colour and not a bright fill
 * ---------------------------------------------------------------------------
 *
 * A saturated slide per pillar looks better in a mockup and worse in the app:
 * Korb's accent is green, Plus owns a violet gradient, and three more full-bleed
 * colours would make the paywall the only screen speaking a fourth visual
 * language. The gradient stays where it means something — the pillar's icon and
 * the seam along the card's top edge — so the eye still reads "this is the paid
 * thing" without the screen shouting.
 */

export function PlusFeatures() {
  const { colors } = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Rounded against the same width the pages are laid out at, so a half-swipe
    // that springs back cannot leave the dots reporting a page nobody is on.
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) setPage(next);
  };

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Negative margin cancels the parent's padding so a page is a full
        // screen width; the inset below puts the visible gutter back.
        style={styles.rail}
      >
        {PLUS_PILLARS.map((pillar) => (
          <View key={pillar.id} style={[styles.page, { width }]}>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <LinearGradient
                colors={[colors.plusFrom, colors.plusTo]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.seam}
              />
              <View style={styles.head}>
                <LinearGradient
                  colors={[colors.plusFrom, colors.plusTo]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.mark}
                >
                  <Ionicons name={pillar.icon} size={16} color="#FFFFFF" />
                </LinearGradient>
                <View style={styles.grow}>
                  <Text style={[type.label, { color: colors.plusInk }]}>
                    {t(`plus.pillar.${pillar.id}Title`)}
                  </Text>
                  <Text style={[type.sub, { color: colors.muted }]}>
                    {t(`plus.pillar.${pillar.id}Kicker`)}
                  </Text>
                </View>
              </View>

              {pillar.features.map((f) => (
                <View key={f.id} style={styles.feature}>
                  <Ionicons name={f.icon} size={18} color={colors.accent} style={styles.featureIcon} />
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: colors.ink }]}>
                      {t(`plus.detail.${f.id}Title`)}
                    </Text>
                    <Text style={[type.sub, { color: colors.muted }]}>
                      {t(`plus.detail.${f.id}Body`)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {PLUS_PILLARS.map((pillar, i) => (
          <View
            key={pillar.id}
            style={[
              styles.dot,
              {
                backgroundColor: i === page ? colors.plusInk : colors.line,
                width: i === page ? 18 : 6,
              },
            ]}
          />
        ))}
      </View>

      {/* Said once, quietly, so "Plus has ten things" stays literally true on
          the screen where somebody decides to pay for them. */}
      <Text style={[type.sub, styles.also, { color: colors.muted }]}>
        {t('plus.alsoIncluded', {
          list: PLUS_ALSO.map((f) => t(`plus.also.${f.id}`)).join(t('common.listJoin')),
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { marginHorizontal: -spacing.lg },
  page: { paddingHorizontal: spacing.lg + spacing.sm },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    padding: spacing.lg,
    gap: spacing.md,
  },
  seam: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  mark: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  feature: { flexDirection: 'row', gap: spacing.md },
  // Nudged to sit on the title's cap height rather than centred on the block,
  // which drifts low the moment a body wraps to three lines in German.
  featureIcon: { marginTop: 2 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.md },
  dot: { height: 6, borderRadius: 3 },
  also: { textAlign: 'center', marginTop: spacing.md },
});

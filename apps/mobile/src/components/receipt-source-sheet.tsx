import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { PressScale } from '@/components/press-scale';
import { Sheet, SheetHandle, useSheetDismiss } from '@/components/sheet';
import { haptics } from '@/lib/haptics';
import { MAX_SHOTS } from '@/lib/receipt-capture';
import type { ReceiptSource } from '@/lib/receipt-source';
import { useLocale } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * Where is the receipt?
 *
 * ---------------------------------------------------------------------------
 * Why a middle layer at all
 * ---------------------------------------------------------------------------
 *
 * "Scan receipt" used to open the camera, which is right exactly when a till
 * printed something. Increasingly one has not: Colruyt, Carrefour and Aldi will
 * all email a PDF instead, and a shopper who chose the paperless option has a
 * receipt the camera cannot help with. Photographing a phone screen is not a
 * workaround — it is a moiré pattern with prices in it.
 *
 * So the button asks first. Three answers, and the order is the frequency: most
 * receipts are still paper and in your hand, so the camera stays the top row
 * and the one a thumb reaches without reading.
 *
 * ---------------------------------------------------------------------------
 * The sheet decides nothing
 * ---------------------------------------------------------------------------
 *
 * Every row hands off to the same route with a different `source`, and the
 * picking happens there. That is deliberate: the intake screen already owns the
 * progress overlay, the one-message-for-every-failure rule, and the hand-off to
 * the review sheet. A picker launched from here would need all three again, and
 * two copies of "what happens when a scan fails" is how they come to disagree.
 *
 * `useSheetDismiss` rather than onClose-then-navigate: this is inside a Modal,
 * and pushing a route while one is up puts the new screen underneath it on
 * Android. See lib/modal-nav, which exists because that shipped four times.
 */
export function ReceiptSourceSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (source: ReceiptSource) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} scrim gutter={0} motion="slide">
      <Body onPick={onPick} />
    </Sheet>
  );
}

/**
 * Inside the Sheet, so it can call useSheetDismiss.
 *
 * The hook throws outside a <Sheet>, which is the point of it — but that means
 * it cannot be called in the component that renders the Sheet.
 */
function Body({ onPick }: { onPick: (source: ReceiptSource) => void }) {
  const { colors } = useTheme();
  const { t } = useLocale();
  const dismiss = useSheetDismiss();

  const rows: { source: ReceiptSource; icon: keyof typeof Ionicons.glyphMap }[] = [
    { source: 'camera', icon: 'camera-outline' },
    { source: 'photos', icon: 'images-outline' },
    { source: 'file', icon: 'document-text-outline' },
  ];

  return (
    <Card style={styles.card}>
      <SheetHandle />
      <Text style={[type.h2, { color: colors.ink }]}>{t('receiptSource.title')}</Text>
      <Text style={[type.sub, { color: colors.muted }]}>{t('receiptSource.hint')}</Text>

      {rows.map(({ source, icon }) => (
        <PressScale
          key={source}
          onPress={() => {
            haptics.tick();
            // Closed FIRST, and the navigation runs once the window is really
            // gone. Every branch here leaves this screen.
            dismiss(() => onPick(source));
          }}
          accessibilityRole="button"
          style={[styles.row, { borderColor: colors.line }]}
        >
          <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name={icon} size={20} color={colors.accent} />
          </View>
          <View style={styles.grow}>
            <Text style={[type.body, { color: colors.ink }]}>
              {t(`receiptSource.${source}Title`)}
            </Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {t(`receiptSource.${source}Hint`, { max: MAX_SHOTS })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </PressScale>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1, minWidth: 0, gap: 2 },
});

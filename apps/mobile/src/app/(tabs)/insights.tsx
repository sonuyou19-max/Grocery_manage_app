import { Text } from 'react-native';

import { Card } from '@/components/card';
import { Pill } from '@/components/pill';
import { Screen } from '@/components/screen';
import { type, useTheme } from '@/theme';

/**
 * Insights: budget control appears only for households that log prices.
 * With no prices logged, this tab shows shopping-habit insights instead —
 * pricing is always optional, never a nag.
 */
export default function InsightsScreen() {
  const { colors } = useTheme();

  return (
    <Screen title="Insights" subtitle="Spending & habits">
      <Card>
        <Pill label="No prices logged yet" tone="warn" />
        <Text style={[type.bodyRegular, { color: colors.ink }]}>
          Korb shows weekly spend, price history per store, and saving tips here — but only
          if you choose to log prices. Until then, this tab will show your shopping habits:
          most-bought items and trip frequency.
        </Text>
      </Card>
    </Screen>
  );
}

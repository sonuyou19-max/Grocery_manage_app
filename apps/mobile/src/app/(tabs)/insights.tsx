import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

/**
 * Insights: budget control appears only for households that log prices.
 * With no prices logged, this tab shows a clear explanation rather than empty
 * charts — pricing is always optional, never a nag.
 */
export default function InsightsScreen() {
  return (
    <Screen title="Insights" subtitle="Spending & habits">
      <EmptyState
        icon="trending-up-outline"
        title="Log a price to unlock spending"
        body="Add prices to items as you shop and Korb shows weekly spend, price history per store, and saving tips here. Prices are always optional — until you add some, this stays out of your way."
      />
    </Screen>
  );
}

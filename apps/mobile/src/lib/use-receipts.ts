import { useCallback, useEffect, useState } from 'react';

import { listReceipts, type ReceiptSummary } from '@/lib/receipt-archive';
import { useHousehold } from '@/store/household';

/**
 * This household's scanned receipts.
 *
 * ---------------------------------------------------------------------------
 * Fetched on focus, not held in a store
 * ---------------------------------------------------------------------------
 *
 * Every other list in this app lives in a context because something writes to
 * it constantly — a tick, a swipe, a housemate's phone. Receipts are written
 * twice in their whole life: once when scanned, once if corrected. A realtime
 * subscription and a cache for that would be machinery guarding against a
 * change that happens about as often as the screen is opened.
 *
 * What it does need is to be re-read when the screen comes back, because the
 * change that matters is the one the user just made two screens away: correct a
 * receipt, come back, and a stale list would still show it as never edited.
 * Hence `reload`, called on focus by the screens that show this.
 */
export function useReceipts(limit = 50): {
  receipts: ReceiptSummary[];
  loading: boolean;
  reload: () => void;
} {
  const { activeId } = useHousehold();
  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);
  // True until the first answer, so an empty household and one that has not
  // replied yet do not both render as "no receipts". They are different
  // sentences and only one of them is worth showing.
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!activeId) {
      setReceipts([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void listReceipts(activeId, limit).then((rows) => {
      if (!alive) return;
      setReceipts(rows);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [activeId, limit, nonce]);

  return { receipts, loading, reload };
}

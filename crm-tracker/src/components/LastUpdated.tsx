import { Clock } from 'lucide-react';
import { useData } from '../state/DataContext';
import { syncEnabled } from '../lib/sync/api';
import { formatUpdatedDay } from '../lib/sync/lastUpdated';

const full = (iso: string): string => new Date(iso).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST';

/**
 * "Last Updated: 2 November 2026": the time the data on screen was last published (the published version's own timestamp).
 * It does not move when the page is opened or refreshed. Without that metadata it says "Not available" rather than guessing.
 */
export function LastUpdated() {
  const { lastUpdated, published, loading } = useData();
  // until the first look at the published version has answered, the embedded date would only flash before the real one
  const checking = loading || (published.state === 'unknown' && syncEnabled());
  const text = checking ? '…' : formatUpdatedDay(lastUpdated.at) || 'Not available';
  const title = lastUpdated.at ? `${full(lastUpdated.at)} · ${lastUpdated.source === 'published' ? 'published version' : 'data embedded in this page'}` : 'No update metadata is available';
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-2" title={title} data-testid="last-updated" aria-live="polite">
      <Clock size={12} aria-hidden />
      <span>Last Updated: {text}</span>
    </div>
  );
}

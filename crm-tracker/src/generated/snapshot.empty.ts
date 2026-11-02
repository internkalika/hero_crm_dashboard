// Default build (Netlify): no data is embedded. The single-file HTML build replaces this module with
// snapshot.data.ts, which `npm run snapshot` generates from the MIS files.
import type { SnapshotBundle } from '../lib/store/snapshot';

export const SNAPSHOT: SnapshotBundle | null = null;

// Default build: no Usage Report is embedded. The single-file build swaps this module for usage.data.ts,
// which scripts/extract-from-deployed.mjs generates.
export const USAGE_REPORT: string | null = null;

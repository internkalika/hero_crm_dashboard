// "Last Updated" comes from publication metadata only: the published version's own timestamp, or (before anything was ever
// published) the build date of the data embedded in the page. It is never the time of a visit, a refresh or a local import.
export interface LastUpdated {
  at: string | null;
  source: 'published' | 'embedded' | null;
}

export function resolveLastUpdated(publishedAt: string | null | undefined, embeddedBuiltAt: string | null | undefined): LastUpdated {
  if (publishedAt && !Number.isNaN(Date.parse(publishedAt))) return { at: publishedAt, source: 'published' };
  if (embeddedBuiltAt && !Number.isNaN(Date.parse(embeddedBuiltAt))) return { at: embeddedBuiltAt, source: 'embedded' };
  return { at: null, source: null };
}

/** "2 November 2026" in Indian time (the business's day), or null for a missing or unreadable timestamp. */
export function formatUpdatedDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

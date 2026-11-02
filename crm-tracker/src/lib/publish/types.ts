// Shapes shared by the publish workflow: the browser (Data Management) and the Vercel functions use the same ones.
import type { DatasetMeta } from '../types.js';

/** What the public snapshot API tells a viewer about one dataset of the published version. */
export interface PublishedDataset {
  id: string;
  source: string;
  scope: string;
  fileName: string;
  period: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  records: number;
  /** sha-256 (hex) of the sanitized, gzipped dataset JSON: the content address, also the cache key */
  sha256: string;
  /** size of the gzipped file */
  bytes: number;
  importedAt: string;
}

/** Counts the server computed for one dataset when a version was published (against the version it replaced). */
export interface DatasetChange {
  id: string;
  status: 'new' | 'changed' | 'unchanged' | 'removed';
  inserted: number;
  updated: number;
  /** records of the previous version that the new one no longer has (replace) */
  removed: number;
  unchanged: number;
  /** rows the importer set aside (duplicates + invalid) when the file was read */
  rejected: number;
  mode: DatasetMeta['mode'];
  sanitized: { tokenisedKeys: number; scrubbedValues: number };
}

export type VersionAction = 'publish' | 'rollback' | 'initial';

export interface VersionManifest {
  schema: 1;
  versionId: string;
  createdAt: string;
  action: VersionAction;
  /** the version this one was made from (null for the first) */
  parent: string | null;
  /** for a rollback: the version whose datasets were restored */
  restoredFrom?: string;
  note: string;
  datasets: PublishedDataset[];
  changes: DatasetChange[];
}

/** current.json: the only mutable object of the store. Everything it points to is immutable. */
export interface CurrentPointer {
  schema: 1;
  versionId: string;
  publishedAt: string;
}

export interface SnapshotStatus {
  configured: boolean;
  version: Pick<VersionManifest, 'versionId' | 'createdAt' | 'action' | 'note' | 'datasets'> | null;
  publishedAt: string | null;
}

export interface VersionSummary {
  versionId: string;
  createdAt: string;
  action: VersionAction;
  parent: string | null;
  restoredFrom?: string;
  note: string;
  datasets: number;
  records: number;
  current: boolean;
}

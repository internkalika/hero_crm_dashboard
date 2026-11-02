// Dataset <-> bytes. A published dataset is the sanitized payload as JSON, gzipped; its sha-256 is its address.
import type { DatasetPayload } from '../types.js';

async function pump(input: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([input as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

export const gzip = (bytes: Uint8Array) => pump(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes: Uint8Array) => pump(bytes, new DecompressionStream('gzip'));

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function encodeDataset(p: DatasetPayload): Promise<{ bytes: Uint8Array; sha256: string; jsonBytes: number }> {
  const json = new TextEncoder().encode(JSON.stringify({ meta: p.meta, records: p.records, issues: p.issues }));
  const bytes = await gzip(json);
  return { bytes, sha256: await sha256Hex(bytes), jsonBytes: json.byteLength };
}

export async function decodeDataset(bytes: Uint8Array): Promise<DatasetPayload> {
  const o = JSON.parse(new TextDecoder().decode(await gunzip(bytes))) as DatasetPayload;
  return { ...o, raw: [] };
}

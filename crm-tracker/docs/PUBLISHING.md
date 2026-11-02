# Publishing: private Blob store, public read-only API

Administrators import files in **Data Import** (Replace / Merge / Skip, worksheet selection, validation: unchanged), check the dashboards, then
publish from **Data Management**. Everyone else sees the new data within about a minute, without signing in and without a redeploy.

```
 administrator's browser                       Vercel                               private Blob store
 ──────────────────────                       ────────                              ──────────────────
 import (IndexedDB) ──review──► POST /api/admin/stage (≤3.5 MB parts) ─────────────► staging/<upload>/<n>
                    └─publish─► POST /api/admin/publish ─ validate + sanitize ─────► datasets/<sha256>.json.gz   (immutable)
                                    (cookie + CSRF)       manifest ────────────────► versions/<id>/manifest.json (immutable)
                                                          compare-and-swap ────────► current.json                (the only mutable object)
 viewer's browser
 ────────────────
 every 60 s + on refocus ─► GET /api/snapshot (status, ETag)        ◄── reads current.json + manifest
                         └► GET /api/dataset?sha=…  (only datasets of the CURRENT version, streamed, never a Blob URL)
```

* **The store is private.** Only the server holds `BLOB_READ_WRITE_TOKEN`. Viewers get data through the two read-only endpoints, which stream from the store.
* **Viewers keep working without the service**: the page embeds a sanitized snapshot, used until a publish succeeds and whenever the API is unreachable. Published datasets override embedded ones with the same id; the others stay.
* **First visit after this feature arrives:** whatever a browser already holds counts as published-clean, so a viewer receives updates. An administrator who imported files in an earlier build and has not published them should publish them *before* opening the new version, or the first sync replaces those datasets with the published copy.
* **An unpublished local import is never overwritten** by a sync (the check is repeated right before each dataset is written) (it is listed in Data Management with Publish / Discard). A viewer's own removal of a dataset counts as a pending change in the same way.

## What a publish does

1. The browser gzips each chosen dataset (no raw rows) and uploads it in parts (an upload id per dataset; a part is ≤ 3.5 MB, below the 4.5 MB request limit).
2. The server reassembles it, checks the checksum, unzips with a size cap, **validates** it (source known, id = source:scope, unique keys, required fields), **sanitizes** it with its own secret, and refuses it if any personal data is left. It never trusts what the browser sent.
3. It stores each dataset under its SHA-256 (identical content is stored once and shared between versions), computes inserted / updated / removed / unchanged against the version it replaces, writes the manifest, then **moves `current.json` last with a compare-and-swap** on its ETag.
4. A publish carries the version it was reviewed against. If anyone published in between the server answers `409` and changes nothing.

Rollback publishes an older version again as a **new** version (history is linear and never rewritten). Only versions that were really live (the current one and its ancestors) are listed or restorable: a publish that lost a race leaves no version behind. Data that a rollback replaced is no longer served: the dataset endpoint checks the current version on every request and is never cached for long (browsers revalidate, Vercel's CDN keeps a copy for a minute). Copies a viewer already downloaded stay in that viewer's browser until their next sync.

### What the sanitizer changes (checked on the real 18 datasets)

| What | Treatment |
|---|---|
| raw source rows | never published |
| Hero Smiles `key` / `entityKey` of *unverified* members contained the **full mobile number** (10 rows in 5 snapshots) | replaced by a one-way token (HMAC-SHA-256 with `CRM_PUBLISH_PEPPER`). Those rows are never joined to other data, so no figure changes. The masked display field (`91••••••3087`) is untouched |
| mobile numbers / e-mail addresses in free text (1 complaint description) | replaced by `[removed]`. Recognised: +91 / 91 / 0 prefixes, spaces, dots or hyphens between digits, numbers glued to words (`Ramesh-98…`) |
| fields named like contact details (`mobileNo`, `phoneNumber`, `contact…`, `…email…`) | always scrubbed, even a number typed into a numeric cell, whatever the name ends with |
| code fields (…Id, …Code, …Key, …No, …Number, …Ref, ticket) | left alone: they join datasets (unless the value holds an e-mail address) |
| **dealer and staff names** | **kept**: the dashboards rank and list them. Decide whether that is acceptable for a public page |

Other numeric cells are not scanned (an order value is not a phone number). The embedded fallback goes through the same sanitizer when it is built. **Note:** the repository's existing root `index.html` (the deployed file) still contains the unsanitized data.

## Security model

| Control | Where |
|---|---|
| Shared administrator secret, compared in constant time; never stored, logged or returned | `server/auth.ts` |
| Session: signed (HMAC-SHA-256, separate `CRM_SESSION_SECRET`), `HttpOnly; SameSite=Strict; Path=/api; Secure` (https), 8 h by default | `server/auth.ts` |
| Logout revokes the session id in the store, so a copied cookie stops working | `server/handlers/logout.ts` |
| State-changing calls need the cookie **and** `X-CRM-Admin: 1` **and** a same-origin request (`Origin`, `Sec-Fetch-Site`) | `assertSameOrigin` |
| Login throttle: each attempt is counted **before** the secret is checked, with a compare-and-swap on a counter in the store, so a parallel burst cannot out-run it; 5 attempts / 15 min per client address; if the counter cannot be stored the sign-in is refused; a short delay on a failure; 300 requests / min per session | `reserveLoginAttempt` |
| Secrets exist only in server environment variables; the front-end bundle is checked for them in the end-to-end test | `tools/compat/e2e_publish.cjs` |
| Public endpoints return no store URLs, no credentials, nothing but sanitized datasets of the current version; an unauthenticated caller is not told which settings are missing (the names go to the server log) | `server/handlers/snapshot.ts`, `dataset.ts` |
| CSP, HSTS, frame and referrer headers | `vercel.json` |

**Limits to know.** Address-based throttling cannot stop a distributed attack: add a Vercel Firewall rate-limit rule for `/api/admin/login` (for example 10 per minute per IP) for a hard guarantee. A shared secret has no per-person audit trail: the history records *when* and the note, not *who*. Dataset blobs are never deleted automatically (history and rollback depend on them); remove old ones in the Blob dashboard if storage matters.

## Setting it up on Vercel (a separate project, so production is untouched)

1. **New Vercel project** from this repository. *Root Directory*: `crm-tracker`. Leave *Include source files outside of the Root Directory* **on** (the build reads `../index.html`, the deployed single file, to build the embedded fallback). Framework preset Vite; `vercel.json` sets build and output.
2. **Storage → Create → Blob**, access **Private**, connect it to the project (this adds `BLOB_READ_WRITE_TOKEN`). Use a different store for Preview and Production if you want them apart.
3. **Environment variables** (Production and Preview):

| Variable | Value |
|---|---|
| `CRM_ADMIN_SECRET` | the shared administrator secret, ≥ 16 characters (`openssl rand -base64 24`) |
| `CRM_SESSION_SECRET` | ≥ 32 random characters (`openssl rand -base64 48`) |
| `CRM_PUBLISH_PEPPER` | ≥ 32 random characters, different from the others, **keep it stable** (it makes the anonymous tokens repeatable) |
| `CRM_BLOB_PREFIX` | optional, default `crm-tracker` |
| `CRM_SESSION_HOURS` | optional, default 8 |

4. Push the branch: Vercel builds a **preview** (`npm run build:vercel`). Open `/admin`: until the variables exist it says publishing is not set up; viewers are unaffected.
5. Firewall rule for `/api/admin/login` (see above).

Local rehearsal without Vercel: `npm run build:vercel`, then `CRM_STORE_DIR=.local-store CRM_ADMIN_SECRET=… CRM_SESSION_SECRET=… CRM_PUBLISH_PEPPER=… npm run dev:server` (a directory plays the Blob store).

## Verification in this repository

| Check | Command |
|---|---|
| unit / integration (importer, sanitizer, server, sync): 164 tests | `npm test` |
| server import graph valid for Node ESM (what Vercel runs) | `npm run typecheck:server` |
| browser end-to-end: wizard, review, publish, viewer refresh, history, rollback, concurrent publishes, fallback, login limits | `npm run build:vercel && node tools/compat/e2e_publish.cjs` |
| deployed page vs rebuilt page | `tools/compat/README.md` |

**Not verified here:** anything against a real Vercel deployment or a real Blob store (no credentials in this environment): the private-store calls (`put` with `ifMatch`, `get`, `list`, `head`) follow the SDK 2.8.2 types and are exercised only against the directory store, and the web-standard function signature (`export function GET/POST`) is the documented Vercel one but has not been run by Vercel's builder. The first preview deployment is the real test.

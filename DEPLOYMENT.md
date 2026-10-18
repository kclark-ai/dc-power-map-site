# Deploying the resource map

This is a static Astro site. There is no database, server runtime, or account system. A CDN can cache the compiled assets and JSON snapshots; traffic does not trigger server-side computation. Map rendering and search run in the browser. Mapbox tile requests have separate account usage and billing limits.

## Build and release

1. Use Node 22.22.0 or newer (`.nvmrc` pins the tested Node 22 version).
2. Run `npm ci` from this repository.
3. Set `PUBLIC_MAPBOX_TOKEN` in the hosting build environment. It is intentionally browser-visible. Restrict the token’s allowed URLs to the intended domain and permitted preview/local domains in Mapbox. Never put a secret Mapbox token in a `PUBLIC_` variable.
4. Run `npm run release:check`. This checks token presence, Astro/TypeScript, shared-link tests, data integrity, evidence checksums, production build, and high/critical dependency findings. It does not verify actual token permissions, upstream factual accuracy, or hosting configuration.
5. Publish the generated `dist/` directory using the existing static hosting provider. Preserve `/evidence/` routing and serve JSON and `_astro/` assets without SPA rewrites. No hosting credentials are stored in this repo.
6. Before public release, open a shared campus/history link on the deployed domain, verify tiles, search, water panels, source links, and the evidence register on desktop and mobile.

`public/_headers` supplies security and cache rules for hosts that support that file (including Netlify/Cloudflare Pages). Other hosts must apply equivalent rules themselves. Serve HTML and evidence JSON with revalidation; hashed `_astro/` assets may be cached immutably. Use HTTPS. Mapbox attribution must remain visible. No analytics or tracking system was added.

## Review and rollback

The GitHub workflow runs checks, tests, build, and a dependency audit for pushes and PRs. It does not publish. Set `PUBLIC_MAPBOX_TOKEN` as a repository build secret if production-like map assets are desired in CI. Deployment uses the hosting provider's build-time variable.

Keep the last verified static artifact or hosting deployment so rollback restores its HTML, assets, and JSON together. Publish atomically. Shared links contain the selected record, tab, layer filters, watershed scale, and map camera; they use stable inventory IDs.

## Extending coverage

- Add disclosures to `src/data/water-disclosures.json` with primary-source URL, reporting period, units, and curated facility associations. Location totals are never duplicated into campus sums.
- Add documented supplier/intake/treatment/return relationships with separate reference dates. Do not infer water supply from nearest rivers, campus drainage, or groundwater proximity.
- Rebuild `public/watersheds.json` using `scripts/fetch-watersheds.py` when associations change, the script also regenerates `src/data/watershed-index.json` for search.
- Add monitored history only after documenting station relevance, operation dates, coverage, units, approval flags, and confounders. Missing years cannot be silently filled.
- Run `node scripts/audit-data.mjs` only after reviewing data changes; this updates the checksum snapshot. Run `npm run verify` before accepting the changes.
- A future current EIA import must preserve original plant/generator identifiers, source files, release dates, and reproducible transformation code. Current inherited power records still lack this lineage.

## Scale limits

The current ~1,500 facility and ~15,000 plant records fit the browser map with clustering. Watershed geometries load only as needed and are deduplicated by HUC for drawing; facility-to-disclosure lookup is indexed. Avoid adding full national detailed watershed geometry to a single JSON file: move to vector tiles or bounded queries when geography expands. Large time-series data should be fetched per station and summarized server-side during ingestion, with versioned snapshots. Do not add a database solely to serve the current static dataset.

This release is an independent research preview. Technical readiness does not imply complete coverage or independent verification of inherited inventory fields. See `/evidence/` for the public limits.

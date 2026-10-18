# Data Center Resource Map

An independent research preview by Kevin Clark. Explore an inherited US facility inventory, electricity-generation context, selected reported water use, documented supply relationships, and watershed geography. `/evidence/` explains sources, reporting periods, missing fields, and limitations.

## Local development

Use Node >=22.22.0 (`nvm use` reads `.nvmrc`).

```sh
npm ci
cp .env.example .env.local
# Set the existing public Mapbox token in .env.local.
npm run dev
```

Astro may background development when invoked by an agent; `npm run dev -- --ignore-lock` runs in the foreground. Only the Mapbox token is needed. No database, analytics, or server credentials are required. Never commit `.env.local`.

## Quality and deployment

```sh
npm run check          # Astro + TypeScript
npm run test           # shared-view parsing, data checks, reviewed checksums
npm run verify         # checks + tests + static production build
npm run release:check  # configuration + verify + dependency audit
```

The deployable static output is `dist/`. See [DEPLOYMENT.md](DEPLOYMENT.md) for hosting, cache/security headers, token restrictions, rollback, and scale limits. The GitHub workflow validates changes without publishing. The public Mapbox token must be set in the hosting build environment.

## Experience

- Persistent Overview, Water, and Energy views.
- Facility tabs for Overview, Water, History, and Sources, with keyboard tab navigation.
- Mobile bottom sheet that collapses to expose the map.
- Water disclosures sorted by consumption; search by location, operator, watershed name, or HUC.
- Shared links retain stable facility ID, selected tab, camera, watershed level, layers, and fuel filters.
- Evidence labels distinguish reports, inventory fields, geographic context, and unknowns.
- Map engine loads separately; water geography is fetched when needed. Current snapshots are suitable for static CDN hosting; national high-resolution geometry should use tiles rather than a growing monolithic file.

## Data and methodology

The retained inventory has 1,499 facility records. The inherited 2023 plant snapshot has 14,793 rows; six displayed fuel categories contain 11,159 rows. These are record counts, not independently verified unique active facilities/plants. Newer EIA data has not been imported with reproducible lineage.

Water coverage is 26 Google US reporting locations for 2025, with 16 curated map associations and three separately documented supply references. Daily figures are annual averages; repeated campus views must not be summed. Historical Columbia River discharge at The Dalles is regional context, not a campus water-supply monitor or an attribution study.

`scripts/audit-data.mjs` regenerates `public/evidence-audit.json` after reviewed changes. `scripts/validate-water.mjs` checks associations, quantities, watershed hierarchy, and historical coverage. `scripts/check-evidence.mjs` rejects unreviewed data changes whose checksums no longer match the public evidence snapshot. `WATER-DATA.md` records detailed methodology and review history.

Unsupported risk scores, campus PPA assertions, inferred campus electricity mix, 50 MW demand assumptions, and synthetic CO2 totals are withheld. Missing evidence means unknown, not zero.

### Grid context and comparisons

Facilities, Energy, Grid and Water are peer views. Grid overlays load local GeoJSON only when selected; no boundary overlay is enabled by default. `src/data/grid-manifest.json` records source endpoints, original source dates, simplification and SHA-256 hashes. The four datasets are historical snapshots: NERC regions/subregions (2010), ISO/RTO footprints (2020), planning areas (2019), and retail territories (2015–2019). Retired NERC entities remain in the source and are deliberately labeled historical. These are not present operational boundaries or confirmed electrical relationships.

`python3 scripts/fetch-grid-context.py` downloads the public snapshots through system curl with TLS verification. Review metadata before refreshing; updating the hosting copy does not establish a newer boundary vintage. `npm test` verifies grid file integrity, geometry bounds, point-in-polygon holes, and shared grid state.

Facility Grid tabs separate inherited inventory MW and utility fields from measured demand, IT load, requested connection, study status and energization. Geographic matches are lazy, bounding-box filtered and explicitly unconfirmed. Region exports include source metadata and intersecting inventory records; comparison supports up to three facilities and JSON evidence export, with repeated water-reporting locations flagged. No MW or water totals are aggregated. Live demand, forecasts, upgrade capacity and queues are linked to primary resources but are not imported into this release. Comparisons are session-local, not persisted in shared URLs.

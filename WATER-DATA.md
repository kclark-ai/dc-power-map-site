# Water evidence and inventory review

Reviewed October 16, 2026. This update does not claim complete nationwide water-source or consumption coverage.

## Water figures

Source: [Google 2026 Environmental Report, page 97](https://sustainability.google/files/1699a2e19277e478b38a659f00cb38398a836e8c/download-1699a2e1.pdf#page=97), “Water use by data center location”, reporting calendar year 2025.

- 26 US reporting locations, transcribed from the annual table. These are Google location/campus totals, not individual building meter readings.
- Units retained in source data: million US gallons per year.
- Displayed daily average = annual million gallons × 1,000,000 ÷ days in reporting year (365 for 2025). Derived averages use approximate labels because annual figures are rounded.
- Withdrawal and consumption are distinct. Consumption is withdrawal less discharge. These figures describe onsite water, excluding electricity-generation water use.
- No daily telemetry, peak demand or estimates from facility MW are implied.
- No fleet-average water intensity is assigned to unidentified facilities.
- No national total is calculated from these selected records.
- Curated facility associations identify the reporting location context. Multiple records may refer to one reported campus total. They must never be summed as separate consumption values.
- Unmatched locations remain in the searchable report list without fabricated map coordinates.

## Water sources

Three reporting locations have source references:

- **The Dalles, Oregon:** Google's [April 2023 water profile](https://www.gstatic.com/gumdrop/sustainability/2023-data-center-water-profile-the-dalles.pdf) discusses municipal supply, local streams and groundwater. The profile is dated; it does not establish 2025 source proportions or current completion of planned infrastructure.
- **Council Bluffs, Iowa:** [MidAmerican Energy](https://www.midamericanenergy.com/datacenters/water) identifies the Missouri River floodplain aquifer. Source proportions are not provided.
- **Douglas County, Georgia:** the 2025 report separates potable and reclaimed wastewater withdrawals. Google's [2012 facility account](https://green.googleblog.com/2012/03/helping-hooch-with-water-conservation.html) describes its local water authority reuse-water system. The historical account is not presented as a current 100% reclaimed-water claim.

Other water sources remain unknown in this dataset. Water-body proximity is not used to infer a supplier, intake, or pipe route. The water map markers represent reporting locations, not source infrastructure.

## Inventory check

Current public [PNNL IM3 centroid dataset](https://github.com/IMMM-SFA/datacenter-atlas/blob/main/static/im3_datacenter_centroids.geojson) downloaded on October 16, 2026: 1,382 locations. All were within 500 metres of at least one existing inventory record. This is a spatial coverage check, not identity matching or verification of current operating status. Existing enriched records and curated emerging campuses were retained. No locations were deleted or added solely from this proximity check.

The repository's existing power-plant data remains at its stated 2023 vintage. This update does not claim an EIA refresh. Existing hand-drawn water stress boxes are now labeled illustrative context; they are not verified Aqueduct county polygons or facility usage readings.

Machine-readable review information is in `public/data-review.json`. Water records and source links are in `src/data/water-disclosures.json`.

Run `node scripts/validate-water.mjs` to check disclosure uniqueness, nonnegative annual figures, consumption versus withdrawal, daily-average arithmetic, existing facility IDs, and ambiguous duplicate associations.

## Water layer and watershed tracing
The dedicated water view hides power plants and grid zones, sizes one cyan marker per mapped reporting location by annual-average daily consumption, and offers HUC 2, 4, 8, and 12 watershed boundaries. `public/watersheds.json` snapshots 64 official USGS WBD polygons (16 mapped reporting locations × four levels), simplified to 0.002 degrees, retrieved October 16, 2026. Reproduce with `python3 scripts/fetch-watersheds.py`. Boundaries describe representative campus drainage, not verified supply catchments, aquifer recharge areas, pipe routes, or full upstream networks. Not all US watersheds are included.

`WaterSystem.tsx` separately traces documented supply pathways for The Dalles, Douglas County, and Council Bluffs. Historical evidence is explicitly dated; current source shares and unpublished connections remain unknown. The Dalles watershed council documents the Dog River interbasin transfer; the Douglasville-Douglas County utility's 2012 water report documents wastewater reuse and return to the Chattahoochee. The flow cards are schematic evidence summaries, not geolocated pipelines. Complete facility-to-intake-to-treatment-to-discharge tracing across the national inventory requires further utility and permit data.

## Historical comparison pilot
The Dalles pilot uses USGS-14105700 daily mean discharge (parameter 00060, statistic 00003, ft³/s), 2000–2025. 9,497 unique daily observations cover every calendar day; annual means have no gap filling. The snapshot records the source query, retrieval timestamp, daily coverage, and approval status counts. Generate with `python3 scripts/prepare-water-history.py /path/to/usgs-response.json`. The script rejects incomplete years, duplicate dates, wrong station/metric/units, and unconsumed pagination.

Google's official Oregon location page documents a 2006 opening. The comparison excludes 2006 and compares five pre-opening calendar years (2001–2005) with either 2007–2011 or 2021–2025, weighting each annual mean equally. A 26-year chart and accessible observation table accompany the summaries. The Columbia River gauge is regional context, NOT a verified monitor of the municipal supply or a campus-impact estimate. No climate normalization, control-basin comparison, expansion adjustment, or attribution is claimed. Other sites display an unavailable state until opening dates and appropriate station records are sourced. Reservoir storage, groundwater levels, and streamflow must not be conflated.

## Resource footprint
Campus details now summarize evidence availability for water, electrical capacity, electricity provider, emissions, land/construction, and backup fuel. Only inventory-provided campus MW is shown; no 50 MW national heuristic is substituted. MW is explicitly distinguished from measured annual MWh. Regional power-plant emissions are not assigned to individual campuses. Missing categories remain unknown.

## Credibility review — October 16, 2026 (supersedes legacy power/risk claims)
Removed invented water-stress rectangles and approximate NERC risk polygons from the rendered map and source code. Removed campus PPA assertions, unsourced narrative notes, inferred electricity-mix colors, 50 MW demand totals, modeled CO2 totals, and unsupported tour numbers. Planned inventory is hidden by default. Geographic viewport counts now use source coordinates inside map bounds, avoiding cluster/tile duplicates and omitted clustered records. Counts describe inventory records irrespective of layer visibility; they do not measure demand.

An audit of actual local files found 14,793 raw plant rows and **11,159** rows in the six displayed fuel categories, correcting the earlier 10,831 count. No exact duplicate displayed tuples were found, but absent original EIA IDs prevent unique plant verification. 519 facility records lack operators; 1,479 lack positive campus MW; 1,479 lack named utilities; 409 have unverified inherited PPA tags. `node scripts/audit-data.mjs` regenerates public/evidence-audit.json with integrity checks, scope, and SHA-256 snapshots. /evidence exposes provenance, dates, evidence limits, removed claims, citation guidance, and correction contact. This is a research preview, not an independently verified national census. Newer EIA data exists; no current-year refresh or Form 923 cross-validation is claimed.

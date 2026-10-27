# School types from DfE GIAS

The Schools tab decides whether a school is state, independent (private) or special from the Department for Education's
[Get Information about Schools](https://get-information-schools.service.gov.uk) (GIAS) data, not from OpenStreetMap tags or school names.

- `public/gias.js` – the type mapping and the matching of an OpenStreetMap school to a GIAS record (by `ref:edubase` URN tag, else by name and place within 200 m). Used by the site, the build script and the tests.
- `scripts/build-gias.mjs` – turns the GIAS "all establishment data" CSV into `public/data/schools.json` (open schools only, coordinates converted to WGS84).
- `scripts/test-gias.mjs` – tests (synthetic fixture, no real data). Run `node scripts/test-gias.mjs`.
- `.github/workflows/update-gias.yml` – downloads the latest GIAS file and rebuilds the lookup monthly.

Manual update:

1. Download "All establishment data" (CSV) from https://get-information-schools.service.gov.uk/Downloads
2. `node scripts/build-gias.mjs path/to/edubasealldataYYYYMMDD.csv`
3. Commit `public/data/schools.json`

When `public/data/schools.json` is missing, the site falls back to the old OpenStreetMap guess. When it is present but a school has no match, a school that OpenStreetMap suggests is private is listed as "type not confirmed" instead of being counted as private.

Data: DfE, Open Government Licence v3.0.

## Area pages (`/uk/...`)

`scripts/areas.json` lists the towns (name and centre point). `node scripts/build-areas.mjs` fetches 12 months of
police.uk street crime inside a fixed 1.2 km square around each point, adds school counts from `public/data/schools.json`,
and writes `public/data/areas.json`. `src/seo.js` renders the pages from that file: town, crime and schools pages,
the county page, the "safest towns" ranking and `/sitemap.xml`. A town with fewer than 30 recorded crimes is marked
`noindex` and left out of the sitemap and ranking. The workflow `update-areas.yml` runs this on the 22nd of each month;
run it by hand the first time from the Actions tab. Until `areas.json` exists the pages return 404 and the sitemap lists only the homepage.
Tests: `node scripts/test-seo.mjs`.

## Council and affordable housing (Housing tab)

The Housing tab shows, for the local authority of the searched place, the homes owned by the council, the homes owned by
housing associations, and the new affordable homes completed in the last five financial years (England only).

- `public/data/social-housing.json` – one record per current local authority, built by `scripts/build-social-housing.mjs`.
- `public/social.js` – finds the authority (by the GSS code from postcodes.io, else by name) and prepares the numbers. Shared by the page, the build script and the tests.
- `scripts/test-social.mjs` – tests with an invented fixture. Run `node scripts/test-social.mjs`.
- `.github/workflows/update-social-housing.yml` – downloads the files and rebuilds every quarter (and on demand).

Sources, all MHCLG, Open Government Licence v3.0:

| File | What it gives |
|---|---|
| Live Table 116 (dwelling stock) | council-owned homes by district, from 1979 |
| Live Table 115 (dwelling stock) | housing association (private registered provider) homes, from 1997; only providers with 1,000+ homes |
| Affordable Housing Supply open data CSV | new affordable homes by authority, tenure and year |
| Live Tables 1006 to 1008 (Completions) | only to cross-check the CSV |

Manual update:

1. Download the four files from https://www.gov.uk/government/statistical-data-sets/live-tables-on-affordable-housing-supply and https://www.gov.uk/government/statistical-data-sets/live-tables-on-dwelling-stock-including-vacants
2. `cd scripts && npm install && cd ..`
3. `node scripts/build-social-housing.mjs --ahs <csv> --t116 <Live_Table_116.ods> --t115 <Live_Table_115.ods> --t1008 <Live_Tables_1006_to_1008_Completions.ods>`
4. Commit `public/data/social-housing.json`

Things to know:

- The build compares every authority and year with MHCLG's Live Table 1008C and stops if one number differs.
- Tables 115 and 116 report old districts (Allerdale, Carlisle, Copeland…). They are added up under the current authority (Cumberland) using the mapping in Table 116.
- Barnsley and Sheffield changed code in 2023; the old codes are kept as `alias`.
- Completions whose authority is not recorded ("LA Unknown", about 6,300 homes since 1993) cannot be shown on an area.
- A council with fewer than 100 homes has usually transferred its stock to a housing association; the page says so.
- The page hides the whole block when the file is missing, the place is outside England, or there is nothing to show.

## Social rented homes nearby (Housing tab)

For the searched place the Housing tab also shows how many households within 500 m and 1 km rent from a council or a housing
association, with a purple dot on the map for each small area (England and Wales). It uses the 2021 Census, not the MHCLG tables above.

- `scripts/build-social-oa.mjs` – joins Census 2021 table TS054 (tenure of household) for output areas (about 125 homes each) with the ONS output area centroids, converts British National Grid to latitude/longitude, and writes `public/data/social-oa/`: `index.json` and one file per 0.25 degree tile (about 395 files, the biggest 73 KB compressed). The page loads only the tiles around the place searched. It also writes `scripts/census2021-social-ltla.json` (what each local authority answered).
- `public/social.js` – tile keys, distance filter, summary and the England/Wales check, shared by the page, the build scripts and the tests.
- `scripts/test-social.mjs` – tests with invented data.

Data, all ONS, Open Government Licence v3.0. Census day was 21 March 2021, so it is not current:

1. https://www.nomisweb.co.uk/sources/census_2021_bulk – download TS054 (tenure) and unzip. Needed: `census2021-ts054-oa.csv` and `census2021-ts054-ltla.csv`.
2. ONS Open Geography Portal – "Output Areas (December 2021) EW Population Weighted Centroids" as CSV (columns X, Y, OA21CD).
3. `cd scripts && npm install && cd ..`
4. `node scripts/build-social-oa.mjs --oa <census2021-ts054-oa.csv> --centroids <centroids.csv> --ltla <census2021-ts054-ltla.csv>`
5. `node scripts/build-social-housing.mjs ...` again (see above) so that the `cr` flags follow the new Census file, then commit `public/data/social-oa/`, `scripts/census2021-social-ltla.json` and `public/data/social-housing.json`.

Things to know:

- The build stops if an output area has no position, if council + other social rented does not equal social rented, or if the output areas differ from the local authority table by more than 0.05%. ONS adjusts small numbers for privacy, so the levels differ by about 0.001% to 0.04%; that is normal.
- **Council against housing association is only shown where the Census agrees with the council's own stock** (`cr: 1` in `social-housing.json`, 144 of 296 authorities). The Census asks households who their landlord is, and where a council handed its homes to a housing association many tenants still answer "council": Surrey Heath 477 against 11 homes the council owns, Salford 13,599 against 1,207. Where the council still owns homes the two agree within 1% overall (1,554,543 Census against 1,544,554 MHCLG across 157 authorities). The rule is in `councilSplitReliable` (within 20%, at least 1,000 council homes). Elsewhere only council plus housing association is shown.
- Wales has no MHCLG figures here, so Wales shows the total only.
- A dot is the population-weighted centre of an output area, not a house. Shared ownership is counted in the figures but has no dots of its own.

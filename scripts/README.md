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

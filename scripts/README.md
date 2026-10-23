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

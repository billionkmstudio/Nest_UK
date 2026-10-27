// Builds the "social housing nearby" data from Census 2021 table TS054 (tenure of household) at output-area level.
//
//   node scripts/build-social-oa.mjs --oa census2021-ts054-oa.csv --centroids Output_Areas_Dec2021_PWC.csv --ltla census2021-ts054-ltla.csv
//        [--out public/data/social-oa] [--ltla-out scripts/census2021-social-ltla.json]
//
// Inputs (Office for National Statistics, Open Government Licence v3.0):
//   --oa         Census 2021 bulk download, TS054, output areas (188,880 rows for England and Wales; about 125 homes each)
//   --centroids  ONS Open Geography "Output Areas (December 2021) EW Population Weighted Centroids" CSV (British National Grid X,Y)
//   --ltla       the same TS054 bulk download at local authority level; used to check the output-area numbers add up, and
//                written to --ltla-out so that build-social-housing.mjs can judge how far the "council" answers can be trusted
//
// Output: public/data/social-oa/index.json and one small file per 0.25 degree tile (about 18 km by 28 km), so the page only
// downloads the tiles around the place searched. Each row is [dy, dx, all, council, other, shared] where dy and dx are the
// position inside the tile in units of 0.00001 degree (about 1 m), all = all households, council = rents from council or
// local authority, other = other social rented (housing associations), shared = shared ownership.
// Output areas with no social rented or shared ownership households are left out.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseCsv, osgbToWgs84 } from './build-gias.mjs';

const S = createRequire(import.meta.url)('../public/social.js');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

const COL = {
  code: 'geography code',
  all: 'Tenure of household: Total: All households',
  council: 'Tenure of household: Social rented: Rents from council or Local Authority',
  other: 'Tenure of household: Social rented: Other social rented',
  social: 'Tenure of household: Social rented',
  shared: 'Tenure of household: Shared ownership',
};

function readTable(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const head = rows[0].map(s => s.trim());
  const idx = {};
  for (const k of Object.keys(COL)) {
    idx[k] = head.indexOf(COL[k]);
    if (idx[k] < 0) throw new Error(file + ': column not found: ' + COL[k]);
  }
  const out = [];
  for (const r of rows.slice(1)) {
    if (!r[idx.code]) continue;
    const rec = { code: r[idx.code] };
    for (const k of ['all', 'council', 'other', 'social', 'shared']) {
      const v = Number(r[idx[k]]);
      if (!Number.isInteger(v) || v < 0) throw new Error(file + ': bad ' + k + ' for ' + rec.code + ': ' + r[idx[k]]);
      rec[k] = v;
    }
    out.push(rec);
  }
  return out;
}

function readCentroids(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const head = rows[0].map(s => s.trim());
  const iX = head.indexOf('X'), iY = head.indexOf('Y'), iC = head.indexOf('OA21CD');
  if (iX < 0 || iY < 0 || iC < 0) throw new Error('centroids: need columns X, Y and OA21CD, found ' + head.join(','));
  const pos = new Map();
  for (const r of rows.slice(1)) {
    const x = Number(r[iX]), y = Number(r[iY]);
    if (!r[iC] || !isFinite(x) || !isFinite(y)) continue;
    pos.set(r[iC], [x, y]);
  }
  return pos;
}

const sumOf = (rows, k) => rows.reduce((a, r) => a + r[k], 0);

export function build({ oa, centroids, ltla }) {
  const tenure = readTable(oa);
  const pos = readCentroids(centroids);
  const lt = readTable(ltla);

  // 1. every output area must have a position, and the council + other answers must equal the social rented answer
  const seen = new Set();
  for (const r of tenure) {
    if (seen.has(r.code)) throw new Error('duplicate output area ' + r.code);
    seen.add(r.code);
    if (!pos.has(r.code)) throw new Error('no centroid for output area ' + r.code);
    if (r.council + r.other !== r.social) throw new Error('council + other differs from social rented in ' + r.code);
  }
  if (pos.size !== tenure.length) throw new Error('centroid file has ' + pos.size + ' areas, tenure file has ' + tenure.length);

  // 2. the output areas must add up to the local authority table (England and Wales). ONS adjusts small numbers to protect
  //    privacy, so the levels differ by a few hundredths of a percent (24,782,883 against 24,783,164 households); anything
  //    bigger means a wrong column or a lost area.
  const checks = {};
  for (const k of ['all', 'council', 'other', 'shared']) {
    const a = sumOf(tenure, k), b = sumOf(lt.filter(r => /^[EW]/.test(r.code)), k);
    checks[k] = { oa: a, ltla: b, diffPct: Math.round(Math.abs(a - b) / b * 1e5) / 1e3 };
    if (Math.abs(a - b) / b > 0.0005) throw new Error('output areas add up to ' + a + ' but local authorities to ' + b + ' for ' + k);
  }

  // 3. convert, keep areas with something to show, cut into tiles
  const tiles = new Map();
  let kept = 0, minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const r of tenure) {
    if (r.council + r.other + r.shared === 0) continue;
    const [E, N] = pos.get(r.code);
    const g = osgbToWgs84(E, N);
    if (!(g.lat > 49.8 && g.lat < 55.9 && g.lng > -6.5 && g.lng < 1.9)) throw new Error('position outside England and Wales for ' + r.code + ': ' + g.lat + ',' + g.lng);
    const key = S.tileKey(g.lat, g.lng);
    const o = S.tileOrigin(key);
    const row = [Math.round((g.lat - o.lat) * S.UNIT), Math.round((g.lng - o.lng) * S.UNIT), r.all, r.council, r.other, r.shared];
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(row);
    kept++;
    minLat = Math.min(minLat, g.lat); maxLat = Math.max(maxLat, g.lat); minLng = Math.min(minLng, g.lng); maxLng = Math.max(maxLng, g.lng);
  }
  for (const rows of tiles.values()) rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // 4. what each local authority said, so the Housing page can tell where "council" answers are reliable
  const ltlaOut = {};
  for (const r of lt) if (/^E/.test(r.code)) ltlaOut[r.code] = [r.council, r.other];

  const index = {
    v: 1,
    census: '2021-03-21',
    step: S.STEP,
    unit: S.UNIT,
    fields: ['dy', 'dx', 'all', 'council', 'other', 'shared'],
    areas: tenure.length,
    kept,
    tiles: Object.fromEntries([...tiles].map(([k, rows]) => [k, rows.length]).sort()),
    src: 'Census 2021 table TS054 and ONS output area centroids, Office for National Statistics, Open Government Licence v3.0',
  };
  return { index, tiles, ltlaOut, report: { areas: tenure.length, kept, checks, bbox: [minLat, minLng, maxLat, maxLng], nTiles: tiles.size } };
}

export function write({ index, tiles, ltlaOut }, outDir, ltlaOutFile) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/^\d+_\d+\.json$/.test(f) || f === 'index.json') fs.unlinkSync(path.join(outDir, f));
  for (const [k, rows] of tiles) fs.writeFileSync(path.join(outDir, k + '.json'), JSON.stringify({ r: rows }));
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
  if (ltlaOutFile) fs.writeFileSync(ltlaOutFile, JSON.stringify({ census: index.census, src: 'Census 2021 TS054, local authority: [rents from council, other social rented] households', la: ltlaOut }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const k of ['oa', 'centroids', 'ltla']) if (!args[k]) { console.error('missing --' + k); process.exit(2); }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = args.out || path.join(here, '..', 'public', 'data', 'social-oa');
  const ltlaFile = args['ltla-out'] || path.join(here, 'census2021-social-ltla.json');
  const res = build(args);
  write(res, outDir, ltlaFile);
  const r = res.report;
  const bytes = fs.readdirSync(outDir).reduce((a, f) => a + fs.statSync(path.join(outDir, f)).size, 0);
  console.log('output areas', r.areas, '| with social rented or shared ownership', r.kept, '| tiles', r.nTiles, '| total bytes', bytes);
  console.log('checks (output areas vs local authorities, difference in %):', JSON.stringify(r.checks));
  console.log('wrote', outDir, 'and', ltlaFile);
}

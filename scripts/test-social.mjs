/* Tests for public/social.js and scripts/build-social-housing.mjs.  Run: node scripts/test-social.mjs
 * Uses a small SYNTHETIC fixture (invented numbers), no real data, no network. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCsv, councilSplitReliable } from './build-social-housing.mjs';
import { build as buildOa } from './build-social-oa.mjs';
import { osgbToWgs84 } from './build-gias.mjs';

const S = createRequire(import.meta.url)('../public/social.js');
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

const data = {
  years: ['2023-24', '2024-25'], keys: ['sr', 'ar', 'ir', 'so', 'aho', 'fh', 'un'], stockDate: '2025-03-31',
  alias: { E08000016: 'E08000038' },
  names: { 'testville': 'E07000001', 'old and new': 'E08000038', 'no homes': 'E07000003', 'handed over': 'E07000004' },
  la: {
    E07000001: { n: 'Testville', c: 5000, h: 2000, s: { '2023-24': [1, 2, 0, 3, 0, 0, 0], '2024-25': [0, 10, 0, 5, 0, 0, 1] } },
    E08000038: { n: 'Old and New', c: 100, h: 50, s: { '2023-24': [0, 0, 0, 0, 0, 0, 0], '2024-25': [0, 0, 0, 0, 0, 0, 0] } },
    E07000003: { n: 'No Homes', c: 0, h: 0, s: { '2023-24': [0, 0, 0, 0, 0, 0, 0], '2024-25': [0, 0, 0, 0, 0, 0, 0] } },
    E07000004: { n: 'Handed Over', c: 11, h: 3700, s: { '2023-24': [0, 5, 0, 0, 0, 0, 0], '2024-25': [0, 0, 0, 0, 0, 0, 0] } },
  },
};

ok('norm: case, punctuation and ampersand', () => {
  assert.equal(S.norm("St. Helen's & Co"), 'st helens and co');
  assert.equal(S.norm('  Bournemouth, Christchurch and Poole '), 'bournemouth christchurch and poole');
});
ok('find by code', () => assert.equal(S.find(data, { lad: 'E07000001', district: 'Whatever' }).code, 'E07000001'));
ok('find by the other code of the same authority', () => assert.equal(S.find(data, { lad: 'E08000016' }).code, 'E08000038'));
ok('find by name when the code is missing or unknown', () => {
  assert.equal(S.find(data, { lad: '', district: 'TESTVILLE' }).code, 'E07000001');
  assert.equal(S.find(data, { lad: 'E99999999', district: 'Old & New' }).code, 'E08000038');
});
ok('find: Scotland, Wales and Northern Ireland get nothing', () => {
  for (const c of ['Scotland', 'Wales', 'Northern Ireland']) assert.equal(S.find(data, { lad: 'E07000001', country: c }), null);
  assert.equal(S.find(data, { lad: 'E07000001', country: 'England' }).code, 'E07000001');
});
ok('find: unknown place, missing data', () => {
  assert.equal(S.find(data, { lad: 'X', district: 'Nowhere' }), null);
  assert.equal(S.find(null, { lad: 'E07000001' }), null);
  assert.equal(S.find(data, null), null);
});
ok('summarise: totals, latest year and breakdown', () => {
  const s = S.summarise(data, data.la.E07000001);
  assert.equal(s.council, 5000); assert.equal(s.ha, 2000);
  assert.equal(s.latestYear, '2024-25'); assert.equal(s.latestTotal, 16);
  assert.deepEqual(s.latestBy, { ar: 10, so: 5, un: 1 });
  assert.equal(s.total, 22); assert.equal(s.firstYear, '2023-24'); assert.equal(s.transferred, false); assert.equal(s.any, true);
});
ok('summarise: an authority with nothing to show is not shown', () => assert.equal(S.summarise(data, data.la.E07000003).any, false));
ok('summarise: a council that handed its homes over is flagged', () => {
  const s = S.summarise(data, data.la.E07000004);
  assert.equal(s.transferred, true); assert.equal(s.council, 11); assert.equal(s.ha, 3700);
});
ok('parseCsv: quotes, commas, CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
});

/* ---------- homes near a point ---------- */
ok('tileKey and tileOrigin agree: the point lies inside its tile', () => {
  for (const [la, ln] of [[51.2362, -0.5704], [50.0, -5.7], [55.8, 1.7], [53.48, -2.29], [51.5, -0.125]]) {
    const o = S.tileOrigin(S.tileKey(la, ln));
    assert.ok(la >= o.lat && la < o.lat + S.STEP && ln >= o.lng && ln < o.lng + S.STEP, la + ',' + ln);
  }
});
ok('tileKeys: one tile in the middle of a tile, four at a corner, always includes the point’s own tile', () => {
  assert.deepEqual(S.tileKeys(51.125, -0.375, 1000), [S.tileKey(51.125, -0.375)]);
  const corner = S.tileKeys(51.25, -0.5, 1000);
  assert.equal(corner.length, 4);
  assert.ok(corner.includes(S.tileKey(51.25, -0.5)));
  assert.ok(S.tileKeys(51.2362, -0.5704, 1000).includes(S.tileKey(51.2362, -0.5704)));
});
ok('decodeTile and nearby: positions, distances, order and the radius cut', () => {
  const key = S.tileKey(51.2, -0.5), o = S.tileOrigin(key);
  const row = (la, ln, all, co, ha, so) => [Math.round((la - o.lat) * S.UNIT), Math.round((ln - o.lng) * S.UNIT), all, co, ha, so];
  const tile = { r: [row(51.2000, -0.5000, 100, 10, 5, 0), row(51.2045, -0.5000, 100, 0, 0, 3), row(51.2090, -0.5000, 100, 4, 4, 0), row(51.2110, -0.5000, 100, 9, 9, 9)] };
  const rows = S.decodeTile(key, tile);
  assert.equal(rows.length, 4);
  assert.ok(Math.abs(rows[0].la - 51.2) < 2e-5 && Math.abs(rows[0].ln + 0.5) < 2e-5);
  const near = S.nearby(rows.slice().reverse(), 51.2, -0.5, 1000);
  assert.deepEqual(near.map(x => x.all), [100, 100, 100]);       // the fourth is about 1.2 km away
  assert.ok(near[0].d <= near[1].d && near[1].d <= near[2].d);
  assert.ok(near[1].d > 480 && near[1].d < 520, 'second area is about 500 m away: ' + near[1].d);
  assert.ok(near[2].d > 980 && near[2].d <= 1000, 'third area is just inside 1 km: ' + near[2].d);
});
ok('summariseNear: totals by distance, split only when the authority is flagged', () => {
  const rows = [{ d: 100, all: 100, co: 10, ha: 5, so: 1 }, { d: 600, all: 120, co: 20, ha: 0, so: 0 }, { d: 900, all: 80, co: 0, ha: 0, so: 4 }];
  const a = S.summariseNear(rows, { cr: 1 });
  assert.equal(a.r500.social, 15); assert.equal(a.r1000.social, 35); assert.equal(a.r1000.shared, 5); assert.equal(a.r1000.all, 300);
  assert.equal(a.splitOk, true); assert.equal(a.r1000.council, 30); assert.equal(a.r1000.other, 5);
  assert.equal(a.nearest.d, 100); assert.equal(a.densest.d, 600);   // 20 households at 600 m beat 15 at 100 m
  assert.equal(Math.round(a.share1000 * 1000), 117);
  assert.equal(S.summariseNear(rows, { cr: 0 }).splitOk, false);
  assert.equal(S.summariseNear(rows, null).splitOk, false);
  const none = S.summariseNear([], null);
  assert.equal(none.nearest, null); assert.equal(none.r1000.social, 0); assert.equal(none.share1000, null);
});
ok('covered: England and Wales only', () => {
  assert.equal(S.covered({ lad: 'E07000209' }), true);
  assert.equal(S.covered({ lad: 'W06000015' }), true);
  assert.equal(S.covered({ lad: 'S12000036' }), false);
  assert.equal(S.covered({ lad: 'N09000003' }), false);
  assert.equal(S.covered({ lad: '', country: 'Wales' }), true);
  assert.equal(S.covered({ lad: '', country: 'Scotland' }), false);
  assert.equal(S.covered({ lad: '', country: '' }), false);
  assert.equal(S.covered(null), false);
});
ok('councilSplitReliable: needs a real council stock that the Census agrees with', () => {
  assert.equal(councilSplitReliable(5217, 4864), true);      // Guildford: -7%
  assert.equal(councilSplitReliable(5217, 6200), true);      // +19%
  assert.equal(councilSplitReliable(5217, 6400), false);     // +23%
  assert.equal(councilSplitReliable(11, 477), false);        // Surrey Heath: stock handed to housing associations
  assert.equal(councilSplitReliable(1207, 13599), false);    // Salford
  assert.equal(councilSplitReliable(500, 500), false);       // too small to judge
  assert.equal(councilSplitReliable(null, 100), false);
  assert.equal(councilSplitReliable(3000, null), false);
});

/* ---------- build-social-oa on an invented fixture ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-oa-'));
const H = 'date,geography,geography code,Tenure of household: Total: All households,Tenure of household: Owned,Tenure of household: Shared ownership,Tenure of household: Social rented,Tenure of household: Social rented: Rents from council or Local Authority,Tenure of household: Social rented: Other social rented';
const tenureCsv = rows => H + '\n' + rows.map(r => ['2021', r[0], r[0], r[1], 0, r[4], r[2] + r[3], r[2], r[3]].join(',')).join('\n') + '\n';
// [code, all, council, other, shared]
const OA = [['E00000001', 100, 20, 10, 5], ['E00000002', 100, 0, 0, 0], ['E00000003', 80, 5, 5, 0], ['W00000001', 90, 2, 8, 1]];
const LT = [['E06000001', 280, 25, 15, 5], ['W06000001', 90, 2, 8, 1]];
const pos = { E00000001: [500000, 150000], E00000002: [500100, 150100], E00000003: [450000, 250000], W00000001: [320000, 180000] };
const cenCsv = 'X,Y,FID,OA21CD,GlobalID\n' + OA.map((r, i) => pos[r[0]].join(',') + ',' + (i + 1) + ',' + r[0] + ',x').join('\n') + '\n';
const f = (n, c) => { const p = path.join(tmp, n); fs.writeFileSync(p, c); return p; };
const fx = { oa: f('oa.csv', tenureCsv(OA)), centroids: f('c.csv', cenCsv), ltla: f('l.csv', tenureCsv(LT)) };
ok('build-social-oa: keeps areas with social or shared homes, positions survive the round trip', () => {
  const { index, tiles, ltlaOut, report } = buildOa(fx);
  assert.equal(report.areas, 4); assert.equal(index.kept, 3);
  const all = [];
  for (const [k, rows] of tiles) S.decodeTile(k, { r: rows }).forEach(x => all.push(x));
  assert.equal(all.length, 3);
  const want = osgbToWgs84(500000, 150000);
  const hit = all.find(x => x.all === 100);
  assert.ok(Math.abs(hit.la - want.lat) < 1.5e-5 && Math.abs(hit.ln - want.lng) < 1.5e-5, JSON.stringify([hit, want]));
  assert.deepEqual({ co: hit.co, ha: hit.ha, so: hit.so }, { co: 20, ha: 10, so: 5 });
  assert.ok(Object.keys(index.tiles).every(k => tiles.has(k)) && Object.values(index.tiles).reduce((a, b) => a + b, 0) === 3);
  assert.deepEqual(ltlaOut, { E06000001: [25, 15] });      // England only
});
ok('build-social-oa: refuses a missing centroid, a split that does not add up, and totals that disagree', () => {
  const noPos = f('c2.csv', cenCsv.split('\n').filter(l => !l.includes('E00000003')).join('\n'));
  assert.throws(() => buildOa({ ...fx, centroids: noPos }), /centroid/);
  const bad = tenureCsv(OA).replace('E00000003,E00000003,80,0,0,10,5,5', 'E00000003,E00000003,80,0,0,10,6,5');
  assert.notEqual(bad, tenureCsv(OA), 'the fixture edit must change the file');
  assert.throws(() => buildOa({ ...fx, oa: f('oa2.csv', bad) }), /differs from social rented/);
  const lt2 = tenureCsv([['E06000001', 330, 25, 15, 5], ['W06000001', 90, 2, 8, 1]]);
  assert.throws(() => buildOa({ ...fx, ltla: f('l2.csv', lt2) }), /add up/);
});
fs.rmSync(tmp, { recursive: true, force: true });

console.log(passed + ' tests passed');

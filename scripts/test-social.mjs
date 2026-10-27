/* Tests for public/social.js and scripts/build-social-housing.mjs.  Run: node scripts/test-social.mjs
 * Uses a small SYNTHETIC fixture (invented numbers), no real data, no network. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseCsv } from './build-social-housing.mjs';

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
console.log(passed + ' tests passed');

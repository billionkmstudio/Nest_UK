#!/usr/bin/env node
// Compares each town point in scripts/areas.json with the middle of the place outline from OpenStreetMap (Nominatim),
// using the same rule as the site's place search (public/place.js). Report only: it never edits areas.json.
//   node scripts/check-area-points.mjs            prints a table; towns more than 400 m off are marked CHECK
//   node scripts/check-area-points.mjs --json     also prints the suggested towns array
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { haversine } from './build-areas.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { placeArea } = createRequire(import.meta.url)('../public/place.js');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'scripts/areas.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = [], suggested = [];

for (const [name, lat, lng] of cfg.towns) {
  let line;
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&polygon_geojson=1&polygon_threshold=0.0003&countrycodes=gb&q=' + encodeURIComponent(name + ', ' + cfg.countyName + ', England');
    const r = await fetch(url, { headers: { 'User-Agent': 'NestUK-check/1.0 (+https://nestuk.co.uk)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = (await r.json())[0];
    if (!j) throw new Error('no result');
    const ar = placeArea(j);
    const c = ar ? { lat: ar.lat, lng: ar.lng } : { lat: +j.lat, lng: +j.lon };
    const d = Math.round(haversine(lat, lng, c.lat, c.lng));
    const county = (j.address && (j.address.county || j.address.state_district || '')) || '';
    const wrongCounty = county && !county.includes(cfg.countyName);
    line = { name, d, kind: ar ? 'outline' : 'point', county, flag: d > 400 || wrongCounty, c };
    suggested.push([name, +c.lat.toFixed(4), +c.lng.toFixed(4)]);
  } catch (e) {
    line = { name, d: null, kind: 'error: ' + e.message, county: '', flag: true, c: null };
    suggested.push([name, lat, lng]);
  }
  rows.push(line);
  await sleep(1100);   // Nominatim allows one request a second
}
const out = ['town | metres from our point | basis | county | ', '--- | --- | --- | --- | ---']
  .concat(rows.map(r => [r.name, r.d === null ? '?' : r.d, r.kind, r.county, r.flag ? 'CHECK' : 'ok'].join(' | ')));
console.log(out.join('\n'));
console.log('\n' + rows.filter(r => r.flag).length + ' of ' + rows.length + ' need a look.');
if (process.argv.includes('--json')) console.log('\n' + suggested.map(t => '    ' + JSON.stringify(t)).join(',\n'));

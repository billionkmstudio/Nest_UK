#!/usr/bin/env node
// Compares each point in scripts/areas/<region>.json with the middle of the place outline from OpenStreetMap (Nominatim),
// using the same rule as the site's place search (public/place.js). Report only: it never edits the region files.
//   node scripts/check-area-points.mjs                 every region (also the ones with "enabled": false); prints a table per region,
//                                                      places more than 400 m off, or not found in that region, are marked CHECK
//   node scripts/check-area-points.mjs birmingham      one region
//   node scripts/check-area-points.mjs --json          also prints the suggested points array for each region
// A large neighbourhood can be flagged even when its point is fine (the middle of its outline is not its high street): look at
// the metres before moving a point.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { haversine, loadRegionConfigs } from './build-areas.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { placeArea } = createRequire(import.meta.url)('../public/place.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const want = process.argv.slice(2).find(a => !a.startsWith('--')) || 'all';
const all = loadRegionConfigs(root);
const configs = want === 'all' ? all : all.filter(c => c.county === want);
if (!configs.length) { console.error('No region "' + want + '". Regions: ' + all.map(c => c.county).join(', ')); process.exit(1); }

let flagged = 0, total = 0;
for (const cfg of configs) {
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
      const a = j.address || {};
      const where = a.suburb || a.city_district || a.city || a.town || a.county || a.state_district || '';
      // the region name must appear somewhere in the address: "Surrey" for a county, "Birmingham" for a city
      const wrongRegion = !(Object.values(a).join(' | ') + ' | ' + (j.display_name || '')).includes(cfg.countyName);
      line = { name, d, kind: ar ? 'outline' : 'point', where, flag: d > 400 || wrongRegion, c };
      suggested.push([name, +c.lat.toFixed(4), +c.lng.toFixed(4)]);
    } catch (e) {
      line = { name, d: null, kind: 'error: ' + e.message, where: '', flag: true, c: null };
      suggested.push([name, lat, lng]);
    }
    rows.push(line);
    await sleep(1100);   // Nominatim allows one request a second
  }
  console.log('\n### ' + cfg.countyName + (cfg.enabled === false ? ' (enabled: false)' : '') + '\n');
  console.log(['place | metres from our point | basis | found in | ', '--- | --- | --- | --- | ---']
    .concat(rows.map(r => [r.name, r.d === null ? '?' : r.d, r.kind, r.where, r.flag ? 'CHECK' : 'ok'].join(' | '))).join('\n'));
  const bad = rows.filter(r => r.flag).length;
  console.log('\n' + bad + ' of ' + rows.length + ' need a look.');
  if (process.argv.includes('--json')) console.log('\nSuggested points for scripts/areas/' + cfg.county + '.json (middle of each place outline):\n' + suggested.map(t => '    ' + JSON.stringify(t)).join(',\n'));
  flagged += bad; total += rows.length;
}
console.log('\nTotal: ' + flagged + ' of ' + total + ' need a look.');

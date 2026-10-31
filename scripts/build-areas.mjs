#!/usr/bin/env node
// Builds public/data/areas/<region>.json (and index.json): per-town crime and school statistics used by the SEO pages (src/seo.js).
//   node scripts/build-areas.mjs            all enabled regions in scripts/areas/*.json (needs network: data.police.uk; reads public/data/schools.json)
//   node scripts/build-areas.mjs surrey     one region only
// A region is a county of towns or a city split into neighbourhoods. A region with "enabled": false is skipped, so its
// town points can be checked (scripts/check-area-points.mjs) before any numbers go live.
// Crime = street-level crimes inside a fixed 1.2 km square (600 m each way) around the point, last 12 months.
// The same square for every place keeps them comparable. A place whose fetch fails keeps its previous numbers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICE = 'https://data.police.uk/api/';
export const RADIUS_M = 600;
const UA = 'NestUK-areas/1.0 (+https://nestuk.co.uk)';

// scripts/areas/<region>.json files, in name order. Each file name must match its "county" field.
export function loadRegionConfigs(rootDir = root) {
  const dir = path.join(rootDir, 'scripts/areas');
  return fs.readdirSync(dir).filter(f => /^[a-z0-9-]+\.json$/.test(f)).sort().map(f => {
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (c.county !== f.replace(/\.json$/, '')) throw new Error(f + ': "county" must be "' + f.replace(/\.json$/, '') + '"');
    return c;
  });
}

export const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function squarePoly(lat, lng, r) {
  const dLat = r / 111320, dLng = r / (111320 * Math.cos(lat * Math.PI / 180));
  const f = n => n.toFixed(6);
  return [[lat + dLat, lng - dLng], [lat + dLat, lng + dLng], [lat - dLat, lng + dLng], [lat - dLat, lng - dLng]]
    .map(p => f(p[0]) + ',' + f(p[1])).join(':');
}
export function monthList(latest, n) {
  let [y, m] = latest.split('-').map(Number); const out = [];
  for (let i = 0; i < n; i++) { out.unshift(y + '-' + String(m).padStart(2, '0')); m--; if (m === 0) { m = 12; y--; } }
  return out;
}
export function haversine(la1, ln1, la2, ln2) {
  const R = 6371000, r = Math.PI / 180, dLa = (la2 - la1) * r, dLn = (ln2 - ln1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// crimeByMonth: { 'YYYY-MM': [category, ...] | null }  ->  summary, or null when too few months came back.
export function summariseCrime(months, crimeByMonth) {
  const got = months.filter(m => Array.isArray(crimeByMonth[m]));
  if (got.length < 9) return null;
  const series = got.map(m => ({ m, n: crimeByMonth[m].length }));
  const cats = {};
  got.forEach(m => crimeByMonth[m].forEach(c => { cats[c] = (cats[c] || 0) + 1; }));
  const total = series.reduce((a, x) => a + x.n, 0);
  return { months: series, total, perMonth: Math.round(total / got.length * 10) / 10, cats };
}

// rows: [urn,name,cls,phase,lat,lng,faith] from public/data/schools.json
export function summariseSchools(rows, lat, lng) {
  const MI = 1609.34, near = [];
  for (const r of rows) {
    if (Math.abs(r[4] - lat) > 0.08 || Math.abs(r[5] - lng) > 0.13) continue;   // cheap pre-filter (~9 km, wider than the 5 mile independent list)
    // The state-school lists keep their original ~6 km search box so existing pages do not change; only the independent list uses the wider one.
    near.push({ urn: r[0], name: r[1], cls: r[2], phase: r[3], faith: r[6] ? 1 : 0, d: Math.round(haversine(lat, lng, r[4], r[5])), box: Math.abs(r[4] - lat) <= 0.06 && Math.abs(r[5] - lng) <= 0.1 });
  }
  const state = near.filter(s => s.cls === 'S' && s.box);
  const pri = state.filter(s => s.phase === 'p' || s.phase === 'a').sort((a, b) => a.d - b.d);
  const sec = state.filter(s => s.phase === 's' || s.phase === 'a').sort((a, b) => a.d - b.d);
  const slim = s => ({ urn: s.urn, name: s.name, d: s.d, faith: s.faith, all: s.phase === 'a' ? 1 : 0 });
  // Independent (fee-paying) schools carry no phase in the DfE register, so they are listed by name and distance only.
  const indep = near.filter(s => s.cls === 'I' && s.d <= 5 * MI).sort((a, b) => a.d - b.d);
  return {
    primary1mi: pri.filter(s => s.d <= MI).length,
    secondary3mi: sec.filter(s => s.d <= 3 * MI).length,
    independent2mi: indep.filter(s => s.d <= 2 * MI).length,
    independent5mi: indep.length,
    nearestPrimary: pri.slice(0, 5).map(slim),
    nearestSecondary: sec.slice(0, 5).map(slim),
    nearestIndependent: indep.slice(0, 10).map(s => ({ urn: s.urn, name: s.name, d: s.d, faith: s.faith })),
  };
}

async function getJSON(fetchFn, url, tries = 4) {
  let status = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchFn(url, { headers: { 'User-Agent': UA } });
      status = r.status;
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch (e) { status = -1; }
    await new Promise(res => setTimeout(res, 1000 * (i + 1) * (globalThis.__FAST ? 0 : 1)));
  }
  throw new Error('HTTP ' + status + ' for ' + url.split('?')[0]);
}

export async function buildAreas({ fetchFn = fetch, schoolRows, config, previous = null, log = () => {}, delayMs = 120 }) {
  const last = await getJSON(fetchFn, POLICE + 'crime-last-updated');
  const latest = String(last.date).slice(0, 7);
  const months = monthList(latest, 12);
  const prev = new Map(((previous && previous.towns) || []).map(t => [t.slug, t]));
  const towns = [];
  for (const [name, lat, lng] of config.towns) {
    const slug = slugify(name);
    const crimeByMonth = {};
    for (const m of months) {
      try {
        const j = await getJSON(fetchFn, POLICE + 'crimes-street/all-crime?poly=' + squarePoly(lat, lng, RADIUS_M) + '&date=' + m);
        crimeByMonth[m] = Array.isArray(j) ? j.map(x => x.category) : null;
      } catch (e) { crimeByMonth[m] = null; }
      await new Promise(res => setTimeout(res, delayMs));
    }
    let crime = summariseCrime(months, crimeByMonth);
    if (!crime && prev.get(slug)) { crime = prev.get(slug).crime; log('kept previous crime for ' + name); }
    log(name + ': ' + (crime ? crime.total + ' crimes' : 'no crime data'));
    towns.push({ slug, name, county: config.county, lat, lng, crime, schools: summariseSchools(schoolRows, lat, lng) });
  }
  return { v: 1, built: new Date().toISOString().slice(0, 10), latest, radiusM: RADIUS_M, county: config.county, countyName: config.countyName, unit: config.unit === 'areas' ? 'areas' : 'towns', towns };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const only = process.argv[2] || '';
  const configs = loadRegionConfigs().filter(c => c.enabled !== false);
  if (only && !configs.some(c => c.county === only)) { console.error('No enabled region "' + only + '". Enabled: ' + configs.map(c => c.county).join(', ')); process.exit(1); }
  const schools = JSON.parse(fs.readFileSync(path.join(root, 'public/data/schools.json'), 'utf8'));
  const outDir = path.join(root, 'public/data/areas');
  fs.mkdirSync(outDir, { recursive: true });
  let written = 0;
  for (const config of configs) {
    if (only && only !== config.county) continue;
    const outFile = path.join(outDir, config.county + '.json');
    let previous = null; try { previous = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) {}
    console.log('== ' + config.countyName + ' (' + config.towns.length + ' places)');
    const out = await buildAreas({ schoolRows: schools.rows, config, previous, log: console.log });
    const ok = out.towns.filter(t => t.crime).length;
    // one region failing (police.uk hiccup) must not block the others: keep its previous file and say so
    if (ok < config.towns.length * 0.8) { console.log('::warning::' + config.countyName + ': only ' + ok + ' of ' + config.towns.length + ' places have crime data, so the previous file is kept.'); continue; }
    fs.writeFileSync(outFile, JSON.stringify(out));
    written++;
    console.log('Wrote ' + outFile + ' (' + ok + ' places with crime data, latest month ' + out.latest + ')');
  }
  // index.json lists every enabled region that has a data file; the site only serves regions listed here
  const regions = configs.filter(c => fs.existsSync(path.join(outDir, c.county + '.json')))
    .map(c => ({ county: c.county, countyName: c.countyName, unit: c.unit === 'areas' ? 'areas' : 'towns' }));
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ v: 1, regions }));
  if (!written) { console.error('No region was written.'); process.exit(1); }
}

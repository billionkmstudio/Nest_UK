#!/usr/bin/env node
// Builds public/data/areas.json: per-town crime and school statistics used by the SEO pages (src/seo.js).
//   node scripts/build-areas.mjs            (needs network: data.police.uk; reads public/data/schools.json)
// Crime = street-level crimes inside a fixed 1.2 km square (600 m each way) around the town point, last 12 months.
// The same square for every town keeps towns comparable. A town whose fetch fails keeps its previous numbers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICE = 'https://data.police.uk/api/';
export const RADIUS_M = 600;
const UA = 'NestUK-areas/1.0 (+https://nestuk.co.uk)';

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
    if (Math.abs(r[4] - lat) > 0.06 || Math.abs(r[5] - lng) > 0.1) continue;   // cheap pre-filter (~6 km)
    near.push({ urn: r[0], name: r[1], cls: r[2], phase: r[3], faith: r[6] ? 1 : 0, d: Math.round(haversine(lat, lng, r[4], r[5])) });
  }
  const state = near.filter(s => s.cls === 'S');
  const pri = state.filter(s => s.phase === 'p' || s.phase === 'a').sort((a, b) => a.d - b.d);
  const sec = state.filter(s => s.phase === 's' || s.phase === 'a').sort((a, b) => a.d - b.d);
  const slim = s => ({ urn: s.urn, name: s.name, d: s.d, faith: s.faith, all: s.phase === 'a' ? 1 : 0 });
  return {
    primary1mi: pri.filter(s => s.d <= MI).length,
    secondary3mi: sec.filter(s => s.d <= 3 * MI).length,
    independent2mi: near.filter(s => s.cls === 'I' && s.d <= 2 * MI).length,
    nearestPrimary: pri.slice(0, 5).map(slim),
    nearestSecondary: sec.slice(0, 5).map(slim),
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
  return { v: 1, built: new Date().toISOString().slice(0, 10), latest, radiusM: RADIUS_M, county: config.county, countyName: config.countyName, towns };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'scripts/areas.json'), 'utf8'));
  const schools = JSON.parse(fs.readFileSync(path.join(root, 'public/data/schools.json'), 'utf8'));
  const outFile = path.join(root, 'public/data/areas.json');
  let previous = null; try { previous = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) {}
  const out = await buildAreas({ schoolRows: schools.rows, config, previous, log: console.log });
  const ok = out.towns.filter(t => t.crime).length;
  if (ok < config.towns.length * 0.8) { console.error('Only ' + ok + ' of ' + config.towns.length + ' towns have crime data; not writing.'); process.exit(1); }
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log('Wrote ' + outFile + ' (' + ok + ' towns with crime data, latest month ' + out.latest + ')');
}

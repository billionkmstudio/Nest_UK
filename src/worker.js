// Nest UK — Cloudflare Worker
// Serves the static site (public/) and three same-origin API routes:
//   /api/buses  live buses   (secret: BODS_API_KEY)
//   /api/hpi    house prices (HM Land Registry UKHPI)
//   /api/flood  flood-risk band (Environment Agency)
//   /api/crime-last-updated, /api/crime  police.uk street crime, edge-cached
//   /api/flood-warnings  live flood warnings (Environment Agency), edge-cached
//   /api/overpass?kind=edu|extra|life|roads|bus  OpenStreetMap places, edge-cached
// Same origin as the page, so no CORS handling is needed.

import Q from '../public/queries.js';

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });

const isTimeout = e => e && (e.name === 'TimeoutError' || e.name === 'AbortError');

/* ============================== BUSES ============================== */
const MAX_SPAN = 0.15;          // degrees; stops people pulling the whole country
const MAX_AGE_S = 600;          // drop positions older than 10 minutes
const BODS_UPSTREAM = 'https://data.bus-data.dft.gov.uk/api/v1/datafeed/';

function tag(block, name) {
  const m = block.match(new RegExp('<(?:\\w+:)?' + name + '>([^<]*)</(?:\\w+:)?' + name + '>'));
  return m ? m[1].trim() : '';
}
function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseSiri(xml, now) {
  const out = [];
  const seen = new Set();
  const blocks = xml.split(/<(?:\w+:)?VehicleActivity>/).slice(1);
  for (const raw of blocks) {
    const b = raw.split(/<\/(?:\w+:)?VehicleActivity>/)[0];
    const lat = parseFloat(tag(b, 'Latitude')), lng = parseFloat(tag(b, 'Longitude'));
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const rec = Date.parse(tag(b, 'RecordedAtTime'));
    const age = isFinite(rec) ? Math.max(0, Math.round((now - rec) / 1000)) : null;
    if (age !== null && age > MAX_AGE_S) continue;
    const vref = tag(b, 'VehicleRef');
    const line = unescapeXml(tag(b, 'PublishedLineName') || tag(b, 'LineRef'));
    const op = tag(b, 'OperatorRef');
    const id = (op + ':' + vref) || (line + ':' + lat + ',' + lng);
    if (seen.has(id)) continue;
    seen.add(id);
    const bearing = parseFloat(tag(b, 'Bearing'));
    out.push({
      id, line, op,
      dest: unescapeXml(tag(b, 'DestinationName')),
      lat, lng,
      bearing: isFinite(bearing) ? Math.round(bearing) : null,
      age
    });
  }
  return out;
}

async function buses(request, env, ctx, url) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  if (!env.BODS_API_KEY) return json({ error: 'BODS_API_KEY is not set on the server' }, 500);

  const parts = (url.searchParams.get('bbox') || '').split(',').map(Number);
  if (parts.length !== 4 || parts.some(n => !isFinite(n))) {
    return json({ error: 'bbox must be minLon,minLat,maxLon,maxLat' }, 400);
  }
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (!(minLon < maxLon && minLat < maxLat) || maxLon - minLon > MAX_SPAN || maxLat - minLat > MAX_SPAN ||
      minLat < 49.5 || maxLat > 61 || minLon < -8.7 || maxLon > 2) {
    return json({ error: 'bbox outside the UK or larger than ' + MAX_SPAN + ' degrees' }, 400);
  }

  // Visitors watching the same area share one 10-second cached upstream call.
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  try {
    const up = await fetch(
      BODS_UPSTREAM + '?boundingBox=' + [minLon, minLat, maxLon, maxLat].join(',') + '&api_key=' + encodeURIComponent(env.BODS_API_KEY),
      { signal: AbortSignal.timeout(8000) }
    );
    if (!up.ok) return json({ error: 'upstream HTTP ' + up.status }, 502);
    const vehicles = parseSiri(await up.text(), Date.now());
    const res = json(
      { ts: new Date().toISOString(), count: vehicles.length, vehicles },
      200,
      { 'Cache-Control': 'public, max-age=10' }
    );
    ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  } catch (e) {
    return json({ error: isTimeout(e) ? 'upstream timeout' : 'upstream failed' }, 504);
  }
}

/* =============================== HPI =============================== */
// Source: HM Land Registry UK House Price Index (Open Government Licence).
// GET /api/hpi?area=Guildford  ->  { ok:true, area, month, averagePrice, detached, semi, terraced, flat, annualChange, salesVolume, series, src }
// Optional env: HPI_BASE (override of the data host).
const HPI_TIMEOUT_MS = 6000;
const hpiBase = env => env.HPI_BASE || 'https://landregistry.data.gov.uk/data/ukhpi/region';

function slugify(s) {
  return String(s).toLowerCase().replace(/&/g, 'and').replace(/['’.]/g, '').replace(/,/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function slugCandidates(name) {
  const n = String(name || '').trim();
  const out = [];
  const m1 = n.match(/^(.*?),\s*City of$/i), m2 = n.match(/^City of\s+(.*)$/i);
  if (m1) { out.push(slugify('City of ' + m1[1])); out.push(slugify(m1[1])); }
  else if (m2) { out.push(slugify(n)); out.push(slugify(m2[1])); }
  else out.push(slugify(n));
  return out.filter((v, i, a) => v && a.indexOf(v) === i);
}
function hpiMonths(now) {
  const out = [];
  for (let back = 2; back <= 6; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    out.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
  }
  return out;   // newest first
}
const posNum = v => { const x = Number(Array.isArray(v) ? v[0] : v); return isFinite(x) && x > 0 ? x : null; };
const anyNum = v => { const x = Number(Array.isArray(v) ? v[0] : v); return isFinite(x) ? x : null; };

function parseHpi(j) {
  const t = j && j.result && j.result.primaryTopic;
  if (!t) return null;
  const avg = posNum(t.averagePrice);
  if (avg === null) return null;
  return {
    month: String(t.refMonth || '').slice(0, 7) || null,
    averagePrice: avg,
    detached: posNum(t.averagePriceDetached), semi: posNum(t.averagePriceSemiDetached),
    terraced: posNum(t.averagePriceTerraced), flat: posNum(t.averagePriceFlatMaisonette),
    annualChange: anyNum(t.percentageAnnualChange), salesVolume: posNum(t.salesVolume)
  };
}

async function hpiTry(env, slug, ym) {
  const url = hpiBase(env) + '/' + slug + '/month/' + ym + '.json';
  const rec = { slug, ym, url };
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(HPI_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': 'nest-uk-hpi-proxy/1.0' }
    });
    rec.status = r.status;
    const text = await r.text();
    rec.snippet = text.slice(0, 120);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error('not JSON'); }
    const data = parseHpi(j);
    if (!data) throw new Error('no data');
    return { slug, data, rec };
  } catch (e) {
    rec.note = isTimeout(e) ? 'timeout' : (e && e.message) || 'error';
    e.rec = rec; throw e;
  }
}

async function hpi(request, env, ctx, url) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  const area = (url.searchParams.get('area') || '').trim();
  if (!area || area.length > 80) return json({ error: 'bad area' }, 400);
  const debug = url.searchParams.get('debug');

  const cache = caches.default;
  if (!debug) { const hit = await cache.match(request); if (hit) return hit; }

  const slugs = slugCandidates(area);
  const yms = hpiMonths(new Date());
  const attempts = [];
  const jobs = [];
  slugs.forEach(s => yms.forEach(ym => jobs.push(
    hpiTry(env, s, ym).then(
      r => { attempts.push(r.rec); return r; },
      e => { attempts.push(e.rec); return null; }
    )
  )));
  const results = (await Promise.all(jobs)).filter(Boolean);
  if (!results.length) {
    return json({
      error: 'upstream: ' + attempts.slice(0, 4).map(a => a.slug + '/' + a.ym + ' ' + (a.note || a.status || '?')).join('; '),
      slugs, attempts
    }, 502);
  }
  results.sort((a, b) => (a.data.month < b.data.month ? 1 : -1));
  const best = results[0];

  // 12-month trend: the 11 months before the newest one (failures just leave gaps)
  const [by, bm] = best.data.month.split('-').map(Number);
  const prior = [];
  for (let k = 11; k >= 1; k--) {
    const d = new Date(Date.UTC(by, bm - 1 - k, 1));
    prior.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
  }
  const hist = await Promise.all(prior.map(ym =>
    hpiTry(env, best.slug, ym).then(r => ({ month: ym, averagePrice: r.data.averagePrice }), () => null)
  ));
  const series = hist.filter(Boolean).concat([{ month: best.data.month, averagePrice: best.data.averagePrice }]);

  const body = Object.assign(
    { ok: true, area, slug: best.slug, src: 'HM Land Registry UKHPI', ts: new Date().toISOString() },
    best.data, { series }, debug ? { attempts } : {}
  );
  const res = json(body, 200, { 'Cache-Control': 'public, max-age=43200' });
  if (!debug) ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

/* ============================== FLOOD ============================== */
// GET /api/flood?lat=51.2&lng=-0.57  ->  { ok:true, band:'very low'|'low'|'medium'|'high'|null, src, ts }
// Add &debug=1 to see every attempt. Optional env: FLOOD_QUERY_URL, FLOOD_WMS_URL.
const FLOOD_LAYER = 'https://gisrest.defra.gov.uk/server/rest/services/EA/RiskOfFloodingFromRiversAndSea/MapServer/0/query';
const FLOOD_WMS = 'https://environment.data.gov.uk/spatialdata/risk-of-flooding-from-rivers-and-sea/wms';
const FLOOD_RANK = { 'very low': 0, low: 1, medium: 2, high: 3 };
const FLOOD_TIMEOUT_MS = 6000;

function pickBand(j) {
  let best = null;
  ((j && j.features) || []).forEach(f => {
    const v = String((f.attributes || {}).prob_4band || '').toLowerCase();
    if (v in FLOOD_RANK && (best === null || FLOOD_RANK[v] > FLOOD_RANK[best])) best = v;
  });
  return best;
}

function floodUrls(env, lat, lng) {
  const base = env.FLOOD_QUERY_URL || FLOOD_LAYER;
  const common = '?f=json&geometry=' + lng + ',' + lat + '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=prob_4band&returnGeometry=false';
  return [
    { name: 'arcgis+25m', url: base + common + '&distance=25&units=esriSRUnit_Meter' },
    { name: 'arcgis-point', url: base + common }
  ];
}

async function floodArcgis(a) {
  const rec = { name: a.name, url: a.url.split('?')[0] };
  try {
    const r = await fetch(a.url, {
      signal: AbortSignal.timeout(FLOOD_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': 'nest-uk-flood-proxy/1.0' }
    });
    rec.status = r.status;
    const text = await r.text();
    rec.snippet = text.slice(0, 160);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error('not JSON'); }
    if (j.error) throw new Error(j.error.message || String(j.error.code));
    return { band: pickBand(j), src: a.name, rec };
  } catch (e) {
    rec.note = isTimeout(e) ? 'timeout' : (e && e.message) || 'error';
    e.rec = rec; throw e;
  }
}

async function floodText(url, ms, rec) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'nest-uk-flood-proxy/1.0' } });
  rec.status = r.status;
  const text = await r.text();
  rec.snippet = text.slice(0, 160);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return text;
}
function pickLayerName(xml) {
  const names = [];
  const re = /<Layer[^>]*queryable="1"[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
  let m;
  while ((m = re.exec(xml))) names.push(m[1].trim());
  if (!names.length) {
    const all = [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map(x => x[1].trim());
    return all.find(n => /rofrs|flood|risk/i.test(n)) || all[0] || null;
  }
  return names.find(n => /rofrs|4band|likelihood|risk/i.test(n)) || names[0];
}
function bandFromText(text) {
  const m = text.match(/prob_4band["'\s:=>\\]*([A-Za-z ]+?)["'<,\s}]/i) || text.match(/\b(very low|low|medium|high)\b/i);
  if (!m) return undefined;
  const v = m[1].trim().toLowerCase();
  return v in FLOOD_RANK ? v : undefined;
}
async function floodWms(env, lat, lng) {
  const base = env.FLOOD_WMS_URL || FLOOD_WMS;
  const rec = { name: 'wms', url: base };
  try {
    const caps = await floodText(base + '?service=WMS&request=GetCapabilities&version=1.3.0', 3500, rec);
    const layer = pickLayerName(caps);
    if (!layer) throw new Error('no layer in capabilities');
    rec.layer = layer;
    const d = 0.0002;
    const u = base + '?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=' + encodeURIComponent(layer) + '&query_layers=' + encodeURIComponent(layer) +
      '&crs=EPSG:4326&bbox=' + [lat - d, lng - d, lat + d, lng + d].join(',') + '&width=101&height=101&i=50&j=50&info_format=application/json&feature_count=10';
    const txt = await floodText(u, 3500, rec);
    const band = bandFromText(txt);
    if (band === undefined) {
      if (/"features"\s*:\s*\[\s*\]/.test(txt) || /no features|nothing/i.test(txt)) return { band: null, src: 'wms', rec };
      throw new Error('could not read band');
    }
    return { band, src: 'wms', rec };
  } catch (e) {
    rec.note = isTimeout(e) ? 'timeout' : (e && e.message) || 'error';
    e.rec = rec; throw e;
  }
}

async function flood(request, env, ctx, url) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  const lat = parseFloat(url.searchParams.get('lat')), lng = parseFloat(url.searchParams.get('lng'));
  if (!isFinite(lat) || !isFinite(lng) || lat < 49.5 || lat > 55.9 || lng < -6.5 || lng > 2) {
    return json({ error: 'bad lat/lng' }, 400);
  }
  const debug = url.searchParams.get('debug');

  const cache = caches.default;
  if (!debug) { const hit = await cache.match(request); if (hit) return hit; }

  const attempts = [];
  const wrap = p => p.then(r => { attempts.push(r.rec); return r; }, e => { attempts.push(e.rec); throw e; });
  const jobs = floodUrls(env, lat.toFixed(6), lng.toFixed(6)).map(a => wrap(floodArcgis(a)))
    .concat([wrap(floodWms(env, lat, lng))]);
  try {
    const ok = await Promise.any(jobs);
    const body = Object.assign({ ok: true, band: ok.band, src: ok.src, ts: new Date().toISOString() }, debug ? { attempts } : {});
    const res = json(body, 200, { 'Cache-Control': 'public, max-age=86400' });
    if (!debug) ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  } catch (e) {
    await Promise.allSettled(jobs);
    return json({ error: 'upstream: ' + attempts.map(a => a.name + ' ' + (a.note || a.status || '?')).join('; '), attempts }, 502);
  }
}

/* ============================== ROUTER ============================== */
/* ============================ CRIME + OVERPASS (edge-cached) ============================ */
const POLICE = 'https://data.police.uk/api/';
const UA = 'NestUK/1.0 (+https://nestuk.co.uk)';
const CAP_R = 600;                       // keep in step with the page: radius used when police.uk refuses a big query
const snap = v => Math.round(v * 1e4) / 1e4;   // ~11 m; makes repeat searches share one cache entry
const inUK = (lat, lng) => lat > 49.8 && lat < 61 && lng > -8.7 && lng < 2;

function squarePoly(lat, lng, r) {
  const dLat = r / 111320, dLng = r / (111320 * Math.cos(lat * Math.PI / 180));
  const f = n => n.toFixed(6);
  return [[lat + dLat, lng - dLng], [lat + dLat, lng + dLng], [lat - dLat, lng + dLng], [lat - dLat, lng - dLng]]
    .map(p => f(p[0]) + ',' + f(p[1])).join(':');
}
function monthMinus(n, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
  return d.toISOString().slice(0, 7);
}
const cacheKey = (path, params) => new Request('https://cache.nestuk.internal' + path + '?' + new URLSearchParams(params).toString());
const cached = (body, status, maxAge, extra = {}) =>
  json(body, status, { 'Cache-Control': 'public, max-age=' + maxAge, ...extra });

// Returns {res, body}; refreshes via fetchFresh() when missing; on failure serves a long-lived stale copy if any.
async function edgeCached(ctx, key, staleKey, ttl, staleTtl, fetchFresh) {
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  let fresh = null;
  try { fresh = await fetchFresh(); } catch (e) { fresh = null; }
  if (fresh) {
    const res = cached(fresh, 200, ttl, { 'X-Nest-Cache': 'miss' });
    ctx.waitUntil(cache.put(key, res.clone()));
    ctx.waitUntil(cache.put(staleKey, cached(fresh, 200, staleTtl)));
    return res;
  }
  const stale = await cache.match(staleKey);
  if (stale) {
    const body = await stale.json();
    return json({ ...body, stale: true }, 200, { 'Cache-Control': 'no-store', 'X-Nest-Cache': 'stale' });
  }
  return null;
}

async function policeJSON(path) {
  let last = 0;
  for (let i = 0; i < 2; i++) {
    const r = await fetch(POLICE + path, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    last = r.status;
    if (r.ok) return { status: 200, data: await r.json() };
    if (r.status === 503 || r.status === 404) return { status: r.status };   // 503 = too many crimes; 404 = month not published
    if (r.status !== 429 && r.status < 500) break;
    await new Promise(res => setTimeout(res, 800 * (i + 1)));
  }
  return { status: last };
}

async function crimeLastUpdated(request, env, ctx) {
  const res = await edgeCached(ctx, cacheKey('/last', {}), cacheKey('/last-stale', {}), 6 * 3600, 30 * 86400, async () => {
    const r = await policeJSON('crime-last-updated');
    if (r.status !== 200 || !r.data || !r.data.date) return null;
    return { month: String(r.data.date).slice(0, 7) };
  });
  // Both the fresh and stale paths failed: tell the page to use its own guess (three months back is safe).
  return res || json({ month: monthMinus(3), guess: true }, 200, { 'Cache-Control': 'no-store' });
}

async function crime(request, env, ctx, url) {
  const lat = snap(parseFloat(url.searchParams.get('lat'))), lng = snap(parseFloat(url.searchParams.get('lng')));
  const date = url.searchParams.get('date') || '';
  if (!isFinite(lat) || !isFinite(lng) || !inUK(lat, lng) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) return json({ error: 'bad request' }, 400);
  const capped = url.searchParams.get('capped') === '1';
  // Months older than ~3 months never change, so they can live at the edge for a week.
  const old = date < monthMinus(3);
  const ttl = old ? 7 * 86400 : 6 * 3600;
  const params = { lat, lng, date, capped: capped ? 1 : 0 };
  const res = await edgeCached(ctx, cacheKey('/crime', params), cacheKey('/crime-stale', params), ttl, 30 * 86400, async () => {
    let usedCap = capped;
    let r = await policeJSON('crimes-street/all-crime?' + (capped ? 'poly=' + squarePoly(lat, lng, CAP_R) : 'lat=' + lat + '&lng=' + lng) + '&date=' + date);
    if (r.status === 503 && !capped) {
      usedCap = true;
      r = await policeJSON('crimes-street/all-crime?poly=' + squarePoly(lat, lng, CAP_R) + '&date=' + date);
    }
    if (r.status !== 200 || !Array.isArray(r.data)) return null;
    return {
      capped: usedCap,
      list: r.data.map(x => ({ c: x.category, la: +x.location.latitude, ln: +x.location.longitude, s: (x.location.street && x.location.street.name) || '' })),
    };
  });
  return res || json({ error: 'upstream' }, 502);
}

const OVERPASS_MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function runOverpass(query) {
  for (let i = 0; i < OVERPASS_MIRRORS.length; i++) {
    try {
      const r = await fetch(OVERPASS_MIRRORS[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(28000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const els = j.elements || [];
      if (j.remark && /timed out|out of memory/i.test(j.remark) && !els.length) continue;
      return els;
    } catch (e) { /* try the next mirror */ }
  }
  return null;
}

async function overpass(request, env, ctx, url) {
  const kind = url.searchParams.get('kind') || '';
  const lat = snap(parseFloat(url.searchParams.get('lat'))), lng = snap(parseFloat(url.searchParams.get('lng')));
  // Only fixed query kinds, built here: this is not a general Overpass proxy.
  if (!Object.prototype.hasOwnProperty.call(Q, kind) || !isFinite(lat) || !isFinite(lng) || !inUK(lat, lng)) return json({ error: 'bad request' }, 400);
  const params = { kind, lat, lng };
  const res = await edgeCached(ctx, cacheKey('/ov', params), cacheKey('/ov-stale', params), 86400, 30 * 86400, async () => {
    const els = await runOverpass(Q[kind](lat, lng));
    return els ? { elements: els } : null;
  });
  return res || json({ error: 'upstream' }, 502);
}

/* Live flood warnings (Environment Agency flood-monitoring API). The browser often times out calling it directly,
   so the Worker fetches it, caches 10 minutes, and keeps the last good answer for a day. */
async function floodWarnings(request, env, ctx, url) {
  const lat = snap(parseFloat(url.searchParams.get('lat'))), lng = snap(parseFloat(url.searchParams.get('lng')));
  if (!isFinite(lat) || !isFinite(lng) || lat < 49.5 || lat > 55.9 || lng < -6.5 || lng > 2) return json({ error: 'bad lat/lng' }, 400);
  const params = { lat, lng };
  const res = await edgeCached(ctx, cacheKey('/fw', params), cacheKey('/fw-stale', params), 600, 86400, async () => {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch('https://environment.data.gov.uk/flood-monitoring/id/floods?lat=' + lat + '&long=' + lng + '&dist=3', {
          headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(12000),
        });
        if (r.ok) {
          const j = await r.json();
          return { items: ((j && j.items) || []).map(x => ({ severityLevel: x.severityLevel, severity: x.severity || '', description: x.description || '' })) };
        }
      } catch (e) { /* retry once */ }
    }
    return null;
  });
  return res || json({ error: 'upstream' }, 502);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/buses') return buses(request, env, ctx, url);
    if (url.pathname === '/api/hpi') return hpi(request, env, ctx, url);
    if (url.pathname === '/api/flood') return flood(request, env, ctx, url);
    if (url.pathname === '/api/crime-last-updated') return crimeLastUpdated(request, env, ctx);
    if (url.pathname === '/api/flood-warnings') return floodWarnings(request, env, ctx, url);
    if (url.pathname === '/api/crime') return crime(request, env, ctx, url);
    if (url.pathname === '/api/overpass') return overpass(request, env, ctx, url);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};

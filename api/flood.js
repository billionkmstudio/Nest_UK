// Nest UK flood-risk proxy (Vercel Serverless Function).
// Why: browsers cannot always call the Environment Agency ArcGIS service directly (CORS / network blocks).
// GET /api/flood?lat=51.2&lng=-0.57   ->  { ok:true, band:'low'|'very low'|'medium'|'high'|null, src:'...', ts }
// GET /api/flood?lat=..&lng=..&debug=1 -> also returns every attempt's HTTP status and a body snippet.
// Env: ALLOWED_ORIGINS (same as buses.js), FLOOD_QUERY_URL (optional override of the ArcGIS layer /query URL).

const DEFAULT_LAYER = 'https://gisrest.defra.gov.uk/server/rest/services/EA/RiskOfFloodingFromRiversAndSea/MapServer/0/query';
const RANK = { 'very low': 0, low: 1, medium: 2, high: 3 };
const TIMEOUT_MS = 8000;

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || 'https://billionkmstudio.github.io').split(',').map(s => s.trim()).filter(Boolean);
}
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function pickBand(json) {
  let best = null;
  ((json && json.features) || []).forEach(f => {
    const v = String((f.attributes || {}).prob_4band || '').toLowerCase();
    if (v in RANK && (best === null || RANK[v] > RANK[best])) best = v;
  });
  return best;
}

function buildUrls(lat, lng) {
  const base = (process.env.FLOOD_QUERY_URL || DEFAULT_LAYER);
  const common = '?f=json&geometry=' + lng + ',' + lat + '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=prob_4band&returnGeometry=false';
  return [
    { name: 'arcgis+25m', url: base + common + '&distance=25&units=esriSRUnit_Meter' },
    { name: 'arcgis-point', url: base + common }
  ];
}

async function tryOne(a, fetchImpl) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const rec = { name: a.name, url: a.url.split('?')[0] };
  try {
    const r = await fetchImpl(a.url, { signal: ac.signal, headers: { Accept: 'application/json', 'User-Agent': 'nest-uk-flood-proxy/1.0' } });
    rec.status = r.status;
    const text = await r.text();
    rec.snippet = text.slice(0, 160);
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { rec });
    let j;
    try { j = JSON.parse(text); } catch (e) { throw Object.assign(new Error('not JSON'), { rec }); }
    if (j.error) { rec.note = j.error.message || String(j.error.code); throw Object.assign(new Error(rec.note), { rec }); }
    return { band: pickBand(j), src: a.name, rec };
  } catch (e) {
    if (!e.rec) { rec.note = e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'error'; e.rec = rec; }
    throw e;
  } finally { clearTimeout(timer); }
}

async function handler(req, res, fetchImpl) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method' })); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const lat = parseFloat(q.lat), lng = parseFloat(q.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < 49.5 || lat > 55.9 || lng < -6.5 || lng > 2) {
    res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad lat/lng' }));
  }
  const attempts = [];
  const jobs = buildUrls(lat.toFixed(6), lng.toFixed(6)).map(a => tryOne(a, fetchImpl).then(r => { attempts.push(r.rec); return r; }, e => { attempts.push(e.rec); throw e; }));
  try {
    const ok = await Promise.any(jobs);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.statusCode = 200;
    return res.end(JSON.stringify(Object.assign({ ok: true, band: ok.band, src: ok.src, ts: new Date().toISOString() }, q.debug ? { attempts } : {})));
  } catch (e) {
    await Promise.allSettled(jobs);
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: 'upstream: ' + attempts.map(a => a.name + ' ' + (a.status || a.note || '?')).join('; '), attempts }));
  }
}

module.exports = (req, res) => handler(req, res, fetch);
module.exports.handler = handler;
module.exports.pickBand = pickBand;

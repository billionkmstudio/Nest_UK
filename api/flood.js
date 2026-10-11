// Nest UK flood-risk proxy (Vercel Serverless Function).
// Why: browsers cannot always call the Environment Agency ArcGIS service directly (CORS / network blocks).
// GET /api/flood?lat=51.2&lng=-0.57   ->  { ok:true, band:'low'|'very low'|'medium'|'high'|null, src:'...', ts }
// GET /api/flood?lat=..&lng=..&debug=1 -> also returns every attempt's HTTP status and a body snippet.
// Env: ALLOWED_ORIGINS (same as buses.js), FLOOD_QUERY_URL (optional override of the ArcGIS layer /query URL),
//      FLOOD_WMS_URL (optional override of the WMS endpoint).

const DEFAULT_LAYER = 'https://gisrest.defra.gov.uk/server/rest/services/EA/RiskOfFloodingFromRiversAndSea/MapServer/0/query';
const RANK = { 'very low': 0, low: 1, medium: 2, high: 3 };
const TIMEOUT_MS = 6000;   // Vercel Hobby functions stop at ~10 s, so keep every attempt short
const DEFAULT_WMS = 'https://environment.data.gov.uk/spatialdata/risk-of-flooding-from-rivers-and-sea/wms';

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

// Second source: the Defra Data Services Platform WMS (GetCapabilities -> pick the queryable layer -> GetFeatureInfo).
// The layer name is discovered at run time because it is not documented anywhere stable.
async function getText(url, fetchImpl, ms, rec) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetchImpl(url, { signal: ac.signal, headers: { 'User-Agent': 'nest-uk-flood-proxy/1.0' } });
    rec.status = r.status;
    const text = await r.text();
    rec.snippet = text.slice(0, 160);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return text;
  } finally { clearTimeout(timer); }
}
function pickLayerName(xml) {
  const names = [];
  const re = /<Layer[^>]*queryable="1"[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
  let m;
  while ((m = re.exec(xml))) names.push(m[1].trim());
  if (!names.length) { const all = [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map(x => x[1].trim()); return all.find(n => /rofrs|flood|risk/i.test(n)) || all[0] || null; }
  return names.find(n => /rofrs|4band|likelihood|risk/i.test(n)) || names[0];
}
function bandFromText(text) {
  const m = text.match(/prob_4band["'\s:=>\\]*([A-Za-z ]+?)["'<,\s}]/i) || text.match(/\b(very low|low|medium|high)\b/i);
  if (!m) return undefined;
  const v = m[1].trim().toLowerCase();
  return v in RANK ? v : undefined;
}
async function tryWms(lat, lng, fetchImpl) {
  const base = process.env.FLOOD_WMS_URL || DEFAULT_WMS;
  const rec = { name: 'wms', url: base };
  try {
    const caps = await getText(base + '?service=WMS&request=GetCapabilities&version=1.3.0', fetchImpl, 3500, rec);
    const layer = pickLayerName(caps);
    if (!layer) throw new Error('no layer in capabilities');
    rec.layer = layer;
    const d = 0.0002;
    const url = base + '?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=' + encodeURIComponent(layer) + '&query_layers=' + encodeURIComponent(layer) +
      '&crs=EPSG:4326&bbox=' + [lat - d, lng - d, lat + d, lng + d].join(',') + '&width=101&height=101&i=50&j=50&info_format=application/json&feature_count=10';
    const txt = await getText(url, fetchImpl, 3500, rec);
    const band = bandFromText(txt);
    if (band === undefined) {
      if (/"features"\s*:\s*\[\s*\]/.test(txt) || /no features|nothing/i.test(txt)) return { band: null, src: 'wms', rec };
      throw new Error('could not read band');
    }
    return { band, src: 'wms', rec };
  } catch (e) {
    rec.note = e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'error';
    e.rec = rec; throw e;
  }
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
  const wrap = p => p.then(r => { attempts.push(r.rec); return r; }, e => { attempts.push(e.rec); throw e; });
  const jobs = buildUrls(lat.toFixed(6), lng.toFixed(6)).map(a => wrap(tryOne(a, fetchImpl))).concat([wrap(tryWms(lat, lng, fetchImpl))]);
  try {
    const ok = await Promise.any(jobs);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.statusCode = 200;
    return res.end(JSON.stringify(Object.assign({ ok: true, band: ok.band, src: ok.src, ts: new Date().toISOString() }, q.debug ? { attempts } : {})));
  } catch (e) {
    await Promise.allSettled(jobs);
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: 'upstream: ' + attempts.map(a => a.name + ' ' + (a.note || a.status || '?')).join('; '), attempts }));
  }
}

module.exports = (req, res) => handler(req, res, fetch);
module.exports.handler = handler;
module.exports.pickBand = pickBand;

// Nest UK live-bus proxy (Vercel Serverless Function).
// Calls the DfT Bus Open Data Service (BODS) vehicle-location feed with YOUR API key,
// converts the SIRI-VM XML to small JSON, and lets your Nest UK page read it.
//
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   BODS_API_KEY     required. Free key from https://data.bus-data.dft.gov.uk/
//   ALLOWED_ORIGINS  optional, comma separated, e.g. https://billionkmstudio.github.io
//                    (default: https://billionkmstudio.github.io)
//
// Request:  GET /api/buses?bbox=minLon,minLat,maxLon,maxLat   (degrees, max 0.15 x 0.15)
// Response: { ts, count, vehicles: [{ id, line, dest, op, lat, lng, bearing, age }] }

const MAX_SPAN = 0.15;          // degrees; stops people pulling the whole country
const MAX_AGE_S = 600;          // drop positions older than 10 minutes
const UPSTREAM = 'https://data.bus-data.dft.gov.uk/api/v1/datafeed/';

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

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || 'https://billionkmstudio.github.io').split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = async function handler(req, res) {
  const origin = req.headers && req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method' })); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const key = process.env.BODS_API_KEY;
  if (!key) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'BODS_API_KEY is not set on the server' })); }

  const url = new URL(req.url, 'http://localhost');
  const parts = (url.searchParams.get('bbox') || '').split(',').map(Number);
  if (parts.length !== 4 || parts.some(n => !isFinite(n))) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'bbox must be minLon,minLat,maxLon,maxLat' })); }
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (!(minLon < maxLon && minLat < maxLat) || maxLon - minLon > MAX_SPAN || maxLat - minLat > MAX_SPAN ||
      minLat < 49.5 || maxLat > 61 || minLon < -8.7 || maxLon > 2) {
    res.statusCode = 400; return res.end(JSON.stringify({ error: 'bbox outside the UK or larger than ' + MAX_SPAN + ' degrees' }));
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const up = await fetch(UPSTREAM + '?boundingBox=' + [minLon, minLat, maxLon, maxLat].join(',') + '&api_key=' + encodeURIComponent(key), { signal: ac.signal });
    if (!up.ok) {
      res.statusCode = up.status === 401 || up.status === 403 ? 502 : 502;
      return res.end(JSON.stringify({ error: 'upstream HTTP ' + up.status }));
    }
    const xml = await up.text();
    const vehicles = parseSiri(xml, Date.now());
    // Many users watching the same area share one upstream call.
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    res.statusCode = 200;
    return res.end(JSON.stringify({ ts: new Date().toISOString(), count: vehicles.length, vehicles }));
  } catch (e) {
    res.statusCode = 504;
    return res.end(JSON.stringify({ error: e && e.name === 'AbortError' ? 'upstream timeout' : 'upstream failed' }));
  } finally {
    clearTimeout(timer);
  }
};
module.exports.parseSiri = parseSiri;

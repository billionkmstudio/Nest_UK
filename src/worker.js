// Nest UK — Cloudflare Worker
// Serves the static site (public/) and the live-bus proxy at /api/buses.
// Secret required: BODS_API_KEY (Workers & Pages > nest-uk > Settings > Variables and Secrets)

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

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });

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
      UPSTREAM + '?boundingBox=' + [minLon, minLat, maxLon, maxLat].join(',') + '&api_key=' + encodeURIComponent(env.BODS_API_KEY),
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
    return json({ error: e && e.name === 'TimeoutError' ? 'upstream timeout' : 'upstream failed' }, 504);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/buses') return buses(request, env, ctx, url);
    // /api/hpi and /api/flood can be added here later
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};

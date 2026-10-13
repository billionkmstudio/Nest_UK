// Nest UK house-price proxy (Vercel Serverless Function).
// Source: HM Land Registry UK House Price Index (open data, Open Government Licence).
// GET /api/hpi?area=Guildford           -> { ok:true, area, month:'2026-07', averagePrice, detached, semi, terraced, flat, annualChange, salesVolume, src }
// GET /api/hpi?area=Guildford&debug=1   -> also returns every attempt (status / note)
// Env: ALLOWED_ORIGINS (same as the other functions), HPI_BASE (optional override of the data host).

const BASE = () => (process.env.HPI_BASE || 'https://landregistry.data.gov.uk/data/ukhpi/region');
const TIMEOUT_MS = 6000;

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
function months(now) {
  const out = [];
  for (let back = 2; back <= 6; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    out.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
  }
  return out;   // newest first
}
const num = v => { const x = Number(Array.isArray(v) ? v[0] : v); return isFinite(x) && x > 0 ? x : null; };
const chg = v => { const x = Number(Array.isArray(v) ? v[0] : v); return isFinite(x) ? x : null; };

function parse(j) {
  const t = j && j.result && j.result.primaryTopic;
  if (!t) return null;
  const avg = num(t.averagePrice);
  if (avg === null) return null;
  return {
    month: String(t.refMonth || '').slice(0, 7) || null,
    averagePrice: avg,
    detached: num(t.averagePriceDetached), semi: num(t.averagePriceSemiDetached),
    terraced: num(t.averagePriceTerraced), flat: num(t.averagePriceFlatMaisonette),
    annualChange: chg(t.percentageAnnualChange), salesVolume: num(t.salesVolume)
  };
}

async function tryOne(slug, ym, fetchImpl) {
  const url = BASE() + '/' + slug + '/month/' + ym + '.json';
  const rec = { slug, ym, url };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { signal: ac.signal, headers: { Accept: 'application/json', 'User-Agent': 'nest-uk-hpi-proxy/1.0' } });
    rec.status = r.status;
    const text = await r.text();
    rec.snippet = text.slice(0, 120);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error('not JSON'); }
    const data = parse(j);
    if (!data) throw new Error('no data');
    return { slug, data, rec };
  } catch (e) {
    rec.note = e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'error';
    e.rec = rec; throw e;
  } finally { clearTimeout(timer); }
}

async function handler(req, res, fetchImpl, now) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method' })); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const area = String(q.area || '').trim();
  if (!area || area.length > 80) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad area' })); }
  const slugs = slugCandidates(area);
  const yms = months(now || new Date());
  const attempts = [];
  const jobs = [];
  slugs.forEach(s => yms.forEach(ym => jobs.push(tryOne(s, ym, fetchImpl).then(r => { attempts.push(r.rec); return Object.assign({ ym }, r); }, e => { attempts.push(e.rec); return null; }))));
  const results = (await Promise.all(jobs)).filter(Boolean);
  if (!results.length) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: 'upstream: ' + attempts.slice(0, 4).map(a => a.slug + '/' + a.ym + ' ' + (a.note || a.status || '?')).join('; '), slugs, attempts }));
  }
  results.sort((a, b) => (a.data.month < b.data.month ? 1 : -1));
  const best = results[0];
  // 12-month trend: the 11 months before the newest one, same slug, in parallel (failures just leave gaps)
  const [by, bm] = best.data.month.split('-').map(Number);
  const prior = [];
  for (let k = 11; k >= 1; k--) { const d = new Date(Date.UTC(by, bm - 1 - k, 1)); prior.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')); }
  const hist = await Promise.all(prior.map(ym => tryOne(best.slug, ym, fetchImpl).then(r => ({ month: ym, averagePrice: r.data.averagePrice }), () => null)));
  const series = hist.filter(Boolean).concat([{ month: best.data.month, averagePrice: best.data.averagePrice }]);
  res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=604800');
  res.statusCode = 200;
  return res.end(JSON.stringify(Object.assign({ ok: true, area, slug: best.slug, src: 'HM Land Registry UKHPI', ts: new Date().toISOString() }, best.data, { series }, q.debug ? { attempts } : {})));
}

module.exports = (req, res) => handler(req, res, fetch);
module.exports.handler = handler;
module.exports.slugCandidates = slugCandidates;
module.exports.parse = parse;
module.exports.months = months;

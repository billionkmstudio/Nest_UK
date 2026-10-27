/*
 * Nest UK – council housing stock and affordable housing completions for a local authority, from public/data/social-housing.json
 * (built by scripts/build-social-housing.mjs from MHCLG tables). Shared by the page (index.html), the build script and the tests.
 * England only: the data has no Scotland, Wales or Northern Ireland.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NestSocial = factory();
}(typeof self !== 'undefined' ? self : this, function () {

/* One way to compare authority names everywhere (the build script uses this too). */
function norm(s){ return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

/* geo: {lad: GSS code from postcodes.io, district: authority name, country}. By code first (also the other code an authority
   was known by), then by name. Returns {code, rec} or null when the place is outside England or not in the data. */
function find(data, geo){
  if (!data || !data.la || !geo) return null;
  const c = geo.country || '';
  if (c && c !== 'England') return null;
  let code = geo.lad ? ((data.alias && data.alias[geo.lad]) || geo.lad) : '';
  if (!code || !data.la[code]) code = (geo.district && data.names && data.names[norm(geo.district)]) || '';
  return code && data.la[code] ? { code: code, rec: data.la[code] } : null;
}

const sum = a => a.reduce((x, y) => x + y, 0);

/* What the page shows. Each number is only reported when it is above zero, so a council with no homes of its own
   (many gave them to housing associations) just does not get a council-homes figure. */
function summarise(data, rec){
  const years = data.years || [];
  const keys = data.keys || [];
  const yearTotals = years.map(y => ({ y: y, n: sum((rec.s && rec.s[y]) || []) }));
  const latest = years[years.length - 1];
  const latestArr = (rec.s && rec.s[latest]) || [];
  const latestBy = {};
  keys.forEach((k, i) => { if (latestArr[i] > 0) latestBy[k] = latestArr[i]; });
  const total = sum(yearTotals.map(x => x.n));
  const council = rec.c > 0 ? rec.c : 0, ha = rec.h > 0 ? rec.h : 0;
  return {
    name: rec.n,
    council: council,
    ha: ha,
    stockDate: data.stockDate,
    years: yearTotals,
    latestYear: latest,
    latestTotal: sum(latestArr),
    latestBy: latestBy,
    total: total,
    firstYear: years[0],
    // a council with fewer than 100 homes of its own has handed its stock over; say so rather than show a tiny number alone
    transferred: rec.c !== null && rec.c < 100 && ha > 0,
    any: council > 0 || ha > 0 || total > 0
  };
}

/* ---------- homes near a point: Census 2021 output areas (public/data/social-oa/, built by scripts/build-social-oa.mjs) ---------- */
/* The data is cut into tiles of STEP degrees. A row is [dy, dx, all, council, other, shared]; dy and dx are the position
   inside the tile in units of 1/UNIT degree. all = all households, council = rents from council or local authority,
   other = other social rented (housing associations), shared = shared ownership. */
const STEP = 0.25, UNIT = 100000, LNG_BASE = 10;
const tileKey = (lat, lng) => Math.floor(lat / STEP + 1e-9) + '_' + Math.floor((lng + LNG_BASE) / STEP + 1e-9);
function tileOrigin(key){ const p = key.split('_').map(Number); return { lat: p[0] * STEP, lng: p[1] * STEP - LNG_BASE }; }

function metresPerDeg(lat){ return { y: 110574, x: 111320 * Math.cos(lat * Math.PI / 180) }; }

/* every tile a circle of radius r metres around the point can touch */
function tileKeys(lat, lng, r){
  const m = metresPerDeg(lat), dLat = r / m.y, dLng = r / m.x;
  const a = tileKey(lat - dLat, lng - dLng).split('_').map(Number), b = tileKey(lat + dLat, lng + dLng).split('_').map(Number);
  const out = [];
  for (let y = a[0]; y <= b[0]; y++) for (let x = a[1]; x <= b[1]; x++) out.push(y + '_' + x);
  return out;
}

function decodeTile(key, tile){
  const o = tileOrigin(key);
  return ((tile && tile.r) || []).map(r => ({ la: o.lat + r[0] / UNIT, ln: o.lng + r[1] / UNIT, all: r[2], co: r[3], ha: r[4], so: r[5] }));
}

/* the areas within r metres of the point, nearest first, each with its distance d in metres */
function nearby(rows, lat, lng, r){
  const m = metresPerDeg(lat), out = [];
  for (const x of rows){
    const d = Math.hypot((x.la - lat) * m.y, (x.ln - lng) * m.x);
    if (d <= r) out.push(Object.assign({ d: Math.round(d) }, x));
  }
  return out.sort((p, q) => p.d - q.d);
}

/* Census answers are what households said about their own landlord. Where a council has handed its homes to a housing
   association, many tenants still say "council", so the council / housing association split is only reported for
   authorities whose Census "council" count is close to the council's own stock (rec.cr = 1, set by the build script). */
function summariseNear(rows, rec){
  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const within = r => rows.filter(x => x.d <= r);
  const pack = arr => { const so = sum(arr, 'co') + sum(arr, 'ha'); return { social: so, council: sum(arr, 'co'), other: sum(arr, 'ha'), shared: sum(arr, 'so'), all: sum(arr, 'all') }; };
  const a500 = pack(within(500)), a1000 = pack(rows);
  const splitOk = !!(rec && rec.cr === 1);
  const best = rows.filter(x => x.co + x.ha > 0).sort((p, q) => (q.co + q.ha) - (p.co + p.ha) || p.d - q.d)[0] || null;
  const nearest = rows.filter(x => x.co + x.ha > 0)[0] || null;   // rows are already nearest first
  return { r500: a500, r1000: a1000, splitOk: splitOk, nearest: nearest, densest: best, share1000: a1000.all ? a1000.social / a1000.all : null };
}

/* Census data exists for England and Wales only. geo.lad is the authority code from postcodes.io (E.. or W..). */
function covered(geo){
  if (!geo) return false;
  if (geo.lad) return /^[EW]\d/.test(geo.lad);
  return geo.country === 'England' || geo.country === 'Wales';
}

return { norm: norm, find: find, summarise: summarise, STEP: STEP, UNIT: UNIT, tileKey: tileKey, tileOrigin: tileOrigin, tileKeys: tileKeys, decodeTile: decodeTile, nearby: nearby, summariseNear: summariseNear, covered: covered };
}));

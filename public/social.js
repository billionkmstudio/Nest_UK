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

return { norm: norm, find: find, summarise: summarise };
}));

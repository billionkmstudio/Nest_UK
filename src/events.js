// Anonymous usage counts. No cookies, no ids, no addresses: only an event name, one short label
// (language, topic, layer ...), two numbers and the visitor's country (from Cloudflare).
export const EVENTS = ['search', 'geo_fail', 'mod_fail', 'topic', 'layer', 'view', 'share', 'recent', 'map_expand', 'lang'];

const num = x => (typeof x === 'number' && isFinite(x) ? Math.max(0, Math.min(100000, Math.round(x))) : 0);

// raw request body -> Analytics Engine data point, or null when it is not one of ours
export function eventPoint(raw, country) {
  if (typeof raw !== 'string' || raw.length > 400) return null;
  let j;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object' || !EVENTS.includes(j.e)) return null;
  const v = typeof j.v === 'string' && /^[a-z0-9_.-]{0,24}$/i.test(j.v) ? j.v : '';
  const c = typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : '??';
  return { indexes: [j.e], blobs: [j.e, v, c], doubles: [num(j.n), num(j.r)] };
}

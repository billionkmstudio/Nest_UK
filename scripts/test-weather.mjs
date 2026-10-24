// Tests for the forecast summary and /api/weather (stubbed MET Norway reply, no network).
import worker from '../src/worker.js';
import { summariseForecast } from '../src/weather.js';

let fails = 0; const check = (n, ok, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' -> ' + JSON.stringify(x))); };

// Hourly for two days from 2026-10-24 09:00 UTC, then every 6 hours. Clocks go back on 2026-10-25 (BST -> GMT).
const series = [];
const T0 = Date.UTC(2026, 9, 24, 9);
for (let h = 0; h < 48; h++) {
  const ms = T0 + h * 3600e3;
  series.push({ time: new Date(ms).toISOString(), data: {
    instant: { details: { air_temperature: 10 + (h % 12) / 2, wind_speed: 4 + (h === 20 ? 6 : 0), wind_speed_of_gust: 8 } },
    next_1_hours: { summary: { symbol_code: h % 24 < 12 ? 'rain' : 'cloudy' }, details: { precipitation_amount: 0.1 } },
    next_6_hours: { summary: { symbol_code: 'partlycloudy_day' }, details: { precipitation_amount: 0.6 } },
  } });
}
for (let k = 0; k < 24; k++) {
  const ms = T0 + 48 * 3600e3 + k * 6 * 3600e3;
  series.push({ time: new Date(ms).toISOString(), data: { instant: { details: { air_temperature: 7 } }, next_6_hours: { summary: { symbol_code: 'lightrain' }, details: { precipitation_amount: 1 } } } });
}
const reply = { properties: { meta: { updated_at: '2026-10-24T09:30:00Z' }, timeseries: series } };

const days = summariseForecast(reply);
check('three days, in order, London dates', days.length === 3 && days[0].date === '2026-10-24' && days[1].date === '2026-10-25' && days[2].date === '2026-10-26', days.map(d => d.date));
check('min and max temperature are whole degrees', Number.isInteger(days[0].min) && Number.isInteger(days[0].max) && days[0].max >= days[0].min, days[0]);
check('rain adds hourly amounts once (14 hours left today x 0.1 mm, not plus the 6-hourly figures)', days[0].rain === 1.4, days[0].rain);
check('wind is converted to mph (10 m/s = 22 mph)', days.some(d => d.windMph === 22), days.map(d => d.windMph));
check('symbol has no _day/_night suffix', days.every(d => d.symbol && !/_(day|night)$/.test(d.symbol)), days.map(d => d.symbol));
check('empty or odd reply gives no days', summariseForecast({}).length === 0 && summariseForecast(null).length === 0);

const store = new Map();
globalThis.caches = { default: { async match(r) { const v = store.get(r.url); return v ? v.clone() : undefined; }, async put(r, res) { store.set(r.url, res); } } };
let calls = [], metOk = true, lastUA = '';
globalThis.fetch = async (u, o) => { u = String(u); calls.push(u); lastUA = (o && o.headers && o.headers['User-Agent']) || '';
  return u.includes('api.met.no') ? (metOk ? new Response(JSON.stringify(reply)) : new Response('x', { status: 503 })) : new Response('nf', { status: 404 }); };
const get = async p => { const pend = []; const r = await worker.fetch(new Request('https://x.test' + p), {}, { waitUntil: q => pend.push(q) }); await Promise.all(pend); return { r, j: await r.json() }; };

let x = await get('/api/weather?lat=51.2361&lng=-0.5704');
check('weather endpoint ok', x.r.status === 200 && x.j.days.length === 3 && x.j.src === 'MET Norway', x.j);
check('identifying User-Agent and short coordinates sent', /NestUK\/1\.0 https:\/\/nestuk\.co\.uk/.test(lastUA) && /lat=51\.24&lon=-0\.57$/.test(calls[0]), { lastUA, c: calls[0] });
calls = []; x = await get('/api/weather?lat=51.2399&lng=-0.5701');
check('nearby search served from cache', calls.length === 0 && x.j.days.length === 3, calls);
metOk = false; store.clear();
x = await get('/api/weather?lat=53.4&lng=-2.2'); check('upstream down, nothing cached -> 502', x.r.status === 502, x.j);
x = await get('/api/weather?lat=40&lng=10'); check('outside UK rejected', x.r.status === 400, x.j);
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);

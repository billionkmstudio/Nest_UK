// Turns a MET Norway Locationforecast reply into per-day summaries (London dates).

const WEATHER_DAYS = 4;                         // today and the next three days
const londonDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const londonHour = ms => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(new Date(ms)) % 24;

export function summariseForecast(j, days = WEATHER_DAYS) {
  const ts = (j && j.properties && j.properties.timeseries) || [];
  const by = new Map();
  for (const e of ts) {
    const ms = Date.parse(e.time);
    if (!isFinite(ms)) continue;
    const d = londonDate(ms), inst = (e.data && e.data.instant && e.data.instant.details) || {};
    let o = by.get(d);
    if (!o) { o = { date: d, min: null, max: null, rain: 0, wind: 0, gust: 0, sym: null, symDist: 99 }; by.set(d, o); }
    if (typeof inst.air_temperature === 'number') {
      o.min = o.min === null ? inst.air_temperature : Math.min(o.min, inst.air_temperature);
      o.max = o.max === null ? inst.air_temperature : Math.max(o.max, inst.air_temperature);
    }
    if (typeof inst.wind_speed === 'number') o.wind = Math.max(o.wind, inst.wind_speed);
    if (typeof inst.wind_speed_of_gust === 'number') o.gust = Math.max(o.gust, inst.wind_speed_of_gust);
    const n1 = e.data && e.data.next_1_hours, n6 = e.data && e.data.next_6_hours;
    // hourly steps carry next_1_hours; later steps are 6-hourly. Use one or the other so rain is not counted twice.
    if (n1 && n1.details && typeof n1.details.precipitation_amount === 'number') o.rain += n1.details.precipitation_amount;
    else if (n6 && n6.details && typeof n6.details.precipitation_amount === 'number') o.rain += n6.details.precipitation_amount;
    const sym = (n6 && n6.summary && n6.summary.symbol_code) || (n1 && n1.summary && n1.summary.symbol_code);
    const dist = Math.abs(londonHour(ms) - 13);   // the symbol nearest early afternoon stands for the day
    if (sym && dist < o.symDist) { o.sym = sym.replace(/_(day|night|polartwilight)$/, ''); o.symDist = dist; }
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, days).map(o => ({
    date: o.date,
    min: o.min === null ? null : Math.round(o.min), max: o.max === null ? null : Math.round(o.max),
    rain: Math.round(o.rain * 10) / 10,
    windMph: Math.round(o.wind * 2.237), gustMph: Math.round(o.gust * 2.237),
    symbol: o.sym,
  }));
}


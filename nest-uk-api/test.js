// Local test with a made-up SIRI-VM response (no network, no key needed).
const handler = require('./api/buses.js');
const now = Date.now();
const iso = s => new Date(now - s * 1000).toISOString();
const xml = `<?xml version="1.0" encoding="UTF-8"?><Siri xmlns="http://www.siri.org.uk/siri" version="1.3"><ServiceDelivery><VehicleMonitoringDelivery>
<VehicleActivity><RecordedAtTime>${iso(20)}</RecordedAtTime><MonitoredVehicleJourney><LineRef>34</LineRef><DirectionRef>outbound</DirectionRef><PublishedLineName>34</PublishedLineName><OperatorRef>ARBB</OperatorRef><DestinationName>Aylesbury &amp; Town</DestinationName><VehicleLocation><Longitude>-0.7673</Longitude><Latitude>51.8131</Latitude></VehicleLocation><Bearing>270</Bearing><VehicleRef>BX12ABC</VehicleRef></MonitoredVehicleJourney></VehicleActivity>
<VehicleActivity><RecordedAtTime>${iso(20)}</RecordedAtTime><MonitoredVehicleJourney><LineRef>34</LineRef><PublishedLineName>34</PublishedLineName><OperatorRef>ARBB</OperatorRef><VehicleLocation><Longitude>-0.7673</Longitude><Latitude>51.8131</Latitude></VehicleLocation><VehicleRef>BX12ABC</VehicleRef></MonitoredVehicleJourney></VehicleActivity>
<VehicleActivity><RecordedAtTime>${iso(4000)}</RecordedAtTime><MonitoredVehicleJourney><PublishedLineName>X5</PublishedLineName><OperatorRef>OLD</OperatorRef><VehicleLocation><Longitude>-0.77</Longitude><Latitude>51.81</Latitude></VehicleLocation><VehicleRef>OLD1</VehicleRef></MonitoredVehicleJourney></VehicleActivity>
<VehicleActivity><RecordedAtTime>${iso(5)}</RecordedAtTime><MonitoredVehicleJourney><LineRef>9</LineRef><OperatorRef>ARBB</OperatorRef><VehicleLocation><Longitude></Longitude><Latitude>x</Latitude></VehicleLocation><VehicleRef>BAD</VehicleRef></MonitoredVehicleJourney></VehicleActivity>
<VehicleActivity><RecordedAtTime>${iso(8)}</RecordedAtTime><MonitoredVehicleJourney><LineRef>16</LineRef><PublishedLineName>16</PublishedLineName><OperatorRef>CSAB</OperatorRef><DestinationName>Hospital</DestinationName><VehicleLocation><Longitude>-0.75</Longitude><Latitude>51.82</Latitude></VehicleLocation><Bearing>91.4</Bearing><VehicleRef>V2</VehicleRef></MonitoredVehicleJourney></VehicleActivity>
</VehicleMonitoringDelivery></ServiceDelivery></Siri>`;
let upstreamUrl = null, upstreamStatus = 200;
global.fetch = async (u) => { upstreamUrl = u; return { ok: upstreamStatus < 400, status: upstreamStatus, text: async () => xml }; };
const call = (url, headers = {}, method = 'GET') => new Promise(resolve => {
  const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: b ? (b[0] === '{' ? JSON.parse(b) : b) : null }); } };
  handler({ url, method, headers }, res);
});
let fails = 0; const check = (n, ok, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' -> ' + JSON.stringify(x))); };
(async () => {
  process.env.BODS_API_KEY = 'SECRET123';
  let r = await call('/api/buses?bbox=-0.80,51.78,-0.72,51.84', { origin: 'https://billionkmstudio.github.io' });
  check('200 and 2 vehicles (dup, stale and bad-coordinate removed)', r.status === 200 && r.body.count === 2, r.body);
  check('fields parsed', r.body.vehicles[0].line === '34' && r.body.vehicles[0].dest === 'Aylesbury & Town' && r.body.vehicles[0].bearing === 270 && r.body.vehicles[0].age >= 19 && r.body.vehicles[1].bearing === 91, r.body.vehicles);
  check('CORS echoes allowed origin', r.headers['Access-Control-Allow-Origin'] === 'https://billionkmstudio.github.io');
  check('cache header set', /s-maxage=10/.test(r.headers['Cache-Control']));
  check('key sent upstream but never returned', /api_key=SECRET123/.test(upstreamUrl) && !JSON.stringify(r.body).includes('SECRET123'));
  check('bbox passed upstream', /boundingBox=-0.8,51.78,-0.72,51.84/.test(upstreamUrl), upstreamUrl);
  r = await call('/api/buses?bbox=-0.80,51.78,-0.72,51.84', { origin: 'https://evil.example' });
  check('other origin gets no CORS header', !r.headers['Access-Control-Allow-Origin']);
  r = await call('/api/buses?bbox=-3,50,3,55'); check('too-large/outside-UK bbox rejected', r.status === 400, r);
  r = await call('/api/buses?bbox=a,b'); check('garbage bbox rejected', r.status === 400, r);
  r = await call('/api/buses?bbox=-0.80,51.78,-0.72,51.84', {}, 'POST'); check('POST rejected', r.status === 405, r);
  r = await call('/api/buses?bbox=-0.80,51.78,-0.72,51.84', {}, 'OPTIONS'); check('OPTIONS 204', r.status === 204, r);
  upstreamStatus = 401; r = await call('/api/buses?bbox=-0.80,51.78,-0.72,51.84'); check('upstream 401 -> 502 with reason', r.status === 502 && /401/.test(r.body.error), r); upstreamStatus = 200;
  delete process.env.BODS_API_KEY; r = await call('/api/buses?bbox=-0.80,51.78,-0.72,51.84'); check('missing key -> clear 500', r.status === 500 && /BODS_API_KEY/.test(r.body.error), r);
  console.log(fails ? fails + ' FAILURES' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();

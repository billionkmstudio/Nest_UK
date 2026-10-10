const { handler, pickBand } = require('./api/flood');
let fails = 0;
const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
function call(url, fetchImpl, headers) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: b ? JSON.parse(b) : null, headers: this.headers }); } };
    handler({ method: 'GET', url, headers: headers || {} }, res, fetchImpl);
  });
}
const mk = (status, body) => async () => ({ ok: status < 400, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
(async () => {
  ok('pickBand highest', pickBand({ features: [{ attributes: { prob_4band: 'Low' } }, { attributes: { prob_4band: 'High' } }] }) === 'high');
  ok('pickBand none', pickBand({ features: [] }) === null);
  let r = await call('/api/flood?lat=51.2&lng=-0.57', mk(200, { features: [{ attributes: { prob_4band: 'Medium' } }] }), { origin: 'https://billionkmstudio.github.io' });
  ok('success band', r.status === 200 && r.body.band === 'medium', JSON.stringify(r));
  ok('cors header', r.headers['Access-Control-Allow-Origin'] === 'https://billionkmstudio.github.io');
  ok('cache header', /s-maxage/.test(r.headers['Cache-Control'] || ''));
  r = await call('/api/flood?lat=51.2&lng=-0.57', mk(200, { features: [] }));
  ok('no polygon -> band null (still ok)', r.status === 200 && r.body.ok && r.body.band === null);
  r = await call('/api/flood?lat=51.2&lng=-0.57', mk(404, 'Not Found'));
  ok('upstream 404 -> 502 with attempts', r.status === 502 && r.body.attempts.length === 2 && /404/.test(r.body.error), JSON.stringify(r.body));
  r = await call('/api/flood?lat=51.2&lng=-0.57', mk(200, { error: { code: 400, message: 'Unable to complete operation.' } }));
  ok('arcgis error -> 502', r.status === 502 && /Unable/.test(JSON.stringify(r.body)));
  r = await call('/api/flood?lat=51.2&lng=-0.57', async () => { throw new Error('getaddrinfo ENOTFOUND'); });
  ok('network error -> 502', r.status === 502);
  r = await call('/api/flood?lat=10&lng=0', mk(200, {}));
  ok('bad coords -> 400', r.status === 400);
  r = await call('/api/flood?lat=51.2&lng=-0.57&debug=1', mk(200, { features: [] }));
  ok('debug attempts', Array.isArray(r.body.attempts) && r.body.attempts.length >= 1);
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();

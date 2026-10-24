// Tests for the anonymous usage counter (/api/e): only known events, no free text, never fails the page.
import worker from '../src/worker.js';
import { eventPoint } from '../src/events.js';
let fails = 0; const check = (n, ok, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' -> ' + JSON.stringify(x))); };

const p = eventPoint('{"e":"search","v":"zh","n":2,"r":600}', 'HK');
check('search point', p && p.indexes[0] === 'search' && p.blobs.join() === 'search,zh,HK' && p.doubles.join() === '2,600', p);
check('unknown event dropped', eventPoint('{"e":"drop_table"}', 'GB') === null);
check('free text label dropped, event kept', eventPoint('{"e":"topic","v":"GU24 9BW street"}', 'GB').blobs[1] === '');
check('bad json dropped', eventPoint('nope', 'GB') === null && eventPoint('', 'GB') === null && eventPoint(null, 'GB') === null);
check('oversized body dropped', eventPoint('{"e":"search","v":"' + 'a'.repeat(500) + '"}', 'GB') === null);
check('numbers are clamped and whole', eventPoint('{"e":"search","n":-5,"r":1e9}', 'GB').doubles.join() === '0,100000' && eventPoint('{"e":"search","n":"x"}', 'GB').doubles[0] === 0);
check('missing country becomes ??', eventPoint('{"e":"share"}', undefined).blobs[2] === '??' && eventPoint('{"e":"share"}', 'gb').blobs[2] === '??');

const written = [];
const env = { EVENTS: { writeDataPoint: d => written.push(d) } };
const post = (body, e = env, method = 'POST') => worker.fetch(new Request('https://nestuk.co.uk/api/e', { method, body: method === 'POST' ? body : undefined }), e, { waitUntil() {} });
let r = await post('{"e":"layer","v":"fuel","n":0,"r":0}');
check('POST returns 204 and writes one point', r.status === 204 && written.length === 1 && written[0].blobs[1] === 'fuel', [r.status, written]);
r = await post('{"e":"bogus"}');
check('bogus event: 204, nothing written', r.status === 204 && written.length === 1);
r = await post('{"e":"search"}', {});
check('no binding configured: still 204', r.status === 204);
r = await post('{"e":"search"}', { EVENTS: { writeDataPoint() { throw new Error('boom'); } } });
check('binding throws: still 204', r.status === 204);
r = await post(undefined, env, 'GET');
check('GET is refused', r.status === 405);
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);

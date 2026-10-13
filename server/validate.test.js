const test = require('node:test');
const assert = require('node:assert');
const { parseBbox } = require('./validate');

test('accepts a valid Dutch bbox and normalises it', () => {
  assert.strictEqual(parseBbox('52.10,6.75,52.34,7.03'), '52.1000,6.7500,52.3400,7.0300');
});

test('rejects non-strings, wrong arity and non-numbers', () => {
  assert.strictEqual(parseBbox(undefined), null);
  assert.strictEqual(parseBbox(['a']), null);
  assert.strictEqual(parseBbox('1,2,3'), null);
  assert.strictEqual(parseBbox('52,6,abc,7'), null);
});

test('rejects Overpass injection attempts', () => {
  assert.strictEqual(parseBbox('52.1,6.7,52.3,7.0);out;node(1'), null);
  assert.strictEqual(parseBbox('52.1,6.7,52.3,7.0)\n;'), null);
});

test('rejects inverted, out-of-region and oversized boxes', () => {
  assert.strictEqual(parseBbox('52.3,6.7,52.1,7.0'), null);
  assert.strictEqual(parseBbox('40,-74,41,-73'), null);
  assert.strictEqual(parseBbox('51,4,53,6'), null);
});

const { parseLatLng } = require('./validate');
const { decodePolyline } = require('./routePlanner');

test('parseLatLng accepts NL points and rejects junk', () => {
  assert.deepStrictEqual(parseLatLng('52.22,6.89'), { lat: 52.22, lng: 6.89 });
  assert.strictEqual(parseLatLng('52.22'), null);
  assert.strictEqual(parseLatLng('abc,6'), null);
  assert.strictEqual(parseLatLng('40.7,-74'), null);
});

test('decodePolyline decodes the reference example (precision 5)', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepStrictEqual(pts, [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
});

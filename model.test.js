import test from 'node:test';
import assert from 'node:assert/strict';
import { validReading, records, inRange, toCsv } from './model.js';
test('rejects missing readings, impossible ADC values and absent timestamps', () => {
  assert.equal(validReading(null), false);
  assert.equal(validReading({ temperatureC: 28, gasRaw: 4200, timestamp: 123 }), false);
  assert.equal(validReading({ temperatureC: 28, gasRaw: 1000 }), false);
  assert.equal(validReading({ temperatureC: 28, gasRaw: 1000, timestamp: 123 }), true);
});
test('sorts valid persisted samples and selects the requested time window', () => {
  const rows = records({ a: { temperatureC: 28, gasRaw: 1000, timestamp: 5000000 }, b: { temperatureC: 30, gasRaw: 900, timestamp: 1000000 }, invalid: {} });
  assert.deepEqual(rows.map(r => r.id), ['b', 'a']);
  assert.deepEqual(inRange(rows, 1, 5000000).map(r => r.id), ['a']);
});
test('CSV preserves commas and quotes and keeps open event endings empty', () => {
  const csv = toCsv([{ startedAt: 123, reason: 'both', peakTemperatureC: 50.1, peakGasRaw: 2500, endedAt: null }]);
  assert.match(csv, /"123","both","50.1","2500",""/);
});

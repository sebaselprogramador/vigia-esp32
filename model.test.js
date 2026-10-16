import test from 'node:test';
import assert from 'node:assert/strict';
import { validReading, validEvent, records, inRange, eventsInRange, reason } from './model.js';
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
test('rejects readings with non-numeric, non-finite or out-of-range values', () => {
  const good = { temperatureC: 28, gasRaw: 900, timestamp: 1000 };
  for (const invalid of [{ temperatureC: '28' }, { temperatureC: Infinity }, { gasRaw: 1.2 }, { gasRaw: -1 }, { timestamp: NaN }]) {
    assert.equal(validReading({ ...good, ...invalid }), false);
  }
  assert.deepEqual(records(null), []);
  assert.deepEqual(records({ a: false, b: {} }), []);
});

const now = 10_000_000;
const episode = (changes = {}) => ({ startedAt: now - 5000, reason: 'both', peakTemperatureC: 51, peakGasRaw: 2400, ...changes });

test('accepts open and closed episodes and rejects invalid fields', () => {
  assert.equal(validEvent(episode()), true);
  assert.equal(validEvent(episode({ endedAt: null })), true);
  assert.equal(validEvent(episode({ endedAt: now })), true);
  for (const invalid of [null, episode({ reason: 'fire' }), episode({ endedAt: now - 6000 }), episode({ peakGasRaw: 5000 }), episode({ peakTemperatureC: NaN })]) {
    assert.equal(validEvent(invalid), false);
  }
});

test('retains episodes that started earlier but overlap the selected period', () => {
  const ongoing = episode({ startedAt: now - 7_200_000 });
  const overlapping = episode({ startedAt: now - 7_000_000, endedAt: now - 1000 });
  const old = episode({ startedAt: now - 7_200_000, endedAt: now - 4_000_000 });
  const future = episode({ startedAt: now + 61000 });
  assert.deepEqual(eventsInRange([ongoing, overlapping, old, future, null], 1, now), [overlapping, ongoing]);
});

test('records sorts events and ignores corrupted episodes', () => {
  const rows = records({ old: episode({ startedAt: now - 10000 }), invalid: {}, recent: episode() }, validEvent, 'startedAt');
  assert.deepEqual(rows.map(row => row.id), ['old', 'recent']);
});

test('time filters include boundaries and reject excessively future samples', () => {
  const rows = [{ timestamp: now - 3600000 }, { timestamp: now + 60000 }, { timestamp: now + 60001 }];
  assert.deepEqual(inRange(rows, 1, now), rows.slice(0, 2));
});

test('unknown reasons cannot return object prototype properties', () => {
  assert.equal(reason('gas'), 'Señal MQ-7 alta');
  assert.equal(reason('__proto__'), 'Alerta del dispositivo');
  assert.equal(reason('constructor'), 'Alerta del dispositivo');
});

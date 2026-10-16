export const thresholds = { temperatureC: 47.5, gasRaw: 2200 };
export function validReading(value) {
  return !!value && Number.isFinite(value.temperatureC) && value.temperatureC >= -55 && value.temperatureC <= 150
    && Number.isInteger(value.gasRaw) && value.gasRaw >= 0 && value.gasRaw <= 4095
    && Number.isFinite(value.timestamp) && value.timestamp > 0;
}
export function records(value, isValid = validReading, order = 'timestamp') {
  return Object.entries(value || {}).filter(([, row]) => isValid(row))
    .map(([id, row]) => ({ ...row, id })).sort((a, b) => a[order] - b[order]);
}
export function inRange(rows, hours, now = Date.now()) {
  return rows.filter(r => r.timestamp >= now - hours * 3600000 && r.timestamp <= now + 60000);
}
export function reason(value) {
  const labels = { both: 'MQ-7 y temperatura', gas: 'Señal MQ-7 alta', temperature: 'Temperatura alta' };
  return Object.hasOwn(labels, value) ? labels[value] : 'Alerta del dispositivo';
}
export function validEvent(row) {
  return !!row && Number.isFinite(row.startedAt) && row.startedAt > 0
    && ['gas', 'temperature', 'both'].includes(row.reason)
    && Number.isFinite(row.peakTemperatureC) && row.peakTemperatureC >= -55 && row.peakTemperatureC <= 150
    && Number.isInteger(row.peakGasRaw) && row.peakGasRaw >= 0 && row.peakGasRaw <= 4095
    && (row.endedAt == null || Number.isFinite(row.endedAt) && row.endedAt >= row.startedAt);
}
export function eventsInRange(rows, hours, now = Date.now()) {
  return rows.filter(row => validEvent(row) && row.startedAt <= now + 60000
    && (row.endedAt ?? now) >= now - hours * 3600000).sort((a, b) => b.startedAt - a.startedAt);
}
export function toCsv(rows) {
  const fields = ["startedAt", "reason", "peakTemperatureC", "peakGasRaw", "endedAt"];
  const cell = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  return "\uFEFF" + fields.join(",") + "\r\n" + rows.map(r => fields.map(f => cell(r[f])).join(",")).join("\r\n");
}

export const thresholds = { temperatureC: 47.5, gasRaw: 2200 };
export function validReading(value) {
  return !!value && Number.isFinite(value.temperatureC) && value.temperatureC >= -55 && value.temperatureC <= 150
    && Number.isInteger(value.gasRaw) && value.gasRaw >= 0 && value.gasRaw <= 4095
    && Number.isFinite(value.timestamp) && value.timestamp > 0;
}
export function records(value) {
  return Object.entries(value || {}).filter(([, v]) => validReading(v))
    .map(([id, v]) => ({ ...v, id })).sort((a, b) => a.timestamp - b.timestamp);
}
export function inRange(rows, hours, now = Date.now()) {
  return rows.filter(r => r.timestamp >= now - hours * 3600000 && r.timestamp <= now + 60000);
}
export function reason(value) {
  if (value === "both") return "MQ-7 y temperatura";
  if (value === "gas") return "Señal MQ-7 alta";
  if (value === "temperature") return "Temperatura alta";
  return "Alerta del dispositivo";
}
export function toCsv(rows) {
  const fields = ["startedAt", "reason", "peakTemperatureC", "peakGasRaw", "endedAt"];
  const cell = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  return "\uFEFF" + fields.join(",") + "\r\n" + rows.map(r => fields.map(f => cell(r[f])).join(",")).join("\r\n");
}

import { firebaseConfig, deviceId, staleAfterMs } from './config.js';
import { thresholds, validReading, records, inRange, reason, toCsv } from './model.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const date = ms => Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleString('es', { dateStyle: 'short', timeStyle: 'medium' }) : '—';
let mode = 'demo', current = null, samples = [], events = [], sensor = 'temperatureC', connected = false;
let demoTimer, forcedAlert = false, openEpisode = null, auth, authApi, firebasePromise, unsubscribe = [];

function message(text = '') { $('message').textContent = text; $('message').hidden = !text; }
function activeLabel(id, value) {
  $(id).textContent = typeof value === 'boolean' ? value ? 'Encendido' : 'Apagado' : 'Sin reporte';
  $(id).classList.toggle('active', value === true);
}
function renderCurrent() {
  const recent = validReading(current) && Date.now() - current.timestamp <= staleAfterMs && current.timestamp <= Date.now() + 60000;
  const stale = mode === 'live' && (!connected || !recent);
  const valid = validReading(current);
  const reportedAlarm = valid && typeof current.alarm === 'boolean' ? current.alarm : null;
  $('source-badge').textContent = mode === 'demo' ? 'Demostración' : 'Firebase';
  $('demo-notice').hidden = mode !== 'demo';
  $('connect').hidden = mode === 'live'; $('logout').hidden = mode !== 'live';
  $('last-update').textContent = valid ? 'Última lectura: ' + date(current.timestamp) : 'Esperando datos del ESP32';
  $('connection').textContent = mode === 'demo' ? 'Datos de ejemplo' : !connected ? 'Sin conexión' : !recent ? 'Sin lectura reciente' : 'Datos recientes';
  $('status-panel').classList.toggle('alert', reportedAlarm === true && !stale);
  $('status-panel').classList.toggle('stale', stale || !valid || reportedAlarm === null);
  $('status-title').textContent = stale ? 'Estado actual desconocido' : !valid ? 'Esperando lectura' : reportedAlarm === null ? 'Alarma sin reporte' : reportedAlarm ? 'Alerta del dispositivo' : 'Sin alarma reportada';
  const causes = valid ? [current.gasRaw >= thresholds.gasRaw && 'Señal del MQ-7 sobre el umbral', current.temperatureC >= thresholds.temperatureC && 'Temperatura sobre el umbral'].filter(Boolean).join(' · ') : '';
  $('status-description').textContent = stale ? 'Las lecturas y los actuadores mostrados son el último reporte recibido.' : !valid ? 'El dispositivo aún no envió una lectura válida.' : causes || (reportedAlarm === null ? 'Falta el campo de alarma en los datos del dispositivo.' : 'Ambos sensores están por debajo de sus umbrales configurados.');
  $('temperature').textContent = valid ? number.format(current.temperatureC) : '—';
  $('gas').textContent = valid ? number.format(current.gasRaw) : '—';
  $('temp-meter').style.width = valid ? Math.max(0, Math.min(100, current.temperatureC / 80 * 100)) + '%' : '0';
  $('gas-meter').style.width = valid ? current.gasRaw / 4095 * 100 + '%' : '0';
  $('temp-state').textContent = valid ? current.temperatureC >= thresholds.temperatureC ? 'Sobre el umbral' : 'Bajo el umbral' : 'Sin lectura';
  $('gas-state').textContent = valid ? current.gasRaw >= thresholds.gasRaw ? 'Sobre el umbral' : 'Bajo el umbral' : 'Sin lectura';
  activeLabel('buzzer', current?.buzzer); activeLabel('pump1', current?.pump1); activeLabel('pump2', current?.pump2);
}
function svgNode(tag, attrs = {}, text = '') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}
function renderChart() {
  const hours = Number($('range').value), rows = inRange(samples, hours);
  $('sample-count').textContent = `${rows.length} muestras en el período`;
  const unit = sensor === 'temperatureC' ? '°C' : 'ADC';
  $('peak').textContent = rows.length ? `Pico del período: ${number.format(Math.max(...rows.map(r => r[sensor])))} ${unit}` : 'Pico: sin datos';
  $('chart').replaceChildren();
  if (!rows.length) { $('chart').textContent = 'No hay muestras guardadas para este período.'; return; }
  const W = Math.max(320, $('chart').clientWidth), H = 250, left = 46, right = 14, top = 18, bottom = 34;
  const start = Date.now() - hours * 3600000, end = Date.now();
  const min = Math.min(0, ...rows.map(r => r[sensor]));
  const max = sensor === 'gasRaw' ? 4095 : Math.max(60, ...rows.map(r => r.temperatureC)) * 1.08;
  const x = t => left + Math.max(0, Math.min(1, (t - start) / (end - start))) * (W - left - right);
  const y = v => H - bottom - (v - min) / (max - min) * (H - top - bottom);
  const svg = svgNode('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * i / 4;
    svg.append(svgNode('line', { x1: left, x2: W - right, y1: y(v), y2: y(v), stroke: '#e3eaf1' }));
    svg.append(svgNode('text', { x: left - 8, y: y(v) + 4, 'text-anchor': 'end', fill: '#566779', 'font-size': 11 }, number.format(v)));
  }
  svg.append(svgNode('line', { x1: left, x2: W - right, y1: y(thresholds[sensor]), y2: y(thresholds[sensor]), stroke: '#b42318', 'stroke-dasharray': '5 5' }));
  const gapLimit = mode === 'demo' ? 6 * 60000 : 2 * 60000;
  let previous = null;
  const path = rows.map(r => { const move = !previous || r.timestamp - previous.timestamp > gapLimit; previous = r; return `${move ? 'M' : 'L'}${x(r.timestamp).toFixed(1)},${y(r[sensor]).toFixed(1)}`; }).join(' ');
  svg.append(svgNode('path', { d: path, fill: 'none', stroke: '#175cd3', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }));
  if (rows.length === 1) svg.append(svgNode('circle', { cx: x(rows[0].timestamp), cy: y(rows[0][sensor]), r: 4, fill: '#175cd3' }));
  for (let i = 0; i <= 3; i++) {
    const t = start + (end - start) * i / 3;
    svg.append(svgNode('text', { x: x(t), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === 3 ? 'end' : 'middle', fill: '#566779', 'font-size': 11 }, new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })));
  }
  $('chart').append(svg);
  $('chart').setAttribute('aria-label', `Gráfica de ${sensor === 'temperatureC' ? 'temperatura' : 'señal MQ-7'}, ${rows.length} muestras. ${$('peak').textContent}.`);
}
function visibleEvents() { return events.filter(e => e.startedAt >= Date.now() - Number($('range').value) * 3600000).sort((a, b) => b.startedAt - a.startedAt); }
function renderEvents() {
  const rows = visibleEvents(); $('events').replaceChildren(); $('export').disabled = !rows.length;
  for (const event of rows) {
    const tr = document.createElement('tr');
    for (const [i, text] of [date(event.startedAt), reason(event.reason), Number.isFinite(event.peakTemperatureC) ? number.format(event.peakTemperatureC) + ' °C' : '—', Number.isFinite(event.peakGasRaw) ? number.format(event.peakGasRaw) + ' ADC' : '—', event.endedAt ? date(event.endedAt) : 'En curso'].entries()) {
      const td = document.createElement('td');
      if (i === 1) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = text; td.append(badge); } else td.textContent = text;
      tr.append(td);
    }
    $('events').append(tr);
  }
  if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5; td.className = 'empty'; td.textContent = 'No hay episodios guardados en este período.'; tr.append(td); $('events').append(tr); }
  $('events-count').textContent = `${rows.length} episodios en el período. ${mode === 'live' ? 'Se consultan los últimos 200 eventos guardados.' : 'Historial simulado; no se guarda en Firebase.'}`;
}
function render() { renderCurrent(); renderChart(); renderEvents(); }
function demoReading(timestamp, index, alert = false) {
  const temperatureC = alert ? 50.2 + Math.sin(index) * 1.6 : 27 + Math.sin(index / 8) * 3 + Math.cos(index / 3) * .7;
  const gasRaw = Math.round(alert ? 2700 + Math.sin(index / 2) * 240 : 820 + Math.sin(index / 5) * 170);
  return { timestamp, temperatureC, gasRaw, alarm: alert, buzzer: alert, pump1: alert, pump2: alert };
}
function startDemo() {
  clearInterval(demoTimer); mode = 'demo'; connected = false; forcedAlert = false; openEpisode = null;
  $('demo-scenario').textContent = 'Simular alerta'; message(); samples = []; events = [];
  const now = Date.now();
  for (let i = 0; i < 288; i++) {
    const time = now - (287 - i) * 5 * 60000;
    const alarm = i >= 144 && i <= 148 || i >= 264 && i <= 267;
    const row = demoReading(time, i, alarm); samples.push(row);
    if (alarm && !openEpisode) { openEpisode = { id: String(i), startedAt: time, endedAt: null, reason: 'both', peakTemperatureC: row.temperatureC, peakGasRaw: row.gasRaw }; events.push(openEpisode); }
    if (alarm) { openEpisode.peakTemperatureC = Math.max(openEpisode.peakTemperatureC, row.temperatureC); openEpisode.peakGasRaw = Math.max(openEpisode.peakGasRaw, row.gasRaw); }
    if (!alarm && openEpisode) { openEpisode.endedAt = time; openEpisode = null; }
  }
  current = samples.at(-1); render();
  demoTimer = setInterval(() => {
    const row = demoReading(Date.now(), samples.length, forcedAlert); current = row; samples.push(row); samples = samples.slice(-1000);
    if (forcedAlert && !openEpisode) { openEpisode = { id: String(row.timestamp), startedAt: row.timestamp, endedAt: null, reason: 'both', peakTemperatureC: row.temperatureC, peakGasRaw: row.gasRaw }; events.push(openEpisode); }
    if (forcedAlert) { openEpisode.peakTemperatureC = Math.max(openEpisode.peakTemperatureC, row.temperatureC); openEpisode.peakGasRaw = Math.max(openEpisode.peakGasRaw, row.gasRaw); }
    if (!forcedAlert && openEpisode) { openEpisode.endedAt = row.timestamp; openEpisode = null; }
    render();
  }, 3000);
}
function detach() { unsubscribe.forEach(fn => fn()); unsubscribe = []; connected = false; }
async function initializeFirebase() {
  if (firebasePromise) return firebasePromise;
  if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL || !firebaseConfig.projectId || !firebaseConfig.authDomain || !firebaseConfig.appId) throw new Error('Primero completa config.js con la configuración web de tu proyecto de Firebase. Consulta README.md.');
  if (!/^[A-Za-z0-9_-]+$/.test(deviceId)) throw new Error('El identificador del dispositivo no es válido.');
  firebasePromise = (async () => {
    const [appApi, dbApi, userApi] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js')
    ]);
    const app = appApi.initializeApp(firebaseConfig); authApi = userApi; auth = userApi.getAuth(app);
    await userApi.setPersistence(auth, userApi.browserSessionPersistence);
    const db = dbApi.getDatabase(app);
    userApi.onAuthStateChanged(auth, user => {
      detach();
      if (!user) { if (mode === 'live') startDemo(); return; }
      clearInterval(demoTimer); mode = 'live'; current = null; samples = []; events = []; message(); render();
      const fail = () => { message('No se pudo leer Firebase. Revisa las reglas y que tu usuario tenga permiso para este dispositivo.'); connected = false; renderCurrent(); };
      unsubscribe.push(dbApi.onValue(dbApi.ref(db, '.info/connected'), snap => { connected = snap.val() === true; renderCurrent(); }, fail));
      unsubscribe.push(dbApi.onValue(dbApi.ref(db, `devices/${deviceId}/current`), snap => {
        const value = snap.val(); current = validReading(value) ? value : null;
        if (value && !current) message('El ESP32 envió una lectura con formato inválido. Revisa el contrato de datos del README.');
        renderCurrent();
      }, fail));
      unsubscribe.push(dbApi.onValue(dbApi.query(dbApi.ref(db, `devices/${deviceId}/samples`), dbApi.orderByChild('timestamp'), dbApi.limitToLast(1000)), snap => { samples = records(snap.val()); renderChart(); }, fail));
      unsubscribe.push(dbApi.onValue(dbApi.query(dbApi.ref(db, `devices/${deviceId}/events`), dbApi.orderByChild('startedAt'), dbApi.limitToLast(200)), snap => {
        events = Object.entries(snap.val() || {}).filter(([, v]) => v && Number.isFinite(v.startedAt)).map(([id, v]) => ({ ...v, id })); renderEvents();
      }, fail));
    });
  })();
  try { await firebasePromise; } catch (error) { firebasePromise = null; throw error; }
}
function friendlyError(error) {
  if (error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') return 'Correo o contraseña incorrectos.';
  if (error.code === 'auth/too-many-requests') return 'Demasiados intentos. Espera antes de volver a iniciar sesión.';
  if (error.code === 'auth/network-request-failed') return 'No se pudo conectar. Revisa tu conexión a Internet.';
  if (error.code === 'auth/operation-not-allowed') return 'Activa el acceso por correo y contraseña en Firebase Authentication.';
  return error.code ? 'No se pudo iniciar sesión. Revisa la configuración de Firebase y tu cuenta.' : error.message;
}
$('connect').addEventListener('click', () => { $('login-error').textContent = ''; $('login-dialog').showModal(); $('email').focus(); });
$('close-dialog').addEventListener('click', () => $('login-dialog').close());
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('login-submit').disabled = true; $('login-error').textContent = '';
  try { await initializeFirebase(); await authApi.signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value); $('password').value = ''; $('login-dialog').close(); }
  catch (error) { $('login-error').textContent = friendlyError(error); }
  finally { $('login-submit').disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await authApi.signOut(auth); } catch { message('No se pudo cerrar la sesión. Inténtalo nuevamente.'); } });
$('demo-scenario').addEventListener('click', () => { forcedAlert = !forcedAlert; $('demo-scenario').textContent = forcedAlert ? 'Finalizar alerta simulada' : 'Simular alerta'; });
$('range').addEventListener('change', () => { renderChart(); renderEvents(); });
document.querySelectorAll('[data-sensor]').forEach(button => button.addEventListener('click', () => {
  sensor = button.dataset.sensor; document.querySelectorAll('[data-sensor]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); renderChart();
}));
$('export').addEventListener('click', () => {
  const blob = new Blob([toCsv(visibleEvents())], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `alertas-${mode}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
new ResizeObserver(() => renderChart()).observe($('chart'));
setInterval(() => { if (mode === 'live') render(); }, 5000);
startDemo();
if (firebaseConfig.apiKey && firebaseConfig.databaseURL) initializeFirebase().catch(error => message(friendlyError(error)));

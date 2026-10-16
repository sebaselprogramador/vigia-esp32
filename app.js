import { firebaseConfig, deviceId, staleAfterMs } from './config.js';
import { thresholds, validReading, validEvent, records, inRange, eventsInRange, reason, toCsv } from './model.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const date = ms => Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleString('es', { dateStyle: 'short', timeStyle: 'medium' }) : '—';
let signedIn = false, current = null, samples = [], events = [], sensor = 'temperatureC', connected = false;
let auth, authApi, firebasePromise, unsubscribe = [];

function message(text = '') { $('message').textContent = text; $('message').hidden = !text; }
function activeLabel(id, value) {
  $(id).textContent = typeof value === 'boolean' ? value ? 'Encendido' : 'Apagado' : 'Sin reporte';
  $(id).classList.toggle('active', value === true);
}
function renderCurrent() {
  const valid = validReading(current);
  const recent = valid && Date.now() - current.timestamp <= staleAfterMs && current.timestamp <= Date.now() + 60000;
  const stale = signedIn && (!connected || !recent);
  const reportedAlarm = valid && typeof current.alarm === 'boolean' ? current.alarm : null;
  $('source-badge').textContent = signedIn ? 'Firebase' : 'Sin sesión';
  $('connect').hidden = signedIn; $('logout').hidden = !signedIn;
  $('last-update').textContent = valid ? 'Última lectura: ' + date(current.timestamp) : 'Esperando datos del ESP32';
  $('connection').textContent = !signedIn ? 'Sin sesión' : !connected ? 'Sin conexión' : !recent ? 'Sin lectura reciente' : 'Datos recientes';
  $('status-panel').classList.toggle('alert', reportedAlarm === true && !stale);
  $('status-panel').classList.toggle('stale', stale || !valid || reportedAlarm === null);
  $('status-title').textContent = !signedIn ? 'Inicia sesión para ver el ESP32' : stale ? 'Estado actual desconocido' : !valid ? 'Esperando lectura' : reportedAlarm === null ? 'Alarma sin reporte' : reportedAlarm ? 'Alerta del dispositivo' : 'Sin alarma reportada';
  const causes = valid ? [current.gasRaw >= thresholds.gasRaw && 'Señal del MQ-7 sobre el umbral', current.temperatureC >= thresholds.temperatureC && 'Temperatura sobre el umbral'].filter(Boolean).join(' · ') : '';
  $('status-description').textContent = !signedIn ? 'Se mostrarán únicamente lecturas reales de Firebase.'
    : stale ? 'Sin lectura reciente. Los valores visibles corresponden al último reporte recibido.'
    : !valid ? 'El dispositivo aún no envió una lectura válida.'
    : reportedAlarm === null ? 'Falta el campo de alarma en los datos del dispositivo.'
    : causes || (reportedAlarm ? 'El dispositivo mantiene una alarma activa.' : 'Ambos sensores están por debajo de sus umbrales configurados.');
  $('temperature').textContent = valid ? number.format(current.temperatureC) : '—';
  $('gas').textContent = valid ? number.format(current.gasRaw) : '—';
  $('temp-meter').style.width = valid ? Math.max(0, Math.min(100, current.temperatureC / 80 * 100)) + '%' : '0';
  $('gas-meter').style.width = valid ? current.gasRaw / 4095 * 100 + '%' : '0';
  $('temp-state').textContent = valid ? current.temperatureC >= thresholds.temperatureC ? 'Sobre el umbral' : 'Bajo el umbral' : 'Sin lectura';
  $('gas-state').textContent = valid ? current.gasRaw >= thresholds.gasRaw ? 'Sobre el umbral' : 'Bajo el umbral' : 'Sin lectura';
  activeLabel('buzzer', current?.buzzer); activeLabel('pump1', current?.pump1); activeLabel('pump2', current?.pump2);
}
function renderChart() {
  const hours = Number($('range').value), rows = inRange(samples, hours);
  $('sample-count').textContent = `${rows.length} muestras en el período`;
  const unit = sensor === 'temperatureC' ? '°C' : 'ADC';
  $('peak').textContent = rows.length ? `Pico del período: ${number.format(Math.max(...rows.map(r => r[sensor])))} ${unit}` : 'Pico: sin datos';
  $('chart').replaceChildren();
  if (!rows.length) { $('chart').textContent = 'No hay muestras guardadas para este período.'; return; }
  const W = Math.max(320, $('chart').clientWidth), H = 250, end = Date.now(), start = end - hours * 3600000;
  const values = rows.map(row => row[sensor]), min = Math.min(0, ...values);
  const max = sensor === 'gasRaw' ? 4095 : Math.max(60, ...values) * 1.08;
  const x = t => 46 + Math.max(0, Math.min(1, (t - start) / (end - start))) * (W - 60);
  const y = value => 216 - (value - min) / (max - min) * 198;
  const line = (value, alert = false) => `<line x1="46" x2="${W - 14}" y1="${y(value)}" y2="${y(value)}" stroke="${alert ? '#b42318' : '#e3eaf1'}" ${alert ? 'stroke-dasharray="5 5"' : ''}/>`;
  const label = (text, x, y, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="#566779" font-size="11">${text}</text>`;
  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = min + (max - min) * i / 4;
    return line(value) + label(number.format(value), 38, y(value) + 4, 'end');
  }).join('');
  let previous = null;
  const path = rows.map(r => { const move = !previous || r.timestamp - previous.timestamp > 120000; previous = r; return `${move ? 'M' : 'L'}${x(r.timestamp).toFixed(1)},${y(r[sensor]).toFixed(1)}`; }).join(' ');
  const times = Array.from({ length: 4 }, (_, i) => {
    const t = start + (end - start) * i / 3;
    return label(new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }), x(t), H - 8, i === 0 ? 'start' : i === 3 ? 'end' : 'middle');
  }).join('');
  // Solo números ya validados, horas formateadas y atributos constantes entran al SVG.
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${grid}${line(thresholds[sensor], true)}<path d="${path}" fill="none" stroke="#175cd3" stroke-width="2.4" stroke-linejoin="round"/>${rows.length === 1 ? `<circle cx="${x(rows[0].timestamp)}" cy="${y(values[0])}" r="4" fill="#175cd3"/>` : ''}${times}</svg>`;
  $('chart').setAttribute('aria-label', `Gráfica de ${sensor === 'temperatureC' ? 'temperatura' : 'señal MQ-7'}, ${rows.length} muestras. ${$('peak').textContent}.`);
}
function visibleEvents() { return eventsInRange(events, Number($('range').value)); }
function renderEvents() {
  const rows = visibleEvents(); $('events').replaceChildren(); $('export').disabled = !rows.length;
  // Los datos pasan por validEvent; cada celda usa textContent, nunca HTML remoto.
  for (const event of rows) {
    const tr = document.createElement('tr');
    const cells = [date(event.startedAt), reason(event.reason), `${number.format(event.peakTemperatureC)} °C`,
      `${number.format(event.peakGasRaw)} ADC`, event.endedAt == null ? 'En curso' : date(event.endedAt)];
    cells.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (index === 1) {
        const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = value; td.replaceChildren(badge);
      }
      tr.append(td);
    });
    $('events').append(tr);
  }
  if (!rows.length) $('events').innerHTML = '<tr><td colspan="5" class="empty">No hay episodios guardados en este período.</td></tr>';
  $('events-count').textContent = `${rows.length} episodios en el período. Se consultan los últimos 200 eventos guardados.`;
}
function render() { renderCurrent(); renderChart(); renderEvents(); }
function detach() { unsubscribe.forEach(fn => fn()); unsubscribe = []; connected = false; }
async function initializeFirebase() {
  if (firebasePromise) return firebasePromise;
  if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL || !firebaseConfig.projectId || !firebaseConfig.authDomain || !firebaseConfig.appId) throw new Error('Primero completa config.js con la configuración web de tu proyecto de Firebase. Consulta README.md.');
  if (!/^[A-Za-z0-9_-]+$/.test(deviceId)) throw new Error('El identificador del dispositivo no es válido.');
  firebasePromise = (async () => {
    const [appApi, dbApi, userApi] = await Promise.all(['app', 'database', 'auth']
      .map(service => import(`https://www.gstatic.com/firebasejs/12.19.0/firebase-${service}.js`)));
    const app = appApi.initializeApp(firebaseConfig); authApi = userApi; auth = userApi.getAuth(app);
    await userApi.setPersistence(auth, userApi.browserSessionPersistence);
    const db = dbApi.getDatabase(app);
    userApi.onAuthStateChanged(auth, user => {
      detach(); signedIn = !!user; current = null; samples = []; events = []; message(); render();
      if (!user) return;
      const fail = () => { message('No se pudo leer Firebase. Revisa las reglas y que tu usuario tenga permiso para este dispositivo.'); connected = false; renderCurrent(); };
      const watch = (path, handle, ...filters) => {
        const reference = dbApi.ref(db, path);
        unsubscribe.push(dbApi.onValue(filters.length ? dbApi.query(reference, ...filters) : reference, snap => handle(snap.val()), fail));
      };
      const base = `devices/${deviceId}`;
      watch('.info/connected', value => { connected = value === true; renderCurrent(); });
      watch(`${base}/current`, value => {
        current = validReading(value) ? value : null;
        if (value && !current) message('El ESP32 envió una lectura con formato inválido. Revisa el contrato de datos del README.');
        renderCurrent();
      });
      watch(`${base}/samples`, value => { samples = records(value); renderChart(); }, dbApi.orderByChild('timestamp'), dbApi.limitToLast(1000));
      watch(`${base}/events`, value => { events = records(value, validEvent, 'startedAt'); renderEvents(); }, dbApi.orderByChild('startedAt'), dbApi.limitToLast(200));
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
$('range').addEventListener('change', () => { renderChart(); renderEvents(); });
document.querySelectorAll('[data-sensor]').forEach(button => button.addEventListener('click', () => {
  sensor = button.dataset.sensor; document.querySelectorAll('[data-sensor]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); renderChart();
}));
$('export').addEventListener('click', () => {
  const blob = new Blob([toCsv(visibleEvents())], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `alertas-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
new ResizeObserver(() => renderChart()).observe($('chart'));
setInterval(() => { if (signedIn) render(); }, 5000);
render();
if (firebaseConfig.apiKey && firebaseConfig.databaseURL) initializeFirebase().catch(error => message(friendlyError(error)));

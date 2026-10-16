import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

// Ejecuta app.js sin cambiarlo. Solo sustituye DOM y servicios externos por dobles.
async function openApp() {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const elements = new Map(), listeners = new Map(), intervals = [], downloads = [];
  const clock = { now: 1_800_000_000_000 };
  class Element {
    constructor() { this.children = []; this.style = {}; this.attributes = {}; this.handlers = {}; this.dataset = {}; this.clientWidth = 720; this.value = ''; this.hidden = false; this.disabled = false; this.text = ''; this.html = ''; this.classes = new Set(); this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.children = []; this.html = ''; }
    get innerHTML() { return this.html; }
    set innerHTML(value) { this.html = value; this.text = ''; this.children = []; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; this.text = ''; this.html = ''; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, handle) { this.handlers[name] = handle; }
    async fire(name) { await this.handlers[name]?.({ preventDefault() {} }); }
    click() { if (this.download) downloads.push(this); return this.fire('click'); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() {}
  }
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) elements.set(id, new Element());
  elements.get('range').value = '24';
  const buttons = ['temperatureC', 'gasRaw'].map(sensor => Object.assign(new Element(), { dataset: { sensor } }));
  const control = { clock, elements, buttons, downloads, listeners, unsubscribed: 0 };
  control.audioNodes = [];
  class AudioNode {
    constructor() { this.frequency = {}; this.gain = {}; this.started = false; this.stopped = false; control.audioNodes.push(this); }
    connect() {}
    disconnect() {}
    start() { this.started = true; }
    stop() { this.stopped = true; }
  }
  class AudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; control.audio = this; }
    async resume() { if (control.audioBlocked) throw new Error('blocked'); this.state = 'running'; }
    createOscillator() { return new AudioNode(); }
    createGain() { return new AudioNode(); }
  }
  const context = createContext({
    document: { getElementById: id => elements.get(id), createElement: () => new Element(), querySelectorAll: () => buttons },
    Date: class extends Date { static now() { return clock.now; } },
    Intl, Blob, console, AudioContext,
    URL: { createObjectURL: blob => { control.csv = blob; return 'blob:test'; }, revokeObjectURL() {} },
    ResizeObserver: class { observe() {} },
    setInterval: handle => intervals.push(handle), setTimeout: handle => handle()
  });
  const services = {
    app: { initializeApp: () => ({}) },
    auth: {
      getAuth: () => ({}), browserSessionPersistence: 'session', setPersistence: async () => {},
      onAuthStateChanged: (_, handle) => { control.auth = handle; handle(null); },
      signInWithEmailAndPassword: async () => control.auth({ uid: 'viewer' }),
      signOut: async () => control.auth(null)
    },
    database: {
      getDatabase: () => ({}), ref: (_, path) => ({ path }), query: (ref, ...filters) => ({ ...ref, filters }),
      orderByChild: order => ({ order }), limitToLast: limit => ({ limit }),
      onValue: (ref, next, fail) => {
        listeners.set(ref.path, { ...ref, next, fail });
        return () => { listeners.delete(ref.path); control.unsubscribed++; };
      }
    }
  };
  const serviceModules = new Map();
  const model = new SourceTextModule(await readFile(new URL('./model.js', import.meta.url), 'utf8'), { context });
  const config = new SyntheticModule(['firebaseConfig', 'deviceId', 'staleAfterMs'], function () {
    this.setExport('firebaseConfig', { apiKey: 'test', databaseURL: 'test', projectId: 'test', authDomain: 'test', appId: 'test' });
    this.setExport('deviceId', 'esp32-01'); this.setExport('staleAfterMs', 15000);
  }, { context });
  const app = new SourceTextModule(await readFile(new URL('./app.js', import.meta.url), 'utf8'), {
    context, importModuleDynamically: async specifier => {
      const name = specifier.match(/firebase-(app|auth|database)\.js$/)?.[1];
      assert.ok(name, 'No se permite acceder a otro servicio en esta prueba');
      if (!serviceModules.has(name)) {
        const exports = services[name];
        const module = new SyntheticModule(Object.keys(exports), function () {
          for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        }, { context });
        await module.link(() => {}); await module.evaluate(); serviceModules.set(name, module);
      }
      return serviceModules.get(name);
    }
  });
  await app.link(specifier => specifier === './model.js' ? model : config);
  await app.evaluate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof control.auth, 'function');
  control.push = (path, value) => listeners.get(path).next({ val: () => value });
  control.tick = () => intervals.forEach(handle => handle());
  control.login = () => { control.auth({ uid: 'viewer' }); control.push('.info/connected', true); };
  return control;
}

test('starts empty and never fabricates readings without a session', async () => {
  const app = await openApp();
  assert.equal(app.elements.get('temperature').textContent, '—');
  assert.equal(app.elements.get('source-badge').textContent, 'Sin sesión');
  assert.equal(app.elements.has('demo-scenario'), false);
  assert.equal(app.listeners.size, 0);
  app.tick();
  assert.equal(app.elements.get('temperature').textContent, '—');
});

test('reads Firebase, draws both sensors, retains overlapping alarms without removed controls', async () => {
  const app = await openApp(), now = app.clock.now;
  app.login();
  const row = { temperatureC: 51.2, gasRaw: 2500, timestamp: now, alarm: true, buzzer: true, pump1: true, pump2: true };
  app.push('devices/esp32-01/current', row);
  app.push('devices/esp32-01/samples', { one: row });
  app.push('devices/esp32-01/events', { active: { startedAt: now - 7_200_000, reason: 'both', peakTemperatureC: 51.2, peakGasRaw: 2500 } });
  const ui = app.elements;
  assert.equal(ui.get('status-title').textContent, 'Alerta del dispositivo');
  assert.equal(ui.has('pump1'), false);
  assert.equal(ui.has('export'), false);
  assert.match(ui.get('chart').innerHTML, /<svg.*<circle/);
  assert.equal(app.listeners.get('devices/esp32-01/samples').filters[1].limit, 1000);
  await app.buttons[1].fire('click');
  assert.match(ui.get('peak').textContent, /2500 ADC/);
  ui.get('range').value = '1'; await ui.get('range').fire('change');
  assert.match(ui.get('events-count').textContent, /^1 episodios/);

});

test('stale readings and revoked permission cannot appear as normal', async () => {
  const app = await openApp(); app.login();
  app.push('devices/esp32-01/current', { temperatureC: 28, gasRaw: 900, timestamp: app.clock.now, alarm: false, pump1: false });
  assert.equal(app.elements.get('status-title').textContent, 'Sin alarma reportada');
  app.clock.now += 16000; app.tick();
  assert.equal(app.elements.get('status-title').textContent, 'Estado actual desconocido');
  app.listeners.get('devices/esp32-01/current').fail();
  assert.equal(app.elements.get('message').hidden, false);
  assert.equal(app.elements.get('connection').textContent, 'Sin conexión');
});

test('invalid data are rejected and logout clears readings and all subscriptions', async () => {
  const app = await openApp(); app.login();
  app.push('devices/esp32-01/current', { temperatureC: 'invalid', gasRaw: 900, timestamp: app.clock.now });
  assert.equal(app.elements.get('temperature').textContent, '—');
  assert.equal(app.elements.get('message').hidden, false);
  await app.elements.get('logout').fire('click');
  assert.equal(app.listeners.size, 0);
  assert.equal(app.unsubscribed, 4);
  assert.equal(app.elements.get('source-badge').textContent, 'Sin sesión');
  assert.equal(app.elements.get('temperature').textContent, '—');
  assert.equal(app.elements.get('logout').hidden, true);
});

test('sound requires activation, survives connection loss, mutes only the current episode and stops on clear/logout', async () => {
  const app = await openApp(); app.login();
  const report = alarm => app.push('devices/esp32-01/current', { temperatureC: alarm ? 51 : 28, gasRaw: 900, timestamp: app.clock.now, alarm });
  report(true);
  assert.equal(app.audioNodes.length, 0, 'No audio before user interaction');
  await app.elements.get('sound-enable').fire('click');
  const activeTones = () => app.audioNodes.filter(node => node.started && !node.stopped);
  assert.equal(activeTones().length, 2, 'Carrier and modulation oscillators are active');
  report(true); app.tick(); assert.equal(activeTones().length, 2, 'No duplicate sirens');
  app.push('.info/connected', false); app.clock.now += 16000; app.tick();
  assert.equal(activeTones().length, 2, 'Loss of updates must not imply danger ended');
  await app.elements.get('sound-mute').fire('click');
  assert.equal(activeTones().length, 0);
  app.push('.info/connected', true); report(true);
  assert.equal(activeTones().length, 0, 'Same episode remains muted');
  report(false); report(true);
  assert.equal(activeTones().length, 2, 'A new episode sounds again');
  report(false); assert.equal(activeTones().length, 0);
  report(true); await app.elements.get('logout').fire('click');
  assert.equal(activeTones().length, 0);
});

test('old or invalid alerts cannot start sound and disabling sound stops immediately', async () => {
  const app = await openApp(); app.login();
  await app.elements.get('sound-enable').fire('click');
  const report = { temperatureC: 51, gasRaw: 900, timestamp: app.clock.now - 16000, alarm: true };
  app.push('devices/esp32-01/current', report);
  const activeTones = () => app.audioNodes.filter(node => node.started && !node.stopped);
  assert.equal(activeTones().length, 0);
  app.push('devices/esp32-01/current', { ...report, timestamp: app.clock.now, temperatureC: 'bad' });
  assert.equal(activeTones().length, 0);
  app.push('devices/esp32-01/current', { ...report, timestamp: app.clock.now });
  assert.equal(activeTones().length, 2);
  await app.elements.get('sound-enable').fire('click');
  assert.equal(activeTones().length, 0);
  assert.equal(app.elements.get('sound-enable').attributes['aria-pressed'], 'false');
});

test('blocked browser audio reports failure without claiming sound is enabled', async () => {
  const app = await openApp(); app.audioBlocked = true;
  await app.elements.get('sound-enable').fire('click');
  assert.equal(app.elements.get('sound-enable').attributes['aria-pressed'], 'false');
  assert.match(app.elements.get('sound-status').textContent, /No se pudo activar/);
  assert.equal(app.elements.get('sound-enable').disabled, false);
});

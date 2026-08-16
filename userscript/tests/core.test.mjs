import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadCore({ hardwareConcurrency = 8, saveData = false, effectiveType = '4g' } = {}) {
  const source = fs.readFileSync('candidate/Weekend-Wegwijzer.user.js', 'utf8');
  const storage = new Map();
  function XHR() {}
  XHR.prototype.open = function () {};
  XHR.prototype.send = function () {};
  const context = {
    console,
    URL,
    URLSearchParams,
    Intl,
    Date,
    Math,
    Symbol,
    setTimeout,
    clearTimeout,
    navigator: { hardwareConcurrency, connection: { saveData, effectiveType } },
    location: { hash: '', origin: 'https://www.skyscanner.nl', pathname: '/' },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    XMLHttpRequest: XHR,
    __WW_TEST_MODE__: true
  };
  context.window = context;
  context.window.parent = context.window;
  context.window.fetch = async () => ({ clone: () => ({ json: async () => ({}) }) });
  context.window.addEventListener = () => {};
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'Weekend-Wegwijzer.user.js' });
  return context.__WW_TEST_EXPORTS__;
}

test('time parser accepts Dutch planner times and rejects missing values', () => {
  const core = loadCore();
  assert.equal(core.timeToMinutes('21:05'), 1265);
  assert.equal(core.timeToMinutes('vertrek 7:30'), 450);
  assert.equal(core.timeToMinutes(''), null);
});

test('stay duration follows local wall-clock ISO values', () => {
  const core = loadCore();
  assert.equal(core.calculateStayHours('2026-09-04T22:00', '2026-09-07T10:30'), 60.5);
  assert.equal(core.calculateStayHours('2026-09-07T10:30', '2026-09-04T22:00'), 0);
});

test('European country matching is accent and language tolerant', () => {
  const core = loadCore();
  assert.equal(core.isEuropeanCountry('België'), true);
  assert.equal(core.isEuropeanCountry('Czech Republic'), true);
  assert.equal(core.isEuropeanCountry('Canada'), false);
});

test('balanced selection retains affordable candidates per airport and deduplicates', () => {
  const core = loadCore();
  const items = [
    { airport: 'AMS', city: 'Rome', price: 50, link: '/rome' },
    { airport: 'AMS', city: 'Rome', price: 60, link: '/rome' },
    { airport: 'AMS', city: 'Paris', price: 70, link: '/paris' },
    { airport: 'EIN', city: 'Pisa', price: 40, link: '/pisa' }
  ];
  const selected = core.selectBalancedCandidates(items, ['AMS', 'EIN'], 2, 3);
  assert.deepEqual(Array.from(selected, x => x.city), ['Pisa', 'Rome', 'Paris']);
});

test('worker concurrency scales down for device and data saver', () => {
  assert.equal(loadCore({ hardwareConcurrency: 16 }).effectiveWorkerLimit(6), 6);
  assert.equal(loadCore({ hardwareConcurrency: 4 }).effectiveWorkerLimit(6), 2);
  assert.equal(loadCore({ hardwareConcurrency: 16, saveData: true }).effectiveWorkerLimit(6), 2);
});

test('cache trimming removes expired entries and enforces maximum', () => {
  const core = loadCore();
  const now = Date.now();
  const trimmed = core.trimCache({
    old: { time: now - 10000 },
    recent: { time: now - 10 },
    newest: { time: now }
  }, 1000, 1);
  assert.deepEqual(Object.keys(trimmed), ['newest']);
});

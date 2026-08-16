import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { priceModel as modulePriceModel, effectiveStayHours as moduleEffectiveStayHours } from '../src/travel-model.mjs';

function loadCore({ hardwareConcurrency = 8, saveData = false, effectiveType = '4g', pageText = '', pageTitle = '', documentOverride = null } = {}) {
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
    document: documentOverride || { body: { innerText: pageText }, title: pageTitle },
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
  assert.equal(core.calculateStayHours('2026-10-24T22:00:00+02:00', '2026-10-25T10:00:00+01:00'), 13);
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

test('door-to-door price model never invents an unknown baggage price', () => {
  const core = loadCore();
  const model = core.priceModel(80, 'AMS', {
    travelers: 2,
    baggage: 'checked',
    baggageCostPerTraveler: 0,
    bookingFees: 5,
    airportAccess: { AMS: { minutes: 70, cost: 24 } }
  });
  assert.equal(model.total, 189);
  assert.equal(model.incomplete, true);
  assert.equal(model.access.minutes, 70);
  const moduleModel = modulePriceModel(80, 'AMS', {
    travelers: 2,
    baggage: 'checked',
    baggageCostPerTraveler: 0,
    bookingFees: 5,
    airportAccess: { AMS: { minutes: 70, cost: 24 } }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(model)), moduleModel);
});

test('effective weekend time deducts destination transfers and return buffer', () => {
  const core = loadCore();
  assert.equal(core.effectiveStayHours(60, {
    destinationTransferMinutes: 45,
    returnAirportBufferMinutes: 120
  }), 56.5);
  assert.equal(moduleEffectiveStayHours(60, {
    destinationTransferMinutes: 45,
    returnAirportBufferMinutes: 120
  }), 56.5);
});

test('captured Skyscanner fixture produces a concrete direct return', () => {
  const core = loadCore();
  const fixture = JSON.parse(fs.readFileSync('tests/fixtures/skyscanner-direct.json', 'utf8'));
  const flights = core.compactJsonFlights(fixture);
  assert.equal(flights.length, 1);
  assert.equal(flights[0].price, 79.5);
  assert.equal(flights[0].outboundStops, 0);
});

test('one-stop fixture is excluded by default and included when enabled', () => {
  const core = loadCore();
  const fixture = JSON.parse(fs.readFileSync('tests/fixtures/skyscanner-one-stop.json', 'utf8'));
  assert.equal(core.compactJsonFlights(fixture, 0).length, 0);
  const flights = core.compactJsonFlights(fixture, 1);
  assert.equal(flights.length, 1);
  assert.equal(flights[0].outboundStops, 1);
});

test('cache URLs discard tracking noise but retain search semantics', () => {
  const core = loadCore();
  assert.equal(
    core.cacheUrl('https://www.skyscanner.nl/path?utm_source=x&adultsv2=2&ref=home'),
    'https://www.skyscanner.nl/path?adultsv2=2'
  );
});

test('page-state diagnosis distinguishes bot checks and cookie walls', () => {
  assert.equal(loadCore({ pageTitle: 'Verify you are human', pageText: 'Captcha' }).classifyPageState(), 'BOT_CHECK');
  assert.equal(loadCore({ pageText: 'Cookies accepteren' }).classifyPageState(), 'COOKIE_WALL');
  assert.equal(loadCore({ pageText: 'Geen vluchten gevonden' }).classifyPageState(), null);
});

test('availability profile adds Thursday evening only to the final weekend of a month', () => {
  const core = loadCore();
  const normal = Array.from(core.createScenarios(new Date('2026-08-22T12:00:00')), x => ({ id: x.id, earliest: x.earliestOutbound }));
  assert.deepEqual(normal, [
    { id: 'fri-mon', earliest: '21:30' },
    { id: 'sat-mon', earliest: undefined }
  ]);
  const finalWeekend = Array.from(core.createScenarios(new Date('2026-08-29T12:00:00')), x => ({ id: x.id, earliest: x.earliestOutbound }));
  assert.deepEqual(finalWeekend, [
    { id: 'thu-mon', earliest: '21:30' },
    { id: 'fri-mon', earliest: '' },
    { id: 'sat-mon', earliest: undefined }
  ]);
});

test('automatic weekend scenarios retain the Monday home deadline', () => {
  const core = loadCore();
  const settings = { homeDeadline: '23:00' };
  const normal = core.createScenarios(new Date('2026-08-22T12:00:00'), settings);
  const finalWeekend = core.createScenarios(new Date('2026-08-29T12:00:00'), settings);
  assert.deepEqual(Array.from(normal, scenario => scenario.homeDeadline), ['23:00', '23:00']);
  assert.deepEqual(Array.from(finalWeekend, scenario => scenario.homeDeadline), ['23:00', '23:00', '23:00']);
});

test('custom availability window keeps exact dates and times', () => {
  const core = loadCore();
  const scenarios = core.createScenarios(new Date('2026-09-01T12:00:00'), {
    homeDeadline: '23:00',
    customWindow: {
      active: true,
      outboundDate: '2026-09-10',
      inboundDate: '2026-09-14',
      earliestDeparture: '18:45',
      homeDeadline: '22:30'
    }
  });
  assert.equal(scenarios[0].outbound, '260910');
  assert.equal(scenarios[0].inbound, '260914');
  assert.equal(scenarios[0].earliestOutbound, '18:45');
  assert.equal(scenarios[0].homeDeadline, '22:30');
});

test('custom dates do not inherit weekend time restrictions', () => {
  const core = loadCore();
  const scenarios = core.createScenarios(new Date('2026-09-01T12:00:00'), {
    homeDeadline: '23:00',
    customWindow: {
      active: true,
      outboundDate: '2026-09-09',
      inboundDate: '2026-09-16',
      earliestDeparture: '',
      homeDeadline: ''
    }
  });
  assert.equal(scenarios[0].earliestOutbound, '');
  assert.equal(scenarios[0].homeDeadline, '');
});

test('return flight is rejected when airport transfer misses the home deadline', () => {
  const core = loadCore();
  const settings = {
    maxBudget: 0,
    minStayHours: 0,
    earliestReturn: '',
    homeDeadline: '23:00',
    homeArrivalMarginMinutes: 30,
    airportAccess: { AMS: { minutes: 90, cost: 0 } }
  };
  const base = { airport: 'AMS', totalPrice: 100, effectiveStayHours: 48, inboundArrival: '21:00' };
  assert.equal(core.passesSearchFilters(base, settings), true);
  assert.equal(core.passesSearchFilters({ ...base, inboundArrival: '21:01' }, settings), false);
  assert.equal(core.passesSearchFilters({
    ...base,
    inboundArrival: '00:15',
    inboundArrivalIso: '2026-08-25T00:15:00+02:00',
    scenarioInbound: '260824'
  }, settings), false);
});

test('country page city extraction remains independent from final result snapshots', () => {
  const container = {
    querySelector: selector => selector === 'h2' ? { innerText: 'Rome' } : null
  };
  const link = {
    closest: () => container,
    getAttribute: name => name === 'aria-label' ? 'Vanaf € 99' : null,
    innerText: '€ 99',
    href: 'https://www.skyscanner.nl/transport/vluchten/ams/rome/260903/260919/'
  };
  const core = loadCore({
    documentOverride: {
      body: { innerText: '' },
      title: '',
      querySelectorAll: selector => selector === 'a[data-testid="flights-link"]' ? [link] : []
    }
  });
  const cities = core.readCities('AMS', 'Italië');
  assert.equal(cities.length, 1);
  assert.equal(cities[0].city, 'Rome');
  assert.equal(cities[0].price, 99);
});

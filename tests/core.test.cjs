'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../lib/core.js');
const { MaintainStrategy, DietStrategy, BulkUpStrategy, CalorieCalculator } = require('../lib/target-strategies.js');
const FIXED = new Date(2026, 9, 11, 12);
// Outputs captured before the Strategy refactor, rather than a second copy of its formula.
const TARGET_CASES = [
  ['male', 24, 175, 70, 1.55, 'maintain', { calories: 2602, carb: 376, protein: 112, fat: 72 }],
  ['male', 24, 175, 70, 1.55, 'diet', { calories: 2102, carb: 268, protein: 126, fat: 58 }],
  ['male', 24, 175, 70, 1.55, 'bulk', { calories: 3002, carb: 460, protein: 140, fat: 67 }],
  ['female', 30, 165, 60, 1.375, 'maintain', { calories: 1815, carb: 244, protein: 96, fat: 50 }],
  ['female', 30, 165, 60, 1.375, 'diet', { calories: 1315, carb: 139, protein: 108, fat: 37 }],
  ['female', 30, 165, 60, 1.375, 'bulk', { calories: 2215, carb: 323, protein: 120, fat: 49 }],
  ['female', 100, 100, 30, 1.2, 'diet', { calories: 1200, carb: 171, protein: 54, fat: 33 }],
  ['male', 18, 250, 300, 1.9, 'bulk', { calories: 4500, carb: 300, protein: 600, fat: 100 }],
  ['female', 100, 100, 150, 1.2, 'diet', { calories: 1257, carb: 0, protein: 270, fat: 35 }]
].map(([gender, age, height, weight, activity, goal, expected]) => ({ profile: { gender, age, height, weight, activity, goal }, expected }));
function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, value), data };
}
function fixture(mode = 'blank') {
  const storage = memoryStorage(), store = core.createStore(storage, 'test', () => new Date(FIXED));
  if (mode) store.reset(mode);
  return { storage, store };
}
function code(expected) { return error => error.code === expected; }
test('local calendar date respects Korean midnight and dates shift over leap days', () => {
  const script = `const c=require(${JSON.stringify(require.resolve('../lib/core.js'))});process.stdout.write(c.todayISO(new Date('2026-10-10T16:00:00Z')));`;
  assert.equal(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'Asia/Seoul' }, encoding: 'utf8' }), '2026-10-11');
  assert.equal(core.shiftDate('2024-02-28', 1), '2024-02-29');
  assert.equal(core.shiftDate('2024-02-29', 1), '2024-03-01');
  assert.equal(core.shiftDate('2026-01-01', -1), '2025-12-31');
  assert.throws(() => core.shiftDate('2026-02-30', 1), code('VALIDATION'));
});
test('targets preserve nine pre-refactor results including both sexes and nutrition bounds', () => {
  for (const { profile, expected } of TARGET_CASES) {
    assert.deepEqual(core.calcTargets(profile), expected, JSON.stringify(profile));
    const formInput = Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, String(value)]));
    assert.deepEqual(core.calcTargets(formInput), expected, 'numeric strings from browser forms');
  }
  const profile = core.createBlankState(FIXED).profile;
  for (const weight of ['', null, NaN, Infinity, -1, 301]) assert.throws(() => core.calcTargets({ ...profile, weight }), code('VALIDATION'));
});
test('unsupported goals remain validation errors and do not change saved state', () => {
  const { store, storage } = fixture(), before = storage.getItem('test');
  for (const goal of ['', 'custom', 'toString', '__proto__', null]) {
    assert.throws(() => core.calcTargets({ ...TARGET_CASES[0].profile, goal }), code('VALIDATION'));
    assert.throws(() => store.updateProfile({ goal }), code('VALIDATION'));
    assert.equal(storage.getItem('test'), before);
  }
});
test('one calculator can exchange built-in and custom strategies without goal-based dispatch', () => {
  const { goal, ...profile } = TARGET_CASES[0].profile;
  const calculator = new CalorieCalculator(new MaintainStrategy());
  assert.deepEqual(calculator.calculate(profile), TARGET_CASES[0].expected);
  calculator.setStrategy(new DietStrategy());
  assert.deepEqual(calculator.calculate(profile), TARGET_CASES[1].expected);
  calculator.setStrategy(new BulkUpStrategy());
  assert.deepEqual(calculator.calculate(profile), TARGET_CASES[2].expected);
  const calls = [];
  calculator.setStrategy({ calculate(input) { calls.push(input); return { calories: 2000, protein: 100, fatRatio: 0.18 }; } });
  assert.deepEqual(calculator.calculate(profile), { calories: 2000, carb: 310, protein: 100, fat: 40 });
  assert.deepEqual(calls, [{ weight: 70, tdee: 2602.0625 }]);
});
test('invalid strategies and policy results fail explicitly', () => {
  const calculator = new CalorieCalculator(new MaintainStrategy());
  for (const invalid of [null, {}, { calculate: 1 }]) {
    assert.throws(() => new CalorieCalculator(invalid), TypeError);
    assert.throws(() => calculator.setStrategy(invalid), TypeError);
  }
  assert.deepEqual(calculator.calculate(TARGET_CASES[0].profile), TARGET_CASES[0].expected);
  for (const result of [null, {}, { calories: Infinity, protein: 100, fatRatio: 0.2 }, { calories: 2000, protein: NaN, fatRatio: 0.2 }, { calories: 2000, protein: -1, fatRatio: 0.2 }, { calories: 2000, protein: 100, fatRatio: -0.1 }, { calories: 2000, protein: 100, fatRatio: 1.1 }]) {
    calculator.setStrategy({ calculate: () => result });
    assert.throws(() => calculator.calculate(TARGET_CASES[0].profile), TypeError);
  }
});
test('custom strategies inherit the shared calorie and carbohydrate limits', () => {
  const calculator = new CalorieCalculator({ calculate: () => ({ calories: -500, protein: 100, fatRatio: 0.3 }) });
  assert.deepEqual(calculator.calculate(TARGET_CASES[0].profile), { calories: 1200, carb: 110, protein: 100, fat: 40 });
  calculator.setStrategy({ calculate: () => ({ calories: 9000, protein: 100, fatRatio: 0.2 }) });
  assert.deepEqual(calculator.calculate(TARGET_CASES[0].profile), { calories: 4500, carb: 800, protein: 100, fat: 100 });
  calculator.setStrategy({ calculate: () => ({ calories: 1200, protein: 400, fatRatio: 0.25 }) });
  assert.deepEqual(calculator.calculate(TARGET_CASES[0].profile), { calories: 1200, carb: 0, protein: 400, fat: 33 });
});
test('browser UMD scripts load in the actual HTML order and match CommonJS results', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(match => match[1]);
  const appIndex = scripts.indexOf('app.js');
  assert.ok(appIndex > 0, 'the app must follow its UMD dependencies');
  const browser = vm.createContext({});
  for (const src of scripts.slice(0, appIndex)) {
    vm.runInContext(fs.readFileSync(path.join(root, src), 'utf8'), browser, { filename: src });
  }
  assert.equal(typeof browser.NutriFitTargets.CalorieCalculator, 'function');
  assert.equal(typeof browser.NutriFitCore.calcTargets, 'function');
  for (const { profile, expected } of TARGET_CASES) {
    const actual = JSON.parse(JSON.stringify(browser.NutriFitCore.calcTargets(profile)));
    assert.deepEqual(actual, expected);
  }
});
test('absent storage stays absent until explicit initialization', () => {
  const { store, storage } = fixture(null);
  assert.equal(store.load(), null);
  assert.equal(storage.data.size, 0);
  assert.throws(() => store.summary(), code('NOT_INITIALIZED'));
  assert.throws(() => store.addRecord({}), code('NOT_INITIALIZED'));
  assert.equal(store.reset('blank').foods.length, 25);
  assert.equal(store.load().records.length, 0);
});
test('sample state has synthetic records for today and yesterday and two usable combos', () => {
  const { store } = fixture('sample');
  assert.equal(store.getState().combos.length, 2);
  assert.ok(store.summary('2026-10-11').records.length);
  assert.ok(store.summary('2026-10-10').locked);
  assert.ok(store.summary('2026-10-10').records.length);
  const before = store.getState().records.length;
  store.applyCombo('combo_1', { meal: '저녁' });
  assert.equal(store.getState().records.length, before + 3);
});
test('malformed or invalid stored state is never silently overwritten', () => {
  const { storage, store } = fixture();
  for (const malformed of ['{broken', 'null', '{}', JSON.stringify({ ...core.createBlankState(FIXED), records: null }), JSON.stringify({ ...core.createBlankState(FIXED), goalHistory: undefined })]) {
    storage.setItem('test', malformed);
    assert.throws(() => store.load(), code('CORRUPT_DATA'));
    assert.throws(() => store.updateProfile({ goal: 'bulk' }), code('CORRUPT_DATA'));
    assert.equal(storage.getItem('test'), malformed);
  }
  assert.equal(store.reset('blank').records.length, 0);
});
test('read and write failures are explicit and failed action preserves persisted state', () => {
  const { storage, store } = fixture();
  const before = storage.getItem('test');
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.updateProfile({ goal: 'bulk' }), code('STORAGE_UNAVAILABLE'));
  assert.equal(storage.getItem('test'), before);
  storage.getItem = () => { throw new Error('denied'); };
  assert.throws(() => store.load(), code('STORAGE_UNAVAILABLE'));
});
test('record and food validation reject invalid numbers without a partial write', () => {
  const { store, storage } = fixture(), before = storage.getItem('test');
  for (const amount of ['', 0, -1, Infinity, NaN, null, true, 100001]) {
    assert.throws(() => store.addRecord({ foodId: 'food_1', amount, meal: '점심' }), code('VALIDATION'));
    assert.equal(storage.getItem('test'), before);
  }
  assert.throws(() => store.addRecord({ foodId: 'food_1', amount: 100, meal: '<invalid>' }), code('VALIDATION'));
  assert.throws(() => store.updateFood('food_1', { baseAmount: 0 }), code('VALIDATION'));
  assert.throws(() => store.addFood({ name: ' ', baseAmount: 1, unit: 'g', calories: 0, carb: 0, protein: 0, fat: 0 }), code('VALIDATION'));
  assert.equal(storage.getItem('test'), before);
});
test('records retain names and nutrition after editing and removing their source food', () => {
  const { store } = fixture();
  store.addRecord({ foodId: 'food_1', amount: '150', meal: '점심' });
  const record = store.getState().records[0];
  assert.equal(record.calories, 165);
  assert.equal(record.protein, 34.5);
  store.updateFood('food_1', { name: '새 이름', calories: 900 });
  assert.deepEqual(store.getState().records[0], record);
  store.deleteFood('food_1');
  assert.deepEqual(store.getState().records[0], record);
});
test('food references in combos must be removed before deleting a food', () => {
  const { store, storage } = fixture('sample'), before = storage.getItem('test');
  assert.throws(() => store.deleteFood('food_1'), code('FOOD_IN_USE'));
  assert.equal(storage.getItem('test'), before);
  store.deleteCombo('combo_1');
  store.deleteFood('food_1');
  assert.ok(!store.getState().foods.some(f => f.id === 'food_1'));
  assert.throws(() => store.addCombo({ name: '잘못된 조합', items: [{ foodId: 'missing', amount: 1 }] }), code('VALIDATION'));
});
test('applying a combo is atomic if a later ingredient overflows calculated nutrition', () => {
  const { store, storage } = fixture();
  store.updateFood('food_2', { baseAmount: Number.MIN_VALUE });
  store.addCombo({ name: '계산 검증', items: [{ foodId: 'food_1', amount: 100 }, { foodId: 'food_2', amount: 100 }] });
  const before = storage.getItem('test'), comboId = store.getState().combos[0].id;
  assert.throws(() => store.applyCombo(comboId, { meal: '점심' }), code('VALIDATION'));
  assert.equal(storage.getItem('test'), before);
});
test('past records stay locked while future records remain editable', () => {
  const { store } = fixture('sample');
  const old = store.getState().records.find(r => r.date === '2026-10-10');
  assert.throws(() => store.deleteRecord(old.id), code('PAST_DATE'));
  assert.throws(() => store.addRecord({ foodId: 'food_1', amount: 100, meal: '점심', date: '2026-10-10' }), code('PAST_DATE'));
  assert.throws(() => store.applyCombo('combo_1', { meal: '점심', date: '2026-10-10' }), code('PAST_DATE'));
  store.addRecord({ foodId: 'food_1', amount: 100, meal: '점심', date: '2026-10-12' });
  const future = store.summary('2026-10-12');
  assert.equal(future.locked, false);
  store.deleteRecord(future.records[0].id);
  assert.equal(store.summary('2026-10-12').records.length, 0);
});
test('profile changes preserve historical target snapshots across days', () => {
  const storage = memoryStorage();
  let date = new Date(2026, 9, 10, 12);
  const store = core.createStore(storage, 'history', () => date);
  store.reset('blank');
  const oldTarget = store.summary('2026-10-10').target;
  date = new Date(2026, 9, 11, 12);
  store.updateProfile({ goal: 'bulk', weight: 75 });
  store.updateProfile({ goal: 'diet' });
  assert.deepEqual(store.summary('2026-10-10').target, oldTarget);
  assert.equal(store.getState().goalHistory.length, 2);
  assert.notDeepEqual(store.summary('2026-10-11').target, oldTarget);
});
test('returned values are independent and separate stores reload the latest snapshot', () => {
  const { storage, store } = fixture();
  const copy = store.getState(); copy.foods[0].name = 'changed outside';
  assert.equal(store.getState().foods[0].name, '닭가슴살');
  const second = core.createStore(storage, 'test', () => FIXED);
  second.updateProfile({ goal: 'bulk' });
  store.toggleFavorite('food_1');
  assert.equal(store.getState().profile.goal, 'bulk');
  assert.equal(second.getState().foods[0].favorite, true);
  const summary = store.summary(); summary.target.calories = 0;
  assert.ok(store.summary().target.calories > 0);
});
test('duplicate IDs and invalid state schema cannot replace valid persisted data', () => {
  const { store, storage } = fixture(), before = storage.getItem('test');
  const duplicate = store.getState(); duplicate.foods.push({ ...duplicate.foods[0] });
  assert.throws(() => store.save(duplicate), code('VALIDATION'));
  assert.equal(storage.getItem('test'), before);
  const invalid = store.getState(); invalid.foods[0].calories = '110';
  assert.throws(() => core.validateState(invalid), code('VALIDATION'));
});

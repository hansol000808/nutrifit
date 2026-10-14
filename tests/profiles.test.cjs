'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../lib/core.js');
const Profiles = require('../lib/profiles.js');
const FIXED = new Date(2026, 9, 14, 12);
function memoryStorage() {
  const data = new Map();
  return { data, get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function setup() {
  const storage = memoryStorage();
  return { storage, manager: Profiles.createManager(storage, () => new Date(FIXED)) };
}
const code = expected => error => error.code === expected;

test('profiles isolate shared food IDs, favorites, combos, records, and target histories', () => {
  const { storage, manager } = setup();
  const a = manager.create('  나의 기록  ', 'sample'), b = manager.create('다른 기록', 'sample');
  assert.equal(a.name, '나의 기록');
  assert.notEqual(a.id, b.id);
  const first = manager.getStore(a.id), second = manager.getStore(b.id), before = second.getState();
  first.updateFood('food_1', { name: '개인 음식', calories: 220 });
  first.toggleFavorite('food_2');
  first.addRecord({ foodId: 'food_1', amount: 100, meal: '점심' });
  first.addCombo({ name: '개인 조합', items: [{ foodId: 'food_2', amount: 2 }] });
  first.updateProfile({ goal: 'bulk', weight: 75 });
  assert.deepEqual(second.getState(), before);
  assert.notDeepEqual(first.getState().goalHistory, before.goalHistory);
  first.reset('blank');
  assert.equal(first.getState().records.length, 0);
  assert.deepEqual(second.getState(), before);
  assert.equal(storage.getItem(Profiles.LEGACY_KEY), null);
});

test('metadata reads current data and separate managers discover profiles without a shared registry', () => {
  const { storage, manager } = setup();
  const another = Profiles.createManager(storage, () => FIXED);
  const a = manager.create('A'), b = another.create('B');
  manager.getStore(a.id).addRecord({ foodId: 'food_2', amount: 1, meal: '아침' });
  const list = another.list();
  assert.equal(list.length, 2);
  assert.deepEqual(list.find(p => p.id === a.id).counts, { foods: 25, records: 1, combos: 0, history: 1 });
  list[0].counts.foods = -1;
  assert.equal(manager.list().find(p => p.id === a.id).counts.foods, 25);
  another.remove(b.id);
  assert.deepEqual(manager.list().map(p => p.id), [a.id]);
});

test('legacy migration preserves every data field and the original string and never duplicates or reimports a deletion', () => {
  const { storage, manager } = setup();
  const originalData = Core.createSampleState(FIXED);
  originalData.foods[0].name = '기존 사용자 음식';
  const original = JSON.stringify(originalData, null, 2);
  storage.setItem(Profiles.LEGACY_KEY, original);
  const migrated = manager.migrateLegacy();
  assert.equal(migrated.id, 'legacy');
  assert.deepEqual(JSON.parse(storage.getItem(Profiles.PROFILE_PREFIX + 'legacy')).data, originalData);
  assert.deepEqual(manager.getStore('legacy').getState(), originalData);
  assert.deepEqual(manager.migrateLegacy(), migrated);
  assert.equal(manager.list().length, 1);
  assert.equal(storage.getItem(Profiles.LEGACY_KEY), original);
  manager.remove('legacy');
  assert.equal(manager.migrateLegacy(), null);
  assert.equal(manager.list().length, 0);
  assert.equal(storage.getItem(Profiles.LEGACY_KEY), original);
});

test('invalid legacy data and failed migration writes preserve the old data for a safe retry', () => {
  const { storage, manager } = setup();
  storage.setItem(Profiles.LEGACY_KEY, '{broken');
  assert.throws(() => manager.migrateLegacy(), code('CORRUPT_LEGACY'));
  assert.equal(storage.getItem(Profiles.LEGACY_KEY), '{broken');
  assert.equal(storage.length, 1);
  const original = JSON.stringify(Core.createSampleState(FIXED));
  storage.setItem(Profiles.LEGACY_KEY, original);
  const write = storage.setItem;
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => manager.migrateLegacy(), code('STORAGE_UNAVAILABLE'));
  assert.equal(storage.getItem(Profiles.LEGACY_KEY), original);
  assert.equal(storage.getItem(Profiles.PROFILE_PREFIX + 'legacy'), null);
  storage.setItem = write;
  assert.equal(manager.migrateLegacy().id, 'legacy');
  assert.equal(manager.list().length, 1);
});

test('deleted or missing profiles reject stale saves and resets without recreating data', () => {
  const { storage, manager } = setup();
  const a = manager.create('삭제 대상', 'sample'), b = manager.create('보존 대상');
  const stale = manager.getStore(a.id), saved = stale.getState(), other = manager.getStore(b.id).getState();
  manager.remove(a.id);
  for (const operation of [() => stale.load(), () => stale.save(saved), () => stale.reset('blank'), () => stale.addRecord({})])
    assert.throws(operation, code('PROFILE_REMOVED'));
  const tombstone = JSON.parse(storage.getItem(Profiles.PROFILE_PREFIX + a.id));
  assert.deepEqual(tombstone, { version: 1, id: a.id, deleted: true });
  assert.deepEqual(manager.getStore(b.id).getState(), other);
  const staleB = manager.getStore(b.id);
  storage.removeItem(Profiles.PROFILE_PREFIX + b.id);
  assert.throws(() => staleB.save(other), code('PROFILE_REMOVED'));
  assert.equal(storage.getItem(Profiles.PROFILE_PREFIX + b.id), null);
});

test('a deletion interleaved with a stale write leaves a tombstone, not resurrected records', () => {
  const { storage, manager } = setup();
  const a = manager.create('경합'), stale = manager.getStore(a.id), key = Profiles.PROFILE_PREFIX + a.id;
  const write = storage.setItem;
  let once = true;
  storage.setItem = (target, value) => {
    if (once && target === key && JSON.parse(value).data) {
      once = false;
      manager.remove(a.id);
    }
    write(target, value);
  };
  assert.throws(() => stale.updateProfile({ goal: 'diet' }), code('PROFILE_REMOVED'));
  assert.deepEqual(JSON.parse(storage.getItem(key)), { version: 1, id: a.id, deleted: true });
  assert.equal(manager.list().length, 0);
});

test('profile names and limits are checked without overwriting existing profiles', () => {
  const { storage, manager } = setup();
  for (const name of ['', ' ', null, 'a'.repeat(41), 'line\nname']) assert.throws(() => manager.create(name), code('VALIDATION'));
  assert.equal(storage.length, 0);
  for (let i = 0; i < 20; i += 1) manager.create('프로필 ' + i);
  const before = [...storage.data];
  assert.throws(() => manager.create('초과'), code('PROFILE_LIMIT'));
  assert.deepEqual([...storage.data], before);
  manager.remove(manager.list()[0].id);
  assert.ok(manager.create('새 프로필').id);
  assert.equal(manager.list().length, 20);
});

test('corrupt profile data is reported without replacing its contents', () => {
  const { storage, manager } = setup();
  const a = manager.create('기록'), key = Profiles.PROFILE_PREFIX + a.id;
  storage.setItem(key, '{broken');
  assert.throws(() => manager.list(), code('CORRUPT_DATA'));
  assert.throws(() => manager.getStore(a.id), code('CORRUPT_DATA'));
  assert.equal(storage.getItem(key), '{broken');
});

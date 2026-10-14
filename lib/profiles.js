(function (root, factory) {
  'use strict';
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.NutriFitCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NutriFitProfiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const PROFILE_PREFIX = 'nutrifit.profile.v1.';
  const DELETED_PREFIX = 'nutrifit.profile.deleted.v1.';
  const LEGACY_KEY = 'nutrifit.demo.v1';
  const MAX_PROFILES = 20;
  function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
  function profileId(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('VALIDATION', '프로필 ID가 올바르지 않습니다.');
    return value;
  }
  function profileName(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(value))
      fail('VALIDATION', '프로필 이름은 1~40자의 텍스트로 입력해 주세요.');
    return value.trim();
  }
  function createManager(storage, nowFn = () => new Date()) {
    function read(key) {
      try { return storage.getItem(key); }
      catch (_) { fail('STORAGE_UNAVAILABLE', '브라우저의 프로필 저장소를 읽을 수 없습니다.'); }
    }
    function write(key, value) {
      try { storage.setItem(key, value); }
      catch (_) { fail('STORAGE_UNAVAILABLE', '프로필을 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'); }
    }
    function removed() { fail('PROFILE_REMOVED', '이 프로필이 삭제되었거나 없어졌습니다. 다른 프로필을 선택해 주세요.'); }
    function isDeleted(id) { return read(DELETED_PREFIX + id) !== null; }
    function tombstone(id) { return JSON.stringify({ version: 1, id, deleted: true }); }
    function readEnvelope(id) {
      profileId(id);
      if (isDeleted(id)) removed();
      const saved = read(PROFILE_PREFIX + id);
      if (saved === null) removed();
      let envelope;
      try { envelope = JSON.parse(saved); }
      catch (_) { fail('CORRUPT_DATA', '프로필 데이터 형식이 손상되었습니다. 기존 데이터는 변경하지 않았습니다.'); }
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.version !== 1 || envelope.id !== id)
        fail('CORRUPT_DATA', '프로필 데이터 형식이 올바르지 않습니다. 기존 데이터는 변경하지 않았습니다.');
      if (envelope.deleted === true) removed();
      try {
        if (profileName(envelope.name) !== envelope.name || typeof envelope.createdAt !== 'string'
          || !Number.isFinite(Date.parse(envelope.createdAt))) throw new Error('metadata');
        Core.validateState(envelope.data);
      } catch (_) { fail('CORRUPT_DATA', '프로필의 이름 또는 기록 형식이 올바르지 않습니다. 기존 데이터는 변경하지 않았습니다.'); }
      return envelope;
    }
    function metadata(envelope) {
      const data = envelope.data;
      return { id: envelope.id, name: envelope.name, createdAt: envelope.createdAt,
        counts: { foods: data.foods.length, records: data.records.length, combos: data.combos.length, history: data.goalHistory.length } };
    }
    function keys() {
      try {
        const result = new Set();
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (typeof key === 'string' && key.startsWith(PROFILE_PREFIX)) result.add(key);
        }
        return [...result];
      } catch (_) { fail('STORAGE_UNAVAILABLE', '저장된 프로필 목록을 읽을 수 없습니다.'); }
    }
    function list() {
      const result = [];
      for (const key of keys()) {
        try { result.push(metadata(readEnvelope(key.slice(PROFILE_PREFIX.length)))); }
        catch (error) { if (error.code !== 'PROFILE_REMOVED') throw error; }
      }
      return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    }
    function room() { if (list().length >= MAX_PROFILES) fail('PROFILE_LIMIT', '프로필은 최대 20개까지 만들 수 있습니다.'); }
    function afterWrite(id) {
      // A separate deletion marker survives a racing write to the data key.
      // Once observed, also remove any data that the racing writer put back.
      if (isDeleted(id)) {
        write(PROFILE_PREFIX + id, tombstone(id));
        removed();
      }
      return readEnvelope(id);
    }
    function saveNew(id, name, data) {
      if (isDeleted(id)) removed();
      const existing = read(PROFILE_PREFIX + id);
      if (existing !== null) return readEnvelope(id);
      const date = nowFn();
      if (!date || typeof date.toISOString !== 'function' || !Number.isFinite(date.getTime())) fail('VALIDATION', '프로필 생성 날짜가 올바르지 않습니다.');
      const envelope = { version: 1, id, name, createdAt: date.toISOString(), data };
      write(PROFILE_PREFIX + id, JSON.stringify(envelope));
      const verified = afterWrite(id);
      if (JSON.stringify(verified.data) !== JSON.stringify(data))
        fail('STORAGE_UNAVAILABLE', '복사한 프로필을 확인하지 못했습니다. 기존 기록은 보존되어 있습니다.');
      return verified;
    }
    function create(name, mode = 'blank') {
      name = profileName(name);
      if (!['blank', 'sample'].includes(mode)) fail('VALIDATION', '프로필 초기화 방식을 선택해 주세요.');
      room();
      let id;
      do {
        const token = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID()
          : Date.now().toString(36) + Math.random().toString(36).slice(2);
        id = 'p_' + token;
      } while (read(PROFILE_PREFIX + id) !== null || isDeleted(id));
      const data = mode === 'sample' ? Core.createSampleState(nowFn()) : Core.createBlankState(nowFn());
      return metadata(saveNew(id, name, data));
    }
    function remove(id) {
      profileId(id);
      if (read(PROFILE_PREFIX + id) === null && !isDeleted(id)) removed();
      // Keep only an ID tombstone; no name, health data, or food history remains.
      const deleted = tombstone(id);
      write(DELETED_PREFIX + id, deleted);
      write(PROFILE_PREFIX + id, deleted);
    }
    function getStore(id) {
      profileId(id); readEnvelope(id);
      let adapterError = null;
      const adapter = {
        getItem() {
          try { return JSON.stringify(readEnvelope(id).data); }
          catch (error) { adapterError = error; throw error; }
        },
        setItem(_key, serialized) {
          try {
            const envelope = readEnvelope(id), data = JSON.parse(serialized);
            Core.validateState(data);
            write(PROFILE_PREFIX + id, JSON.stringify({ version: 1, id, name: envelope.name, createdAt: envelope.createdAt, data }));
            afterWrite(id);
          } catch (error) { adapterError = error; throw error; }
        }
      };
      const store = Core.createStore(adapter, PROFILE_PREFIX + id, nowFn);
      // Core wraps adapter errors. Preserve profile-deletion/corruption errors
      // so the UI can return to selection instead of offering a stale reset.
      return Object.fromEntries(Object.entries(store).map(([name, operation]) => [name, (...args) => {
        adapterError = null;
        readEnvelope(id);
        try { return operation(...args); }
        catch (error) { throw adapterError || error; }
      }]));
    }
    function migrateLegacy() {
      const id = 'legacy';
      if (isDeleted(id)) return null;
      if (read(PROFILE_PREFIX + id) !== null) {
        try { return metadata(readEnvelope(id)); }
        catch (error) { if (error.code === 'PROFILE_REMOVED') return null; throw error; }
      }
      const original = read(LEGACY_KEY);
      if (original === null) return null;
      let data;
      try { data = JSON.parse(original); Core.validateState(data); }
      catch (_) { fail('CORRUPT_LEGACY', '이전 기록 형식이 올바르지 않아 옮기지 않았습니다. 기존 기록은 그대로 보존되어 있습니다.'); }
      room();
      // Validation must not replace the source with normalized or sample data.
      // Keep the legacy string untouched, including after a failed write.
      return metadata(saveNew(id, '기존 기록', data));
    }
    return { list, create, remove, getStore, migrateLegacy };
  }
  return { createManager, PROFILE_PREFIX, DELETED_PREFIX, LEGACY_KEY };
});

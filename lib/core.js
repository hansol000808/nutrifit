(function (root, factory) {
  'use strict';
  const targets = typeof module === 'object' && module.exports ? require('./target-strategies.js') : root.NutriFitTargets;
  const api = factory(targets);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NutriFitCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (targets) {
  'use strict';
  const MEALS = ['아침', '점심', '저녁', '간식1', '간식2'];
  const MACROS = ['calories', 'carb', 'protein', 'fat'];
  const ACTIVITIES = [1.2, 1.375, 1.55, 1.725, 1.9];
  const GOALS = Object.freeze(Object.keys(targets.goalStrategies));
  const DEFAULT_PROFILE = { gender: 'male', age: 24, height: 175, weight: 70, activity: 1.55, goal: 'maintain' };
  const DEFAULT_FOODS = [
    ['단백질','닭가슴살',100,'g',110,0,23,1], ['단백질','계란',1,'개',70,1,6,5],
    ['단백질','두부',100,'g',80,2,8,4], ['단백질','연어',100,'g',208,0,20,13],
    ['단백질','참치캔',100,'g',132,0,29,1], ['단백질','그릭요거트',100,'g',97,4,10,4],
    ['단백질','프로틴쉐이크',1,'스쿱',120,3,24,2], ['단백질','우유',200,'ml',122,10,6,7],
    ['탄수화물','백미밥',100,'g',130,28,2,0], ['탄수화물','현미밥',100,'g',150,32,3,1],
    ['탄수화물','고구마',100,'g',128,30,1,0], ['탄수화물','감자',100,'g',77,17,2,0],
    ['탄수화물','오트밀',100,'g',380,67,13,7], ['탄수화물','식빵',1,'장',80,15,3,1],
    ['탄수화물','바나나',1,'개',105,27,1,0], ['탄수화물','사과',1,'개',95,25,0,0],
    ['지방','아몬드',10,'g',58,2,2,5], ['지방','호두',10,'g',65,1,1,6],
    ['지방','땅콩버터',10,'g',59,2,2,5], ['지방','올리브오일',10,'g',90,0,0,10],
    ['균형식','브로콜리',100,'g',34,7,3,0], ['균형식','토마토',100,'g',18,4,1,0],
    ['균형식','양배추',100,'g',25,6,1,0], ['음료','아메리카노',1,'잔',10,1,0,0],
    ['음료','제로콜라',1,'캔',0,0,0,0]
  ];
  function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
  function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VALIDATION', '데이터는 올바른 객체여야 합니다.');
    return value;
  }
  function text(value, label, max = 80) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value))
      fail('VALIDATION', `${label}: 1~${max}자의 텍스트를 입력해 주세요.`);
    return value.trim();
  }
  function numeric(value, label, min, max, positive = false, strict = false) {
    if ((strict && typeof value !== 'number') || (!strict && typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim()))
      fail('VALIDATION', `${label}: 숫자를 입력해 주세요.`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max || (positive && n === 0))
      fail('VALIDATION', `${label}: ${positive ? '0보다 크고' : min + ' 이상,'} ${max} 이하의 숫자를 입력해 주세요.`);
    return n;
  }
  function choice(value, choices, label) {
    if (!choices.includes(value)) fail('VALIDATION', `${label}: 제공된 항목을 선택해 주세요.`);
    return value;
  }
  function id(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('VALIDATION', '항목 ID가 올바르지 않습니다.');
    return value;
  }
  function list(value, max) {
    if (!Array.isArray(value) || value.length > max) fail('VALIDATION', `목록 형식 또는 최대 항목 수(${max})가 올바르지 않습니다.`);
    return value;
  }
  function unique(rows, key = 'id') {
    if (new Set(rows.map(row => row[key])).size !== rows.length) fail('VALIDATION', '중복된 항목 ID 또는 날짜가 있습니다.');
    return rows;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function makeId(prefix) {
    const token = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    return prefix + '_' + token;
  }
  function todayISO(now = new Date()) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('VALIDATION', '날짜가 올바르지 않습니다.');
    return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  function iso(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('VALIDATION', '날짜는 YYYY-MM-DD 형식이어야 합니다.');
    const [y, m, d] = value.split('-').map(Number);
    if (y < 1970 || y > 9999 || todayISO(new Date(y, m - 1, d, 12)) !== value) fail('VALIDATION', '존재하지 않는 날짜입니다.');
    return value;
  }
  function shiftDate(value, days) {
    iso(value);
    if (!Number.isInteger(days)) fail('VALIDATION', '날짜 이동은 정수여야 합니다.');
    const [y, m, d] = value.split('-').map(Number);
    return iso(todayISO(new Date(y, m - 1, d + days, 12)));
  }
  function profile(input, strict = false) {
    object(input);
    const result = {
      gender: choice(input.gender, ['male', 'female'], '성별'),
      age: numeric(input.age, '나이', 18, 100, false, strict),
      height: numeric(input.height, '키', 100, 250, false, strict),
      weight: numeric(input.weight, '체중', 30, 300, false, strict),
      activity: choice(numeric(input.activity, '활동량', 1.2, 1.9, false, strict), ACTIVITIES, '활동량'),
      goal: choice(input.goal, GOALS, '목표')
    };
    if (!Number.isInteger(result.age)) fail('VALIDATION', '나이는 정수로 입력해 주세요.');
    return result;
  }
  function calcTargets(input) {
    const p = profile(input);
    const calculator = new targets.CalorieCalculator(targets.goalStrategies[p.goal]);
    return calculator.calculate(p);
  }
  function classify(c, p, f) {
    const total = c + p + f;
    return [['탄수화물', c], ['단백질', p], ['지방', f]].filter(row => total && row[1] / total >= 0.4).map(row => row[0]).join('/') || '균형식';
  }
  function food(input, strict = false) {
    object(input);
    const result = { id: id(input.id), name: text(input.name, '음식명'), baseAmount: numeric(input.baseAmount, '기준량', 0, 100000, true, strict), unit: text(input.unit, '단위', 12) };
    MACROS.forEach(key => { result[key] = numeric(input[key], key, 0, 10000, false, strict); });
    result.category = text(input.category || classify(result.carb, result.protein, result.fat), '분류');
    if (typeof input.favorite !== 'boolean') fail('VALIDATION', '즐겨찾기 값이 올바르지 않습니다.');
    result.favorite = input.favorite;
    result.used = numeric(input.used, '사용 횟수', 0, Number.MAX_SAFE_INTEGER, false, true);
    if (!Number.isInteger(result.used)) fail('VALIDATION', '사용 횟수가 올바르지 않습니다.');
    return result;
  }
  function record(input) {
    object(input);
    const result = { id: id(input.id), date: iso(input.date), meal: choice(input.meal, MEALS, '식사'), foodId: id(input.foodId), name: text(input.name, '음식명'), category: text(input.category, '분류'), amount: numeric(input.amount, '섭취량', 0, 100000, true, true), unit: text(input.unit, '단위', 12) };
    MACROS.forEach(key => { result[key] = numeric(input[key], '계산된 영양값', 0, 1e15, false, true); });
    return result;
  }
  function combo(input, foods, strict = false) {
    object(input);
    const items = list(input.items, 50).map(item => {
      object(item);
      if (!foods.some(f => f.id === item.foodId)) fail('VALIDATION', '조합에 포함된 음식을 찾을 수 없습니다.');
      return { foodId: id(item.foodId), amount: numeric(item.amount, '조합 섭취량', 0, 100000, true, strict) };
    });
    if (!items.length) fail('VALIDATION', '조합에 음식을 하나 이상 추가해 주세요.');
    return { id: id(input.id), name: text(input.name, '조합명'), items };
  }
  function validateState(raw) {
    object(raw);
    if (raw.version !== 1) fail('VALIDATION', '지원하지 않는 데이터 버전입니다.');
    const state = { version: 1, profile: profile(raw.profile, true) };
    state.foods = unique(list(raw.foods, 500).map(item => food(item, true)));
    state.records = unique(list(raw.records, 10000).map(record));
    state.combos = unique(list(raw.combos, 200).map(item => combo(item, state.foods, true)));
    state.goalHistory = unique(list(raw.goalHistory, 2000).map(item => {
      object(item); object(item.targets);
      const targets = {};
      MACROS.forEach(key => { targets[key] = numeric(item.targets[key], '목표 영양값', 0, 10000, false, true); });
      if (!targets.calories) fail('VALIDATION', '목표 칼로리는 0보다 커야 합니다.');
      return { date: iso(item.date), goal: choice(item.goal, GOALS, '목표'), targets };
    }), 'date').sort((a, b) => a.date.localeCompare(b.date));
    if (!state.goalHistory.length) fail('VALIDATION', '목표 이력이 비어 있습니다.');
    return state;
  }
  function snapshot(f, amount, meal, date, recordId = makeId('record')) {
    const result = { id: recordId, date, meal, foodId: f.id, name: f.name, category: f.category, amount, unit: f.unit };
    MACROS.forEach(key => { const precision = key === 'calories' ? 1 : 10; result[key] = Math.round(f[key] * amount / f.baseAmount * precision) / precision; });
    return record(result);
  }
  function createBlankState(now = new Date()) {
    return { version: 1, profile: { ...DEFAULT_PROFILE }, foods: DEFAULT_FOODS.map((f, index) => ({ id: 'food_' + (index + 1), category: f[0], name: f[1], baseAmount: f[2], unit: f[3], calories: f[4], carb: f[5], protein: f[6], fat: f[7], favorite: false, used: 0 })), records: [], combos: [], goalHistory: [{ date: todayISO(now), goal: DEFAULT_PROFILE.goal, targets: calcTargets(DEFAULT_PROFILE) }] };
  }
  function createSampleState(now = new Date()) {
    const state = createBlankState(now), today = todayISO(now), yesterday = shiftDate(today, -1);
    state.goalHistory[0].date = yesterday;
    [[0, 150, '점심', today], [9, 200, '점심', today], [20, 100, '점심', today], [5, 150, '아침', today], [14, 1, '아침', today], [3, 150, '저녁', yesterday], [8, 200, '저녁', yesterday], [21, 100, '저녁', yesterday]].forEach(([index, amount, meal, date], i) => {
      state.records.push(snapshot(state.foods[index], amount, meal, date, 'sample_' + i));
      state.foods[index].used += 1;
    });
    state.foods[0].favorite = true; state.foods[5].favorite = true;
    state.combos = [
      { id: 'combo_1', name: '든든한 점심', items: [{ foodId: 'food_1', amount: 150 }, { foodId: 'food_10', amount: 200 }, { foodId: 'food_21', amount: 100 }] },
      { id: 'combo_2', name: '가벼운 아침', items: [{ foodId: 'food_6', amount: 150 }, { foodId: 'food_15', amount: 1 }] }
    ];
    return state;
  }
  function createStore(storage, key = 'nutrifit.demo.v1', nowFn = () => new Date()) {
    function load() {
      let saved;
      try { saved = storage.getItem(key); } catch (_) { fail('STORAGE_UNAVAILABLE', '브라우저 저장소를 읽을 수 없습니다. 사이트 저장소 설정을 확인해 주세요.'); }
      if (saved === null) return null;
      try { return validateState(JSON.parse(saved)); }
      catch (_) { fail('CORRUPT_DATA', '저장된 데이터 형식이 올바르지 않습니다. 데이터는 변경하지 않았습니다. 초기화를 선택해야 다시 시작할 수 있습니다.'); }
    }
    function save(raw) {
      const state = validateState(raw), serialized = JSON.stringify(state);
      try { storage.setItem(key, serialized); } catch (_) { fail('STORAGE_UNAVAILABLE', '저장하지 못했습니다. 저장 공간 또는 브라우저 설정을 확인해 주세요. 기존 데이터는 변경하지 않았습니다.'); }
      return clone(state);
    }
    function current() { const state = load(); if (!state) fail('NOT_INITIALIZED', '먼저 샘플 체험 또는 새 기록 시작을 선택해 주세요.'); return state; }
    // Read before every mutation; localStorage still has last-write-wins semantics across simultaneous tabs.
    function mutate(action) { const state = current(); action(state); return save(state); }
    function find(rows, itemId) { const item = rows.find(row => row.id === itemId); if (!item) fail('NOT_FOUND', '항목을 찾을 수 없습니다. 화면을 새로고침해 주세요.'); return item; }
    function editable(date) { iso(date); if (date < todayISO(nowFn())) fail('PAST_DATE', '지난 날짜의 기록은 수정할 수 없습니다.'); return date; }
    function addToState(state, input) {
      object(input);
      const date = editable(input.date === undefined ? todayISO(nowFn()) : input.date);
      const f = find(state.foods, input.foodId), amount = numeric(input.amount, '섭취량', 0, 100000, true);
      state.records.push(snapshot(f, amount, choice(input.meal, MEALS, '식사'), date)); f.used += 1;
    }
    return {
      load, getState: load, save,
      reset(mode = 'sample') { choice(mode, ['sample', 'blank'], '초기화 방식'); return save(mode === 'sample' ? createSampleState(nowFn()) : createBlankState(nowFn())); },
      updateProfile(input) { object(input); return mutate(state => { state.profile = profile({ ...state.profile, ...input }); const date = todayISO(nowFn()); state.goalHistory = state.goalHistory.filter(h => h.date !== date); state.goalHistory.push({ date, goal: state.profile.goal, targets: calcTargets(state.profile) }); }); },
      addFood(input) { object(input); return mutate(state => { state.foods.push(food({ ...input, id: makeId('food'), category: undefined, favorite: false, used: 0 })); }); },
      updateFood(itemId, input) { object(input); return mutate(state => { const f = find(state.foods, itemId); Object.assign(f, food({ ...f, ...input, id: f.id, category: undefined, favorite: f.favorite, used: f.used })); }); },
      deleteFood(itemId) { return mutate(state => { find(state.foods, itemId); if (state.combos.some(c => c.items.some(i => i.foodId === itemId))) fail('FOOD_IN_USE', '이 음식을 포함한 조합을 먼저 삭제해 주세요. 식사 기록은 그대로 유지됩니다.'); state.foods = state.foods.filter(f => f.id !== itemId); }); },
      toggleFavorite(itemId) { return mutate(state => { const f = find(state.foods, itemId); f.favorite = !f.favorite; }); },
      addRecord(input) { return mutate(state => addToState(state, input)); },
      deleteRecord(itemId) { return mutate(state => { editable(find(state.records, itemId).date); state.records = state.records.filter(r => r.id !== itemId); }); },
      addCombo(input) { object(input); return mutate(state => { state.combos.push(combo({ ...input, id: makeId('combo') }, state.foods)); }); },
      deleteCombo(itemId) { return mutate(state => { find(state.combos, itemId); state.combos = state.combos.filter(c => c.id !== itemId); }); },
      applyCombo(itemId, input) { object(input); return mutate(state => { const c = find(state.combos, itemId); c.items.forEach(item => addToState(state, { ...input, ...item })); }); },
      summary(date = todayISO(nowFn())) {
        iso(date); const state = current(), records = state.records.filter(r => r.date === date);
        const totals = { calories: 0, carb: 0, protein: 0, fat: 0 };
        records.forEach(r => MACROS.forEach(key => { totals[key] += r[key]; }));
        MACROS.forEach(key => { totals[key] = Math.round(totals[key] * 10) / 10; });
        const history = state.goalHistory.filter(h => h.date <= date), goal = history[history.length - 1] || state.goalHistory[0];
        return { date, records, totals, target: clone(goal.targets), locked: date < todayISO(nowFn()) };
      }
    };
  }
  return { todayISO, shiftDate, calcTargets, createSampleState, createBlankState, validateState, createStore };
});

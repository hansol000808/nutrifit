'use strict';
(() => {
  const Core = globalThis.NutriFitCore;
  const main = document.getElementById('main');
  const nav = document.getElementById('navigation');
  const notice = document.getElementById('notice');
  const meals = ['아침', '점심', '저녁', '간식1', '간식2'];
  const goalNames = {diet:'다이어트', maintain:'체중 유지', bulk:'벌크업'};
  const nutrientNames = {carb:'탄수화물', protein:'단백질', fat:'지방'};
  const nutrientColors = {carb:'#3f82de', protein:'#22a18d', fat:'#daa247'};
  let store, state, view = 'diary', selectedDate = Core.todayISO(), editId = null, draft = [], noticeTimer, lastSeenDay = Core.todayISO();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => Math.round(Number(value) || 0).toLocaleString('ko-KR');
  const pct = (value,target) => target > 0 ? Math.round(value / target * 100) : 0;
  const bar = (value,target,color) => `<div class="progress-track" role="img" aria-label="목표 대비 ${pct(value,target)}%"><span style="width:${Math.min(100,Math.max(0,pct(value,target)))}%;--bar:${color}"></span></div>`;
  const options = (items, selected) => items.map(([value,label]) => `<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label)}</option>`).join('');
  const sortedFoods = () => [...state.foods].sort((a,b) => Number(b.favorite)-Number(a.favorite) || b.used-a.used || a.name.localeCompare(b.name,'ko'));
  const foodOptions = (query = '') => options(sortedFoods().filter(f => f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(f => [f.id,`${f.favorite?'★ ':''}${f.name} · ${f.baseAmount}${f.unit} / ${fmt(f.calories)}kcal`]), '');
  function notify(message, error = false) {
    clearTimeout(noticeTimer); notice.textContent = message; notice.className = `notice${error?' error':''}`; notice.hidden = false;
    noticeTimer = setTimeout(() => {notice.hidden = true;}, error ? 9000 : 4500);
  }
  function confirmAction(message) {
    const dialog=document.getElementById('confirm-dialog');
    document.getElementById('confirm-message').textContent=message;
    dialog.returnValue='cancel';
    return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});dialog.showModal();});
  }
  function recover(error) {
    nav.innerHTML = '';
    main.innerHTML = `<section class="card recovery"><span class="eyebrow">BROWSER STORAGE</span><h1>저장된 정보를 불러오지 못했어요</h1><p>${esc(error.message)}</p><p>브라우저의 사이트 저장 권한을 확인한 뒤 새로고침해 주세요. 기존 데이터는 자동으로 삭제하지 않습니다.</p><div class="actions"><button data-action="reload">다시 불러오기</button><button class="danger" data-action="recover">저장 데이터 초기화</button></div></section>`;
  }
  function render() {
    if (!state) { landing(); return; }
    nav.innerHTML = [['diary','식사 기록'],['foods','음식 관리'],['settings','체험 설정']].map(([id,label]) => `<button data-action="view" data-view="${id}" ${view===id?'aria-current="page"':''}>${label}</button>`).join('');
    if (view === 'diary') diary(); else if (view === 'foods') foodsPage(); else settings();
  }
  function landing() {
    nav.innerHTML = '';
    main.innerHTML = `<div class="landing"><section class="hero"><div><span class="eyebrow">YOUR DAILY NUTRITION COMPANION</span><h1>나에게 맞는 식단,<br><em>하루의 기록</em>에서 시작.</h1><p class="hero-description">내 몸과 목표에 맞춘 영양 기준을 확인하고,<br>오늘의 식사를 하나씩 채워 보세요.<br>NutriFit이 하루의 균형을 한눈에 보여드립니다.</p><div class="actions"><button class="primary" data-action="start" data-mode="sample">샘플로 체험 시작 →</button><button data-action="start" data-mode="blank">빈 기록으로 시작</button></div><p class="hero-note">회원가입 없이 체험 · 입력한 내용은 이 브라우저에만 저장</p></div><div class="preview-card" aria-label="식단 기록 화면 예시"><div class="top"><strong>오늘의 영양 밸런스</strong><span class="pill blue">화면 예시</span></div><span class="muted small-text">섭취 칼로리</span><div class="energy-number">1,420 <small>/ 2,100 kcal</small></div>${bar(1420,2100,'#2563eb')}<div class="preview-bars">${[['탄수화물',180,260,'#3f82de'],['단백질',82,110,'#22a18d'],['지방',42,58,'#daa247']].map(([name,n,t,c])=>`<div><div class="row"><span>${name}</span><span>${n} <span class="muted">/ ${t}g</span></span></div>${bar(n,t,c)}</div>`).join('')}</div><div class="preview-meal"><span>✓ 한 끼씩, 더 나은 균형으로</span><span class="muted">NutriFit</span></div></div></section><section class="features" aria-label="주요 기능"><div class="feature"><span class="number">01 / PERSONAL GOALS</span><h3>목표에 맞는 영양 기준</h3><p>신체 정보와 활동량을 바탕으로<br>나에게 맞는 하루 목표를 계산합니다.</p></div><div class="feature"><span class="number">02 / SIMPLE RECORDS</span><h3>간편한 식사 기록</h3><p>음식을 고르고 섭취량만 입력하면<br>칼로리와 영양소가 함께 기록됩니다.</p></div><div class="feature"><span class="number">03 / YOUR ROUTINE</span><h3>자주 먹는 식단 조합</h3><p>즐겨 먹는 음식들을 하나로 묶어<br>반복되는 기록을 더 간편하게 만듭니다.</p></div></section></div>`;
  }
  function diary() {
    const s = store.summary(selectedDate), t = s.target, totals = s.totals;
    const remaining = t.calories - totals.calories;
    main.innerHTML = `<div class="container"><div class="page-heading"><div><span class="eyebrow">DAILY OVERVIEW</span><h1>오늘도, 균형 있게</h1><p class="muted">${selectedDate===Core.todayISO()?'오늘의 식사':'선택한 날짜의 식사'}를 기록하고 영양 목표를 확인하세요.</p></div><div class="date-control"><button data-action="day" data-offset="-1" aria-label="이전 날짜">‹</button><input type="date" id="record-date" aria-label="기록 날짜" min="1970-01-01" max="9999-12-31" value="${esc(selectedDate)}"><button data-action="day" data-offset="1" aria-label="다음 날짜">›</button><button class="small" data-action="today">오늘</button></div></div>${s.locked?'<div class="lock-note">지난 날짜의 기록입니다. 당시 기록과 영양 목표는 조회할 수 있고, 추가·삭제는 제한됩니다.</div>':''}<section class="summary-grid" aria-label="영양 요약"><div class="card energy-card"><span class="small-text">하루 섭취 칼로리</span><div class="energy-number">${fmt(totals.calories)} <small>/ ${fmt(t.calories)} kcal</small></div>${bar(totals.calories,t.calories,'#fff')}<div class="energy-meta"><span>${remaining>=0?`${fmt(remaining)} kcal 남았어요`:`목표보다 ${fmt(-remaining)} kcal 많아요`}</span><strong>${pct(totals.calories,t.calories)}%</strong></div></div><div class="card"><div class="card-title"><h2>영양소 밸런스</h2><span class="pill">일일 목표 대비</span></div><div class="macro-list">${Object.keys(nutrientNames).map(k=>`<div><div class="macro-label"><span class="dot" style="--bar:${nutrientColors[k]}"></span>${nutrientNames[k]}</div><div class="macro-value">${fmt(totals[k])}<small> / ${fmt(t[k])} g</small></div>${bar(totals[k],t[k],nutrientColors[k])}<span class="muted">${pct(totals[k],t[k])}% 달성</span></div>`).join('')}</div></div></section><div class="dashboard-grid"><div class="stack"><section class="card"><div class="card-title"><h2>하루 식사 기록</h2><span class="pill blue">${s.records.length}개 기록</span></div>${meals.map((meal,i)=>{const rs=s.records.filter(r=>r.meal===meal);return `<div class="meal"><div class="meal-heading"><h3><span class="meal-icon" aria-hidden="true">${['☀','◷','☾','◦','◦'][i]}</span>${meal}</h3><span class="muted small-text">${fmt(rs.reduce((sum,r)=>sum+r.calories,0))} kcal</span></div>${rs.length?rs.map(r=>`<div class="record"><div><p>${esc(r.name)}</p><p class="record-meta">${esc(r.amount)}${esc(r.unit)} · 탄 ${fmt(r.carb)} / 단 ${fmt(r.protein)} / 지 ${fmt(r.fat)}g</p></div><div class="record-right"><span>${fmt(r.calories)} kcal</span>${s.locked?'':`<button data-action="delete-record" data-id="${esc(r.id)}" aria-label="${esc(r.name)} 기록 삭제">×</button>`}</div></div>`).join(''):'<p class="empty-meal">아직 기록한 음식이 없어요.</p>'}</div>`}).join('')}</section><section class="card"><div class="card-title"><h2>목표와의 거리</h2><span class="pill">섭취 현황</span></div><p class="muted small-text">각 영양소의 목표 대비 차이입니다. 수치는 학습용 계산 예시로, 개인의 건강 상태는 반영하지 않습니다.</p>${Object.keys(nutrientNames).map(k=>{const diff=t[k]-totals[k];return `<div class="meal-heading small-text" style="padding:5px 0"><span>${nutrientNames[k]}</span><strong>${diff>=0?`${fmt(diff)}g 남음`:`${fmt(-diff)}g 초과`}</strong></div>`}).join('')}</section></div><aside class="stack"><section class="card"><div class="card-title"><h2>음식 기록하기</h2><span class="pill">${esc(selectedDate.slice(5).replace('-','.'))}</span></div>${s.locked?'<p class="muted small-text">오늘 또는 앞으로의 날짜를 선택하면 음식을 추가할 수 있습니다.</p>':`<form id="record-form" class="form-grid"><label class="span-2">음식 검색<input type="search" id="record-search" placeholder="음식 이름을 입력하세요" autocomplete="off"></label><label class="span-2">음식 선택<select id="record-food" name="foodId" required><option value="">음식을 선택해 주세요</option>${foodOptions()}</select></label><label>식사 구분<select name="meal">${options(meals.map(m=>[m,m]),'점심')}</select></label><label><span id="amount-label">섭취량</span><input name="amount" type="number" min="0.01" max="100000" step="any" placeholder="음식 선택 후 입력" required></label><button class="primary span-2" type="submit">+ 식사에 기록</button><button class="span-2 small" type="button" data-action="draft-add">이 음식을 조합에 담기</button></form><p class="form-note">섭취량에 따라 영양소가 자동 계산됩니다.<br>기본 음식의 영양 정보는 체험용 예시입니다.</p>`}</section><section class="card"><div class="card-title"><h2>나의 식단 조합</h2><span class="pill">${state.combos.length}개</span></div><p class="muted small-text">자주 먹는 한 끼를 한 번에 기록하세요.</p>${state.combos.map(c=>`<div class="combo-row"><strong>${esc(c.name)}</strong><p>${c.items.map(item=>{const f=state.foods.find(x=>x.id===item.foodId);return `${esc(f?.name||'삭제된 음식')} ${item.amount}${esc(f?.unit||'')}`}).join(' + ')}</p><div class="actions"><button class="small" data-action="apply-combo" data-id="${esc(c.id)}" ${s.locked?'disabled':''}>선택한 식사에 추가</button><button class="small quiet" data-action="delete-combo" data-id="${esc(c.id)}" aria-label="${esc(c.name)} 조합 삭제">삭제</button></div></div>`).join('') || '<p class="muted small-text">저장한 조합이 없습니다.</p>'}${draft.length?`<hr class="divider"><h3>새 조합 만들기</h3><ul class="draft-list">${draft.map((item,i)=>{const f=state.foods.find(x=>x.id===item.foodId);return `<li><span>${esc(f?.name)} ${item.amount}${esc(f?.unit)}</span><button class="quiet small" data-action="draft-remove" data-index="${i}" aria-label="조합에서 ${esc(f?.name)} 빼기">×</button></li>`}).join('')}</ul><form id="combo-form"><label>조합 이름<input name="name" placeholder="예: 가벼운 아침" maxlength="80" required></label><button class="primary full section-gap" type="submit">조합 저장</button></form>`:''}<p class="form-note">위 음식 기록 폼의 식사 구분에 추가됩니다.<br>새 조합은 음식을 선택하고 ‘조합에 담기’로 만드세요.</p></section></aside></div></div>`;
  }
  function foodRows(query='') {
    const rows = sortedFoods().filter(f=>f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    return rows.map(f=>`<tr><td><button class="star ${f.favorite?'active':''}" data-action="favorite" data-id="${esc(f.id)}" aria-label="${esc(f.name)} 즐겨찾기" aria-pressed="${f.favorite?'true':'false'}">${f.favorite?'★':'☆'}</button></td><td><div class="food-name">${esc(f.name)}</div><div class="food-detail">${f.baseAmount}${esc(f.unit)} · ${esc(f.category)}</div></td><td><strong>${fmt(f.calories)}</strong><div class="food-detail">kcal</div></td><td><div>${fmt(f.carb)} / ${fmt(f.protein)} / ${fmt(f.fat)}</div><div class="food-detail">탄 / 단 / 지 (g)</div></td><td><button class="small" data-action="edit-food" data-id="${esc(f.id)}">수정</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">검색 결과가 없습니다.</td></tr>';
  }
  function foodsPage() {
    const f = state.foods.find(f=>f.id===editId);
    main.innerHTML = `<div class="container"><div class="page-heading"><div><span class="eyebrow">FOOD LIBRARY</span><h1>나의 음식 목록</h1><p class="muted">기본 음식을 찾아보거나 자주 먹는 음식을 직접 등록하세요.</p></div><span class="pill blue">${state.foods.length}개 음식</span></div><div class="food-layout"><section class="card"><label>음식 검색<input id="food-search" type="search" placeholder="음식 이름으로 검색" autocomplete="off"></label><div class="table-scroll"><table class="food-table"><thead><tr><th aria-label="즐겨찾기">★</th><th>음식 / 기준량</th><th>열량</th><th>영양소</th><th>관리</th></tr></thead><tbody id="food-rows">${foodRows()}</tbody></table></div></section><section class="card food-edit-title" id="food-editor"><div class="card-title"><h2>${f?'음식 수정':'새 음식 등록'}</h2>${f?'<button class="small quiet" data-action="cancel-edit">취소</button>':'<span class="pill">직접 입력</span>'}</div><form id="food-form" class="form-grid"><label class="span-2">음식 이름<input name="name" value="${esc(f?.name||'')}" maxlength="80" placeholder="예: 오트밀" required></label><label>기준량<input name="baseAmount" type="number" min="0.01" max="100000" step="any" value="${f?.baseAmount||100}" required></label><label>단위<input name="unit" value="${esc(f?.unit||'g')}" maxlength="12" required></label>${[['calories','칼로리 (kcal)'],['carb','탄수화물 (g)'],['protein','단백질 (g)'],['fat','지방 (g)']].map(([key,label])=>`<label>${label}<input name="${key}" type="number" min="0" max="10000" step="any" value="${f?.[key]??''}" required></label>`).join('')}<button class="primary span-2" type="submit">${f?'변경 내용 저장':'음식 등록'}</button>${f?`<button class="danger span-2" type="button" data-action="delete-food" data-id="${esc(f.id)}">이 음식 삭제</button>`:''}</form><p class="form-note">입력한 기준량에 해당하는 영양 정보를 적어 주세요. 기존 식사 기록의 수치는 수정 후에도 유지됩니다.</p></section></div></div>`;
  }
  function settings() {
    const p=state.profile, t=Core.calcTargets(p);
    main.innerHTML = `<div class="container"><div class="page-heading"><div><span class="eyebrow">YOUR PREFERENCES</span><h1>나에게 맞는 목표</h1><p class="muted">샘플 신체 정보를 바꾸며 목표 영양량이 어떻게 달라지는지 살펴보세요.</p></div></div><div class="settings-grid"><section class="card"><h2>체험 프로필</h2><div class="insight">계정 정보가 아닌 <strong>이 브라우저의 계산용 설정</strong>입니다. 초기 프로필과 식사 기록은 가상의 예시입니다.</div><form id="profile-form" class="form-grid"><label>계산식 기준 성별<select name="gender">${options([['male','남성'],['female','여성']],p.gender)}</select></label><label>나이 (세)<input name="age" type="number" min="18" max="100" step="1" value="${p.age}" required></label><label>키 (cm)<input name="height" type="number" min="100" max="250" step="any" value="${p.height}" required></label><label>체중 (kg)<input name="weight" type="number" min="30" max="300" step="any" value="${p.weight}" required></label><label class="span-2">활동량<select name="activity">${options([[1.2,'거의 활동하지 않음'],[1.375,'가벼운 활동'],[1.55,'보통의 운동'],[1.725,'활동적'],[1.9,'매우 활동적']],p.activity)}</select></label><label class="span-2">식단 목표<select name="goal">${options(Object.entries(goalNames),p.goal)}</select></label><button class="primary span-2" type="submit">목표 업데이트</button></form><p class="form-note">목표 변경은 오늘부터 적용됩니다. 지난 날짜의 목표와 기록은 유지됩니다.</p></section><div class="stack"><section class="card"><div class="card-title"><h2>현재 일일 목표</h2><span class="pill blue">${goalNames[p.goal]}</span></div><div class="energy-number">${fmt(t.calories)} <small style="color:var(--muted)">kcal</small></div>${Object.keys(nutrientNames).map(k=>`<div class="meal-heading small-text" style="padding:6px 0"><span class="muted">${nutrientNames[k]}</span><strong>${fmt(t[k])}g</strong></div>`).join('')}<p class="form-note">기초대사량과 활동량을 이용한 추정치이며, 목표 열량은 원본 계산식에 따라 1,200–4,500kcal로 제한됩니다.</p></section><section class="card"><h2>데모 데이터 관리</h2><p class="muted small-text">기록은 현재 브라우저에 저장됩니다. 다른 기기와 공유되지 않으며, 사이트 데이터를 지우면 함께 삭제됩니다.</p><div class="actions"><button data-action="reset" data-mode="sample">샘플로 초기화</button><button class="danger" data-action="reset" data-mode="blank">빈 기록으로 초기화</button></div><p class="form-note">초기화하면 직접 추가한 음식, 조합, 프로필과 식사 기록이 모두 교체됩니다.</p></section></div></div></div>`;
  }
  function mutate(fn, message) { state = fn(); render(); if (message) notify(message); }
  function recordInput() {
    const form=document.getElementById('record-form');
    if (!form || !form.reportValidity()) return null;
    return {...Object.fromEntries(new FormData(form)), date:selectedDate};
  }
  function initialize() {
    try {store=Core.createStore(window.localStorage);state=store.load();render();} catch(error) {recover(error);}
  }
  document.addEventListener('click', async event => {
    const button=event.target.closest('button[data-action]'); if (!button || button.disabled) return;
    try {
      const {action,id,mode}=button.dataset;
      if (action==='reload') {initialize();return;}
      if (action==='recover') {if(await confirmAction('이 브라우저에 저장된 NutriFit 데모 데이터를 삭제하고 샘플로 시작할까요?')){store=Core.createStore(window.localStorage);state=store.reset('sample');draft=[];editId=null;selectedDate=Core.todayISO();view='diary';render();notify('샘플 데이터를 불러왔습니다.');}return;}
      if (action==='start') {mutate(()=>store.reset(mode),'체험을 시작합니다. 설정에서 목표를 바꿀 수 있어요.');return;}
      if (action==='view') {view=button.dataset.view;editId=null;render();return;}
      if (action==='day') {selectedDate=Core.shiftDate(selectedDate,Number(button.dataset.offset));render();return;}
      if (action==='today') {selectedDate=Core.todayISO();render();return;}
      if (action==='delete-record') {mutate(()=>store.deleteRecord(id),'식사 기록을 삭제했습니다.');return;}
      if (action==='favorite') {mutate(()=>store.toggleFavorite(id));return;}
      if (action==='edit-food') {editId=id;render();document.getElementById('food-editor').scrollIntoView({block:'nearest'});document.querySelector('#food-form input').focus({preventScroll:true});return;}
      if (action==='cancel-edit') {editId=null;render();return;}
      if (action==='delete-food') {if(await confirmAction('이 음식을 목록에서 삭제할까요? 기존 식사 기록은 유지됩니다.')){state=store.deleteFood(id);draft=draft.filter(item=>item.foodId!==id);editId=null;render();notify('음식을 삭제했습니다.');}return;}
      if (action==='draft-add') {const input=recordInput();if(input){const existing=draft.find(x=>x.foodId===input.foodId);if((existing?.amount||0)+Number(input.amount)>100000)throw new Error('조합에 담긴 같은 음식의 섭취량은 100,000 이하여야 합니다.');if(existing)existing.amount+=Number(input.amount);else draft.push({foodId:input.foodId,amount:Number(input.amount)});render();notify('새 조합에 담았습니다. 아래에서 이름을 정해 저장하세요.');}return;}
      if (action==='draft-remove') {draft.splice(Number(button.dataset.index),1);render();return;}
      if (action==='apply-combo') {const meal=document.querySelector('#record-form [name=meal]')?.value || '점심';mutate(()=>store.applyCombo(id,{date:selectedDate,meal}),`${meal}에 조합을 기록했습니다.`);return;}
      if (action==='delete-combo') {if(await confirmAction('이 식단 조합을 삭제할까요?'))mutate(()=>store.deleteCombo(id),'식단 조합을 삭제했습니다.');return;}
      if (action==='reset' && await confirmAction('직접 입력한 내용을 포함해 현재 데모 데이터 전체를 초기화할까요? 이 작업은 되돌릴 수 없습니다.')) {state=store.reset(mode);draft=[];editId=null;selectedDate=Core.todayISO();render();notify('데모 데이터를 초기화했습니다.');}
    } catch(error) {notify(error.message,true);}
  });
  document.addEventListener('submit', event => {
    if (!['record-form','food-form','combo-form','profile-form'].includes(event.target.id)) return;
    event.preventDefault();
    try {
      const data=Object.fromEntries(new FormData(event.target));
      if (event.target.id==='record-form') mutate(()=>store.addRecord({...data,date:selectedDate}),'식사를 기록했습니다.');
      if (event.target.id==='food-form') {state=editId?store.updateFood(editId,data):store.addFood(data);editId=null;render();notify('음식을 저장했습니다.');}
      if (event.target.id==='profile-form') mutate(()=>store.updateProfile(data),'오늘부터 적용할 목표를 업데이트했습니다.');
      if (event.target.id==='combo-form') {state=store.addCombo({name:data.name,items:draft});draft=[];render();notify('식단 조합을 저장했습니다.');}
    } catch(error) {notify(error.message,true);}
  });
  document.addEventListener('input', event => {
    if(event.target.id==='record-search') {document.getElementById('record-food').innerHTML='<option value="">음식을 선택해 주세요</option>'+foodOptions(event.target.value);document.getElementById('amount-label').textContent='섭취량';document.querySelector('#record-form [name=amount]').value='';}
    if(event.target.id==='food-search') document.getElementById('food-rows').innerHTML=foodRows(event.target.value);
  });
  document.addEventListener('change', event => {
    try {
      if(event.target.id==='record-date') {if(!event.target.value || !event.target.reportValidity())return;Core.shiftDate(event.target.value,0);selectedDate=event.target.value;render();}
      if(event.target.id==='record-food') {const f=state.foods.find(x=>x.id===event.target.value);document.getElementById('amount-label').textContent=f?`섭취량 (${f.unit})`:'섭취량';document.querySelector('#record-form [name=amount]').value=f?f.baseAmount:'';}
    } catch(error){notify(error.message,true);}
  });
  window.addEventListener('storage', event => {
    if(event.key!=='nutrifit.demo.v1' && event.key!==null)return;
    try {state=store.load();draft=[];editId=null;render();notify('다른 탭의 변경 내용을 반영했습니다.');} catch(error){recover(error);}
  });
  document.addEventListener('visibilitychange', () => { if(document.visibilityState!=='visible' || lastSeenDay===Core.todayISO())return; lastSeenDay=Core.todayISO(); initialize(); });
  initialize();
})();

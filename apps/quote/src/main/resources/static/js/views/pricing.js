import { api } from '../api.js';
import { store } from '../app.js';
import { h, toast, clear, confirmModal, resizableColumns, numInput, openModal, won } from '../ui.js';

// 가격정책 — 2026-10-30 다시 구성(사용자 요청): 1단계 솔루션(왼쪽 레일) → 2단계 SaaS | On-premise(탭) → 3단계 입력.
//   SaaS       : 서비스(S2C · S2P 등)마다 인원 구간 · 건수 구간 금액표(구간 월 금액) — 서비스 품목의 variants(key USER / COUNT)에 둔다.
//   On-premise : 모듈과 금액 — 구축형 견적 품목(sq_price_items, deployment ONPREM*)의 기준단가.
//   그 밖에 셋업비 · 옵션 같은 SaaS 품목은 '전체 품목' 탭, 직무 단가는 '직무별 단가(공통)' 탭에서 고친다.
// 그리드 탭은 L1 인라인 편집형 — 머리(행추가/행삭제/저장) + 편집 그리드.
// 등록·수정·삭제는 팝업 없이 그리드에서. 동작은 마스터 관리와 같다(선택 60px · 칸 너비 조절 · 머리 정렬 · 콤마 입력).
// std_mm(표준투입 M/M)·비고는 보내지 않으므로 기존 값이 그대로 남는다. 네고율은 마스터에서 관리한다.
//
// 견적 품목 탭은 견적 템플릿 · 견적 작성이 단가를 찾는 표다(템플릿 품목코드 → 이 표의 코드). /api/pricing 창구를 쓴다.
//   이미 있는 품목의 코드는 고칠 수 없다 — 템플릿과 저장된 견적이 코드로 참조한다. 바꾸려면 새 품목을 만들고 템플릿에서 다시 고른다.
const DEPLOYMENTS = [['ONPREM', '구축형(공통)'], ['ONPREM_LUMP', '구축형 일시불'], ['ONPREM_INSTALL', '구축형 분납'], ['SAAS', 'SaaS'], ['PCLOUD', 'Private Cloud']];
const PRICING_TYPES = [['FIXED', '고정'], ['DISCOUNT', '할인율'], ['BAND', '건수 밴드'], ['MM', '공수(M/M)']];

// 탭마다 읽기·쓰기 창구. 기본은 마스터 관리 창구(/api/master/{type})
const masterApi = (type) => ({
  list: (st, scoped) => api.masterList(type, scoped ? st.solution : undefined).then((r) => r.rows || []),
  create: (row) => api.masterCreate(type, row),
  update: (id, row) => api.masterUpdate(type, id, row),
  remove: (id) => api.masterDelete(type, id),
});
const itemApi = {
  list: (st) => api.pricing(st.solution, st.deployment || undefined).then((r) => r.items || []),
  create: (row) => api.createPriceItem(row),
  update: (id, row) => api.updatePriceItem(id, row),
  remove: (id) => api.deletePriceItem(id), // 사용 중지(active=0)
};

// On-premise 탭 — 구축형(공통 · 일시불 · 분납) 품목만
const ONPREM_DEPS = DEPLOYMENTS.filter(([v]) => v.startsWith('ONPREM'));
const onpremApi = {
  list: (st) => api.pricing(st.solution).then((r) => (r.items || []).filter((x) => String(x.deployment).startsWith('ONPREM'))),
  create: (row) => api.createPriceItem(row),
  update: (id, row) => api.updatePriceItem(id, row),
  remove: (id) => api.deletePriceItem(id),
};

const TABS = [
  { key: 'saas', label: 'SaaS', custom: true },
  {
    key: 'onprem', label: 'On-premise', api: onpremApi, scoped: true,
    note: '구축형 견적의 모듈과 금액입니다. 견적 작성 · 템플릿이 이 금액을 기준단가로 씁니다. 이미 있는 모듈의 코드는 고칠 수 없습니다.',
    fields: [
      { key: 'code', label: '코드', type: 'text', mono: true, required: true, unique: true, lockOnEdit: true, width: 170 },
      { key: 'deployment', label: '구축형태', type: 'select', options: ONPREM_DEPS, required: true, width: 130 },
      { key: 'category', label: '구분', type: 'text', width: 170 },
      { key: 'name', label: '모듈', type: 'text', required: true, width: 220 },
      { key: 'spec', label: '세부기능', type: 'text', width: 320 },
      { key: 'base_price', label: '금액 (원)', type: 'money', width: 150 },
      { key: 'sort', label: '정렬', type: 'number', width: 70 },
    ],
    defaults: () => ({ deployment: 'ONPREM' }),
    injectOnCreate: { pricing_type: 'FIXED', qty_default: 1 },
  },
  {
    key: 'items', label: '전체 품목', api: itemApi, scoped: true, deploymentFilter: true,
    note: '견적 템플릿 · 견적 작성이 이 품목의 기준단가를 씁니다. 이미 있는 품목의 코드는 템플릿이 참조하므로 고칠 수 없습니다.',
    fields: [
      { key: 'code', label: '코드', type: 'text', mono: true, required: true, unique: true, lockOnEdit: true, width: 170 },
      { key: 'deployment', label: '구축형태', type: 'select', options: DEPLOYMENTS, required: true, width: 130 },
      { key: 'category', label: '구분', type: 'text', width: 170 },
      { key: 'name', label: '품목명', type: 'text', required: true, width: 200 },
      { key: 'spec', label: '세부기능', type: 'text', width: 300 },
      { key: 'pricing_type', label: '가격방식', type: 'select', options: PRICING_TYPES, required: true, width: 110 },
      { key: 'unit', label: '단위', type: 'text', width: 90 },
      { key: 'base_price', label: '기준단가 (원)', type: 'money', width: 140 },
      { key: 'qty_default', label: '기본수량', type: 'number', width: 90 },
      { key: 'recurring', label: '월', type: 'checkbox', width: 50 },
      { key: 'sort', label: '정렬', type: 'number', width: 70 },
    ],
    defaults: (st) => ({ deployment: st.deployment || 'ONPREM', pricing_type: 'FIXED', qty_default: 1 }),
  },
  {
    key: 'labor', label: '직무별 단가(공통)', type: 'labor_roles', scoped: false,
    note: '직무 단가는 전 솔루션 공통, 1 M/M 기준입니다.',
    injectOnCreate: { solution: 'PROCURE' }, // solution 은 NOT NULL — 신규만 넣는다
    fields: [
      { key: 'code', label: '코드', type: 'text', mono: true, required: true, unique: true, width: 130 },
      { key: 'name', label: '직무명', type: 'text', required: true },
      { key: 'base_price', label: '표준단가 1 M/M (원)', type: 'money', width: 170 },
      { key: 'required', label: '필수', type: 'checkbox', width: 60 },
      { key: 'sort', label: '정렬', type: 'number', width: 70 },
    ],
  },
];

export async function renderPricing(root) {
  const master = await store.getMaster();
  const solutions = master.solutions || [];
  const defaultSolution = solutions.find((s) => s.code === 'PROCURE')?.code || solutions[0]?.code || '';

  const state = { tab: TABS[0].key, solution: defaultSolution, deployment: '' };
  const solName = () => solutions.find((x) => x.code === state.solution)?.name || state.solution;
  let rows = [];     // [{ orig, form, isNew, checked, seq }]
  let deleted = [];  // 행삭제한 기존 행 — 저장할 때 사용 중지(active=0)
  let sort = { key: null, dir: null };
  let seq = 0;
  let tbody, headCells = [];

  const current = () => TABS.find((t) => t.key === state.tab);
  const isDirty = () => (current().custom ? saasDirty() : deleted.length > 0 || rows.some((r) => r.isNew || changed(r)));

  // 저장 안 한 변경이 있어도 막지 않는다 — 알리기만 하고 누른 곳으로 간다(변경은 버린다). 2026-10-30 사용자 요청
  const warnUnsaved = () => { if (isDirty()) toast('저장하지 않은 변경은 반영되지 않았습니다.', 'err'); };

  // ── 1단계: 솔루션 레일 / 2단계: 탭(SaaS | On-premise | 전체 품목 | 직무별 단가) ──
  document.querySelector('.ss-app')?.classList.add('ss-app--railtitle');
  const railList = h('div');
  const rail = h('aside', { class: 'ss-rail ss-rail--code', style: '--ss-rail-w:240px' },
    h('div', { class: 'ss-rail__head ss-rail__head--title' }, '솔루션'), railList);
  const subtitle = h('div', { class: 'ss-subtitle' });
  const tabs = h('div', { class: 'ss-tabs' });
  const pane = h('div', { class: 'ss-tabbox__pane' });
  root.appendChild(h('div', { class: 'ss-railview' }, rail,
    h('div', { class: 'ss-railview__body', style: 'overflow:auto;display:flex;flex-direction:column' },
      subtitle, h('div', { class: 'ss-tabbox', style: 'margin-top:16px;flex:1 0 360px' }, tabs, pane))));

  function paintRail() {
    clear(railList);
    for (const sol of solutions) {
      railList.appendChild(h('div', {
        class: 'ss-rail__code' + (sol.code === state.solution ? ' ss-rail__code--active' : ''),
        onclick: () => {
          if (sol.code === state.solution) return;
          warnUnsaved();
          state.solution = sol.code;
          refresh();
        },
      }, h('span', { class: 'ss-rail__code-key' }, sol.code), h('span', { class: 'ss-rail__code-name' }, sol.name || sol.code)));
    }
  }

  function paintTabs() {
    clear(tabs);
    TABS.forEach((t) => tabs.appendChild(h('div', {
      class: 'ss-tabs__tab' + (t.key === state.tab ? ' ss-tabs__tab--active' : ''),
      onclick: () => {
        if (t.key === state.tab) return;
        warnUnsaved();
        state.tab = t.key;
        refresh();
      },
    }, t.label)));
  }

  function refresh() {
    rows = []; deleted = []; sort = { key: null, dir: null };
    paintRail();
    paintTabs();
    clear(pane);
    const t = current();
    subtitle.textContent = t.key === 'labor' ? '직무별 단가 (전 솔루션 공통)' : `${solName()} 가격정책`;
    if (t.custom) { paintSaas(); return; }

    // 머리: (전체 품목) 구축형태 거르기 + 행추가 · 행삭제 · 저장 — 솔루션은 왼쪽 레일에서 고른다
    const fields = h('div', { class: 'ss-edithead__fields' });
    if (t.deploymentFilter) {
      fields.appendChild(h('div', { class: 'ss-field' },
        h('select', { class: 'ss-select', 'aria-label': '구축형태', onchange: (e) => {
          warnUnsaved();
          state.deployment = e.target.value; load();
        } }, h('option', { value: '' }, '전체 구축형태'),
        ...DEPLOYMENTS.map(([v, l]) => h('option', { value: v, selected: v === state.deployment }, l)))));
    }
    pane.appendChild(h('div', { class: 'ss-edithead', style: 'margin-top:16px' }, fields,
      h('div', { class: 'ss-actions' },
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: addRow }, '행추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: removeRows }, '행삭제'),
        h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));
    if (t.note) {
      pane.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
        h('span', { class: 'ss-detailbar__note' }, t.note)));
    }

    // 칸마다 정한 너비 그대로 — 남는 폭을 한 칸(이름)이 다 받아 길어지지 않게. 선택 칸은 60px 고정
    const widths = [60, ...t.fields.map((f) => f.width || 240)];
    const cols = widths.map((w) => h('col', { style: `width:${w}px` }));
    tbody = h('tbody');
    const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${widths.reduce((s, w) => s + w, 0)}px` },
      h('colgroup', {}, ...cols),
      h('thead', {}, h('tr', {},
        h('th', { 'data-fixed': '' }, '선택'),
        ...(headCells = t.fields.map((f) => h('th', {
          class: 'is-sortable' + (f.required ? ' req' : ''), title: '눌러서 정렬', onclick: () => toggleSort(f),
        }, f.label, h('span', { class: 'ss-sortmark' })))))),
      tbody);
    pane.appendChild(h('div', { class: 'ss-gridwrap ss-gridwrap--fill', style: t.note ? 'margin-top:8px' : 'margin-top:12px' }, table));
    resizableColumns(table, `quote2:pricing-cols:${t.key}`);
    load();
  }

  const emptyRow = (text) => h('tr', {}, h('td', { colspan: current().fields.length + 1, class: 'ss-cell--empty' }, text));
  const toForm = (t, row) => Object.fromEntries(t.fields.map((f) => [f.key, f.type === 'checkbox' ? (row[f.key] ? 1 : 0) : row[f.key]]));

  async function load() {
    const t = current();
    rows = []; deleted = [];
    clear(tbody).appendChild(emptyRow('불러오는 중...'));
    try {
      const list = await (t.api || masterApi(t.type)).list(state, t.scoped);
      // 사용 중지한 행은 보이지 않는다 (마스터 관리와 같은 규칙)
      rows = (list || []).filter((r) => r.active).map((r) => ({ orig: r, form: toForm(t, r), isNew: false, checked: false, seq: seq++ }));
      applySort();
      paintRows();
    } catch (err) {
      clear(tbody).appendChild(emptyRow(err.message));
    }
  }

  function addRow() {
    const t = current();
    const form = Object.fromEntries(t.fields.map((f) => [f.key,
      f.type === 'checkbox' ? 0 : f.key === 'sort' ? rows.length + 1 : null]));
    Object.assign(form, t.defaults ? t.defaults(state) : {}); // 지금 고른 구축형태 등으로 미리 채운다
    rows.push({ orig: null, form, isNew: true, checked: false, seq: seq++ });
    paintRows();
    tbody.lastElementChild?.querySelector('input:not([type=checkbox])')?.focus();
  }

  function removeRows() {
    const picked = rows.filter((r) => r.checked);
    if (!picked.length) return toast('삭제할 행을 선택하세요.', 'err');
    picked.forEach((r) => { if (!r.isNew) deleted.push(r.orig); });
    rows = rows.filter((r) => !r.checked);
    paintRows();
  }

  // 머리 칸을 누를 때마다 오름 → 내림 → 원래 순서
  function toggleSort(f) {
    const next = sort.key !== f.key ? 'asc' : sort.dir === 'asc' ? 'desc' : null;
    sort = { key: next ? f.key : null, dir: next };
    headCells.forEach((th, i) => {
      const on = current().fields[i].key === sort.key;
      th.querySelector('.ss-sortmark').textContent = on ? (sort.dir === 'asc' ? '▲' : '▼') : '';
      th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    applySort();
    paintRows();
  }

  function applySort() {
    const f = sort.key && current().fields.find((x) => x.key === sort.key);
    if (!f) { rows.sort((a, b) => a.seq - b.seq); return; }
    const num = f.type !== 'text' && f.type !== 'select';
    const val = (r) => { const v = r.form[f.key]; return v == null || v === '' ? null : num ? Number(v) : String(v); };
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return x == null && y == null ? a.seq - b.seq : x == null ? 1 : -1;
      const c = num ? x - y : x.localeCompare(y, 'ko', { numeric: true });
      return c ? c * dir : a.seq - b.seq;
    });
  }

  function paintRows() {
    const t = current();
    clear(tbody);
    if (!rows.length) { tbody.appendChild(emptyRow('데이터가 없습니다. 행추가로 등록하세요.')); return; }
    rows.forEach((r) => {
      const tr = h('tr', { class: r.isNew ? 'is-new' : null },
        h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })));
      t.fields.forEach((f) => tr.appendChild(cellEl(f, r)));
      tbody.appendChild(tr);
    });
  }

  function cellEl(f, r) {
    const form = r.form;
    if (f.type === 'select') {
      const opts = f.options.some(([v]) => v === form[f.key]) || form[f.key] == null ? f.options : [[form[f.key], form[f.key]], ...f.options];
      return h('td', { class: 'ss-cell--input' }, h('select', { class: 'ss-cellinput', 'aria-label': f.label,
        onchange: (e) => { form[f.key] = e.target.value; } },
      ...opts.map(([v, l]) => h('option', { value: v, selected: v === form[f.key] }, l))));
    }
    // 잠긴 칸(이미 있는 품목의 코드)은 글자만 보인다
    if (f.lockOnEdit && !r.isNew) {
      return h('td', { class: 'ss-cell--link', style: 'text-align:center', title: '템플릿이 참조하는 코드라 고칠 수 없습니다' }, form[f.key] ?? '');
    }
    if (f.type === 'checkbox') {
      return h('td', {}, h('input', { type: 'checkbox', checked: !!form[f.key], 'aria-label': f.label,
        onchange: (e) => { form[f.key] = e.target.checked ? 1 : 0; } }));
    }
    // 금액은 우측, 정렬 순번·코드는 가운데
    const attrs = { class: 'ss-cellinput', 'aria-label': f.label,
      style: f.key === 'sort' || f.mono ? 'text-align:center' : f.type === 'money' ? 'text-align:right' : null };
    const inp = f.type === 'text'
      ? h('input', { ...attrs, type: 'text', value: form[f.key] ?? '', oninput: (e) => { form[f.key] = e.target.value; } })
      : numInput(form[f.key], (v) => { form[f.key] = v; }, attrs);
    return h('td', { class: 'ss-cell--input' + (f.mono ? ' ss-cell--link' : '') }, inp);
  }

  // 화면에 있는 칸만 보낸다 — std_mm · 비고 등은 건드리지 않는다
  function payloadOf(t, form, isNew) {
    const payload = {};
    let missing = null;
    t.fields.forEach((f) => {
      let v = form[f.key];
      if (f.type === 'checkbox') v = v ? 1 : 0;
      else if (f.type !== 'text' && f.type !== 'select') v = v === '' || v == null ? null : Number(v);
      else v = v == null ? '' : String(v).trim();
      if (f.required && (v === '' || v == null)) missing = missing || f.label;
      payload[f.key] = v;
    });
    if (payload.base_price == null) payload.base_price = 0; // NOT NULL
    if (isNew) {
      payload.active = 1;
      if (t.scoped) payload.solution = state.solution;
      if (t.injectOnCreate) Object.assign(payload, t.injectOnCreate);
    }
    return { payload, missing };
  }

  function changed(r) {
    if (r.isNew) return true;
    const t = current();
    return JSON.stringify(payloadOf(t, r.form, false).payload) !== JSON.stringify(payloadOf(t, toForm(t, r.orig), false).payload);
  }

  async function save() {
    const t = current();
    const creates = rows.filter((r) => r.isNew);
    const updates = rows.filter((r) => !r.isNew && changed(r));
    if (!creates.length && !updates.length && !deleted.length) return toast('변경된 내용이 없습니다.', 'ok');
    for (const r of [...creates, ...updates]) {
      const { missing } = payloadOf(t, r.form, r.isNew);
      if (missing) return toast(`필수 항목을 확인하세요: ${missing}`, 'err');
    }
    const codes = rows.map((r) => String(r.form.code ?? '').trim()).filter(Boolean);
    const dup = codes.find((v, i) => codes.indexOf(v) !== i);
    if (dup) return toast(`코드가 겹칩니다: ${dup}`, 'err');
    if (deleted.length && !(await confirmModal({
      title: '사용 중지',
      message: `행삭제한 ${deleted.length}건은 사용 중지됩니다. 저장하시겠습니까?`,
      okLabel: '저장', danger: true,
    }))) return;
    let done = 0;
    try {
      const io = t.api || masterApi(t.type);
      for (const o of deleted) { await io.remove(o.id); done++; }
      for (const r of creates) { await io.create(payloadOf(t, r.form, true).payload); done++; }
      for (const r of updates) { await io.update(r.orig.id, payloadOf(t, r.form, false).payload); done++; }
      toast(`저장되었습니다. (${done}건)`, 'ok');
      store.master = null; // 견적 작성 화면이 새 단가를 다시 받게
    } catch (err) {
      toast(`${done}건 저장 후 실패: ${err.message}`, 'err');
    }
    load();
  }

  // ── SaaS: 버전 → 정책 기본정보 → 서비스(S2C · S2P …) → 서비스마다 인원 · 건수 구간 (구간 월 금액) ─────
  // 서비스 = 이 솔루션의 SaaS 구간형 품목(sq_price_items: deployment SAAS · pricing_type BAND · 월).
  // 구간은 그 품목의 variants 에 key USER(인원) / COUNT(건수)로 둔다. 끝을 비우면 '이상'(마지막 구간).
  // 정책 기본정보(서비스구분 · 기본 제공 기능 · 사용자당 가격 · 셋업비용 · 옵션 기능 …)는 버전 이력(V7 sq_price_policy_versions)에만 있다.
  // [저장] 할 때마다 버전 번호 · 변경 내용을 받아 정책 전체(기본정보 · 서비스 · 구간)를 새 버전으로 남긴다 — 이력에서 지난 버전을 본다.
  // 셋업비 · 옵션 같은 고정 금액 SaaS 품목은 '전체 품목' 탭에서 고친다.
  const RANGE_KINDS = [['USER', '인원 구간', '인'], ['COUNT', '건수 구간', '건']];
  // 처음 만드는 정책의 기본정보 항목(실측: 전자구매 SaaS 가격정책_202603) — 값은 비어 있다
  const INFO_ROWS = [['서비스구분'], ['기본 제공 기능'], ['특별 제공 기능'], ['가격정책'], ['사용자당 가격'], ['최소가격'], ['셋업비용'],
    ['Poa-BiA 비용(인터페이스 모듈)'], ['독립인프라 비용(서버 or DBMS)'], ['유지보수비용'], ['약정기간'], ['내부시스템연계'],
    ['옵션 기능', '1. 협력사평가'], ['옵션 기능', '2. 예산관리'], ['옵션 기능', '3. 품질모듈'], ['옵션 기능', '4. 재고관리모듈']];
  let saas = null; // { services, deleted, pick, info: { rows }, infoBase, policy: { current, history } }
  const toNum = (v) => (v === '' || v == null ? null : Number(v));
  const svcForm = (it) => ({ code: it.code || '', name: it.name || '', unit: it.unit || '', base_price: toNum(it.base_price), sort: toNum(it.sort) });
  const rangeOf = (svc) => JSON.stringify(RANGE_KINDS.map(([k]) => svc.lists[k].map((r) => [r.min, r.max, r.price])));
  const svcChanged = (svc) => svc.isNew || JSON.stringify(svc.form) !== JSON.stringify(svcForm(svc.orig)) || rangeOf(svc) !== svc.base;
  const infoJson = () => JSON.stringify(saas.info.rows.map((r) => [r.label, r.sub, r.values]));
  const saasDirty = () => !!saas && (saas.deleted.length > 0 || saas.services.some(svcChanged) || infoJson() !== saas.infoBase);
  const shortName = (svc) => String(svc.form.name || svc.form.code || '새 서비스').replace(/\s*서비스\s*이용료$/, '');
  const when = (v) => String(v || '').replace('T', ' ').slice(0, 16);

  async function paintSaas() {
    saas = null;
    pane.appendChild(h('div', { class: 'ss-edithead', style: 'margin-top:16px' }, h('div', { class: 'ss-edithead__fields' }),
      h('div', { class: 'ss-actions' }, h('button', { class: 'ss-btn ss-btn--save', onclick: saveSaas }, '저장'))));
    const body = h('div', { style: 'margin-top:12px' });
    pane.appendChild(body);
    body.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '불러오는 중...'));
    let policy;
    try {
      const [r, p] = await Promise.all([api.pricing(state.solution, 'SAAS'), api.pricePolicy(state.solution, 'SAAS')]);
      policy = p;
      const services = (r.items || []).filter((x) => x.pricing_type === 'BAND').map((it) => {
        const lists = { USER: [], COUNT: [] };
        for (const v of it.variants || []) {
          (v.key === 'COUNT' ? lists.COUNT : lists.USER).push({ min: toNum(v.min_qty), max: toNum(v.max_qty), price: toNum(v.price), checked: false });
        }
        const svc = { orig: it, form: svcForm(it), isNew: false, checked: false, lists };
        svc.base = rangeOf(svc);
        return svc;
      });
      const saved = policy.current && policy.current.content && policy.current.content.info;
      const rows = saved && Array.isArray(saved.rows) ? saved.rows.map((x) => ({ label: x.label || '', sub: x.sub || '', values: { ...(x.values || {}) }, checked: false }))
        : INFO_ROWS.map(([label, sub]) => ({ label, sub: sub || '', values: {}, checked: false }));
      saas = { services, deleted: [], pick: services[0] || null, info: { rows }, policy };
      saas.infoBase = infoJson();
    } catch (err) {
      clear(body).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, err.message));
      return;
    }
    saas.body = body;
    paintSaasBody();
  }

  function paintSaasBody() {
    const body = clear(saas.body);
    body.appendChild(versionBar());
    body.appendChild(infoCard());
    body.appendChild(serviceCard());
    if (!saas.pick) return;
    const box = h('div', { style: 'display:flex;flex-wrap:wrap;gap:16px;margin-top:16px;align-items:flex-start' });
    for (const [k, label, unit] of RANGE_KINDS) box.appendChild(rangeCard(saas.pick, k, label, unit));
    body.appendChild(box);
  }

  // 버전 줄 — 지금 버전 · 최종 수정 일시 · 수정한 사람 · 변경 내용 + [이력]
  function versionBar() {
    const cur = saas.policy.current;
    return h('div', { class: 'ss-detailbar', style: 'margin-top:0;background:#F8FAFC;border:1px solid #E7EAF0;padding:8px 12px' },
      h('span', { style: 'font-size:13px;font-weight:600;color:var(--ss-primary)' }, cur ? `현재 버전 ${cur.version}` : '저장된 버전 없음'),
      cur ? h('span', { style: 'font-size:12px;color:var(--ss-ink-2);margin-left:12px' },
        `최종 수정 ${when(cur.created_at)} · ${cur.created_by_name || '-'}${cur.note ? ' · ' + cur.note : ''}`)
        : h('span', { class: 'ss-detailbar__note' }, '저장하면 v1.0 으로 기록됩니다.'),
      h('div', { class: 'ss-detailbar__spacer' }),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: openHistory }, `이력 (${saas.policy.history.length})`));
  }

  // 정책 기본정보 — 행: 항목 · 세부 / 열: 서비스. 칸은 테두리 없는 여러 줄 입력(표처럼 읽히고, 눌러서 고친다)
  function infoCard() {
    const cols = saas.services;
    const area = (value, onInput, style = '') => {
      const ta = h('textarea', { class: 'ss-cellinput', rows: Math.max(1, String(value || '').split('\n').length),
        style: `height:auto;resize:none;border:0;background:transparent;line-height:1.5;padding:4px 6px;${style}`,
        oninput: (e) => { onInput(e.target.value); e.target.rows = Math.max(1, e.target.value.split('\n').length); } });
      ta.value = value || '';
      return h('td', { class: 'ss-cell--input' }, ta);
    };
    const widths = [60, 190, 140, ...cols.map(() => 300)];
    const tbody = h('tbody');
    saas.info.rows.forEach((r, i) => {
      const same = i > 0 && r.label && r.label === saas.info.rows[i - 1].label; // 같은 항목이 이어지면 이름을 흐리게
      tbody.appendChild(h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })),
        area(r.label, (v) => { r.label = v; }, `font-weight:600;background:#F8FAFC;${same ? 'color:#B6BDC8' : ''}`),
        area(r.sub, (v) => { r.sub = v; }, 'background:#F8FAFC'),
        ...cols.map((svc) => area(r.values[svc.form.code], (v) => { r.values[svc.form.code] = v; }, 'text-align:center'))));
    });
    return h('div', { style: 'margin-top:16px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ SaaS 정책 기본정보'),
        h('span', { class: 'ss-detailbar__note' }, '칸을 눌러 고칩니다. 줄바꿈은 Enter.'),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => { saas.info.rows.push({ label: '', sub: '', values: {}, checked: false }); paintSaasBody(); } }, '행추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          if (!saas.info.rows.some((r) => r.checked)) return toast('삭제할 행을 선택하세요.', 'err');
          saas.info.rows = saas.info.rows.filter((r) => !r.checked);
          paintSaasBody();
        } }, '행삭제')),
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;width:fit-content;max-width:100%;overflow:auto' },
        h('table', { class: 'ss-grid ss-grid--sized', style: `width:${widths.reduce((x, w) => x + w, 0)}px` },
          h('colgroup', {}, ...widths.map((w) => h('col', { style: `width:${w}px` }))),
          h('thead', {}, h('tr', {}, h('th', {}, '선택'), h('th', {}, '항목'), h('th', {}, '세부'),
            ...cols.map((svc) => h('th', {}, shortName(svc))))),
          tbody)));
  }

  // 서비스 표 — 코드 · 서비스. 이미 있는 서비스의 코드는 템플릿 · 견적이 참조하므로 잠근다. 행을 누르면 아래에 그 서비스의 구간표
  function serviceCard() {
    const tbody = h('tbody');
    const cols = [['선택', 60], ['코드', 190], ['서비스', 260]];
    const txt = (svc, key, attrs = {}) => h('td', { class: 'ss-cell--input' }, h('input', { class: 'ss-cellinput', 'aria-label': key, value: svc.form[key] ?? '', ...attrs,
      onclick: (e) => e.stopPropagation(), oninput: (e) => { svc.form[key] = e.target.value; } }));
    if (!saas.services.length) tbody.appendChild(h('tr', {}, h('td', { colspan: cols.length, class: 'ss-cell--empty' }, '서비스가 없습니다. 행추가로 넣으세요 (예: S2C, S2P).')));
    for (const svc of saas.services) {
      tbody.appendChild(h('tr', {
        class: (svc === saas.pick ? 'is-selected' : '') + (svc.isNew ? ' is-new' : ''), style: 'cursor:pointer',
        title: '눌러서 이 서비스의 구간표 보기', onclick: () => { saas.pick = svc; paintSaasBody(); },
      },
      h('td', {}, h('input', { type: 'checkbox', checked: svc.checked, 'aria-label': '선택', onclick: (e) => e.stopPropagation(), onchange: (e) => { svc.checked = e.target.checked; } })),
      svc.isNew ? txt(svc, 'code', { style: 'text-align:center' }) : h('td', { class: 'ss-cell--link', style: 'text-align:center', title: '템플릿이 참조하는 코드라 고칠 수 없습니다' }, svc.form.code),
      txt(svc, 'name')));
    }
    return h('div', { style: 'margin-top:16px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ 서비스'),
        h('span', { class: 'ss-detailbar__note' }, '서비스를 누르면 아래에 그 서비스의 인원 · 건수 구간표가 나옵니다. 구간 금액은 그 구간일 때의 월 사용료입니다.'),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          const svc = { orig: null, form: { code: '', name: '', unit: 'User/월', base_price: null, sort: saas.services.length + 1 },
            isNew: true, checked: false, lists: { USER: [], COUNT: [] } };
          svc.base = rangeOf(svc);
          saas.services.push(svc);
          saas.pick = svc;
          paintSaasBody();
        } }, '행추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          const picked = saas.services.filter((x) => x.checked);
          if (!picked.length) return toast('삭제할 행을 선택하세요.', 'err');
          picked.forEach((x) => { if (!x.isNew) saas.deleted.push(x.orig); });
          saas.services = saas.services.filter((x) => !x.checked);
          if (!saas.services.includes(saas.pick)) saas.pick = saas.services[0] || null;
          paintSaasBody();
        } }, '행삭제')),
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;width:fit-content;max-width:100%' },
        h('table', { class: 'ss-grid ss-grid--sized', style: `width:${cols.reduce((x, [, w]) => x + w, 0)}px` },
          h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
          h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
          tbody)));
  }

  function rangeCard(svc, kind, label, unit) {
    const list = svc.lists[kind];
    const tbody = h('tbody');
    const paint = () => {
      clear(tbody);
      if (!list.length) { tbody.appendChild(h('tr', {}, h('td', { colspan: 5, class: 'ss-cell--empty' }, '구간이 없습니다. 행추가로 넣으세요.'))); return; }
      for (const r of list) {
        const show = h('td', { style: 'color:var(--ss-ink-3)' });
        const sync = () => { show.textContent = r.min == null ? '' : r.max == null ? `${r.min}${unit} 이상` : r.max === r.min ? `${r.min}${unit}` : `${r.min}~${r.max}${unit}`; };
        const cell = (key, money) => h('td', { class: 'ss-cell--input' },
          numInput(r[key], (v) => { r[key] = toNum(v); sync(); }, { class: 'ss-cellinput', 'aria-label': key, style: money ? 'text-align:right' : 'text-align:center' }, !money));
        sync();
        tbody.appendChild(h('tr', {},
          h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })),
          cell('min'), cell('max'), show, cell('price', true)));
      }
    };
    paint();
    const cols = [['선택', 60], [`시작 (${unit})`, 100], [`끝 (${unit})`, 100], ['구간', 130], ['월 금액 (원)', 160]];
    const width = cols.reduce((x, [, w]) => x + w, 0);
    return h('div', { style: `width:${width + 2}px;max-width:100%` },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, `▣ ${shortName(svc)} — ${label}`),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          // 다음 구간은 앞 구간 끝 + 1 에서 시작
          const last = list[list.length - 1];
          list.push({ min: last ? (last.max != null ? last.max + 1 : null) : 1, max: null, price: null, checked: false });
          paint();
        } }, '행추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          if (!list.some((r) => r.checked)) return toast('삭제할 행을 선택하세요.', 'err');
          const keep = list.filter((r) => !r.checked);
          list.length = 0;
          list.push(...keep);
          paint();
        } }, '행삭제')),
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;width:fit-content;max-width:100%' },
        h('table', { class: 'ss-grid ss-grid--sized', style: `width:${width}px` },
          h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
          h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
          tbody)));
  }

  // 구간 → variants. 잘못된 구간은 서비스 이름과 함께 알리고 null
  function variantsOf(svc) {
    const variants = [];
    const name = shortName(svc);
    for (const [k, label, unit] of RANGE_KINDS) {
      const list = [...svc.lists[k]].sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r.min == null || r.price == null) { toast(`${name} ${label} ${i + 1}번째: 시작과 월 금액을 넣으세요.`, 'err'); return null; }
        if (r.max != null && r.max < r.min) { toast(`${name} ${label} ${r.min}${unit}: 끝이 시작보다 작습니다.`, 'err'); return null; }
        const next = list[i + 1];
        if (next && (r.max == null || r.max >= next.min)) { toast(`${name} ${label}: ${r.min}${unit} 구간과 ${next.min}${unit} 구간이 겹칩니다.`, 'err'); return null; }
        variants.push({ key: k, label: r.max == null ? `${r.min}${unit} 이상` : r.max === r.min ? `${r.min}${unit}` : `${r.min}~${r.max}${unit}`,
          min_qty: r.min, max_qty: r.max, price: r.price, sort: variants.length });
      }
    }
    return variants;
  }

  // 다음 버전 번호 — v1.0 → v1.1. 형식이 다르면 v1.0 부터
  function nextVersion() {
    const m = String(saas.policy.current?.version || '').match(/^v?(\d+)\.(\d+)$/i);
    return m ? `v${m[1]}.${Number(m[2]) + 1}` : 'v1.0';
  }

  // 정책 전체 사본 — 버전 이력에 남긴다
  const policyContent = () => ({
    info: {
      columns: saas.services.map((svc) => ({ code: svc.form.code, label: shortName(svc) })),
      rows: saas.info.rows.map((r) => ({ label: r.label, sub: r.sub,
        values: Object.fromEntries(saas.services.map((svc) => [svc.form.code, r.values[svc.form.code] || ''])) })),
    },
    services: saas.services.map((svc) => ({ code: svc.form.code, name: svc.form.name, unit: svc.form.unit,
      ranges: Object.fromEntries(RANGE_KINDS.map(([k]) => [k, [...svc.lists[k]].sort((a, b) => a.min - b.min).map((r) => [r.min, r.max, r.price])])) })),
  });

  // 버전 번호 · 변경 내용을 받는다 — 저장하면 resolve({ version, note }), 취소하면 null
  function askVersion() {
    return new Promise((resolve) => {
      const ver = h('input', { class: 'ss-input', value: nextVersion(), style: 'width:120px' });
      const note = h('input', { class: 'ss-input', placeholder: 'S2C 건수 구간 추가', style: 'flex:1' });
      const m = openModal({
        title: '가격정책 저장 — 새 버전',
        body: h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:460px' },
          h('div', { style: 'font-size:12px;color:var(--ss-ink-3)' },
            `지금 버전: ${saas.policy.current ? saas.policy.current.version : '없음'} — 저장하면 정책 전체가 새 버전으로 이력에 남습니다.`),
          h('label', { style: 'display:flex;gap:8px;align-items:center;font-size:13px' }, h('span', { style: 'width:70px' }, '버전'), ver),
          h('label', { style: 'display:flex;gap:8px;align-items:center;font-size:13px' }, h('span', { style: 'width:70px' }, '변경 내용'), note)),
        footer: [
          h('button', { class: 'btn', onclick: () => { m.close(); resolve(null); } }, '취소'),
          h('button', { class: 'btn btn-primary', onclick: () => {
            const v = ver.value.trim();
            if (!v) return toast('버전을 넣으세요.', 'err');
            if (saas.policy.history.some((x) => x.version === v)) return toast(`${v} 버전이 이미 있습니다.`, 'err');
            m.close();
            resolve({ version: v, note: note.value.trim() });
          } }, '저장'),
        ],
      });
      ver.focus();
    });
  }

  async function saveSaas() {
    if (!saas) return;
    if (!saasDirty()) return toast('변경된 내용이 없습니다.', 'ok');
    const todo = saas.services.filter(svcChanged);
    const codes = saas.services.map((x) => String(x.form.code || '').trim());
    for (const svc of todo) {
      if (!String(svc.form.code || '').trim() || !String(svc.form.name || '').trim()) {
        saas.pick = svc; paintSaasBody();
        return toast('서비스의 코드와 서비스명을 넣으세요.', 'err');
      }
    }
    const dup = codes.find((v, i) => v && codes.indexOf(v) !== i);
    if (dup) return toast(`코드가 겹칩니다: ${dup}`, 'err');
    const plan = [];
    for (const svc of todo) {
      const variants = variantsOf(svc);
      if (!variants) { saas.pick = svc; paintSaasBody(); return; }
      plan.push([svc, variants]);
    }
    if (saas.deleted.length && !(await confirmModal({
      title: '사용 중지', message: `행삭제한 서비스 ${saas.deleted.length}건은 사용 중지됩니다. 저장하시겠습니까?`, okLabel: '계속', danger: true,
    }))) return;
    const ver = await askVersion();
    if (!ver) return;
    let done = 0;
    try {
      for (const o of saas.deleted) { await api.deletePriceItem(o.id); done++; }
      for (const [svc, variants] of plan) {
        const f = { name: svc.form.name.trim(), unit: svc.form.unit?.trim() || null, base_price: svc.form.base_price ?? 0, sort: svc.form.sort ?? 0, variants };
        if (svc.isNew) {
          await api.createPriceItem({ ...f, solution: state.solution, deployment: 'SAAS', code: svc.form.code.trim(),
            category: '서비스이용료', pricing_type: 'BAND', recurring: 1, qty_default: 1 });
        } else {
          await api.updatePriceItem(svc.orig.id, f);
        }
        done++;
      }
      await api.savePricePolicy({ solution: state.solution, deployment: 'SAAS', version: ver.version, note: ver.note, content: policyContent() });
      toast(`${ver.version} 으로 저장되었습니다.`, 'ok');
      store.master = null;
    } catch (err) {
      toast(`${done}건 저장 후 실패: ${err.message}`, 'err');
    }
    refresh();
  }

  // 이력 — 버전 목록(최근 순). [보기] 를 누르면 그 버전의 기본정보 · 구간을 그대로 보여 준다(읽기 전용)
  function openHistory() {
    const list = saas.policy.history;
    const view = h('div', { style: 'margin-top:12px' });
    const rows = list.map((v) => h('tr', {},
      h('td', { style: 'text-align:center;font-weight:600' }, v.version),
      h('td', { style: 'text-align:center' }, when(v.created_at)),
      h('td', { style: 'text-align:center' }, v.created_by_name || '-'),
      h('td', {}, v.note || ''),
      h('td', {}, h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => showVersion(v.id, view) }, '보기'))));
    const m = openModal({
      title: `가격정책 이력 — ${solName()} SaaS`,
      body: h('div', { style: 'max-height:70vh;overflow:auto' },
        list.length ? h('table', { class: 'ss-grid' },
          h('thead', {}, h('tr', {}, ...['버전', '수정일시', '수정자', '변경 내용', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...rows))
          : h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '아직 저장된 버전이 없습니다.'),
        view),
      footer: [h('button', { class: 'btn btn-primary', onclick: () => m.close() }, '닫기')],
    });
    m.back.querySelector('.modal').style.width = '1100px';
  }

  async function showVersion(id, view) {
    clear(view).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:12px' }, '불러오는 중...'));
    try {
      const { version: v } = await api.pricePolicyVersion(id);
      const c = v.content || {};
      const cols = (c.info && c.info.columns) || [];
      const lines = (t) => String(t || '').split('\n').flatMap((x, i) => (i ? [h('br'), x] : [x]));
      clear(view).appendChild(h('div', { style: 'font-size:13px;font-weight:600;color:var(--ss-primary);margin-bottom:6px' },
        `${v.version} · ${when(v.created_at)} · ${v.created_by_name || '-'}${v.note ? ' · ' + v.note : ''}`));
      view.appendChild(h('table', { class: 'ss-grid' },
        h('thead', {}, h('tr', {}, h('th', {}, '항목'), h('th', {}, '세부'), ...cols.map((x) => h('th', {}, x.label)))),
        h('tbody', {}, ...((c.info && c.info.rows) || []).map((r) => h('tr', {},
          h('td', { style: 'font-weight:600' }, r.label), h('td', {}, r.sub),
          ...cols.map((x) => h('td', { style: 'text-align:center' }, ...lines(r.values && r.values[x.code]))))))));
      for (const svc of c.services || []) {
        const box = h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;margin-top:12px' });
        for (const [k, label, unit] of RANGE_KINDS) {
          const rs = (svc.ranges && svc.ranges[k]) || [];
          box.appendChild(h('div', {},
            h('div', { style: 'font-size:12px;font-weight:600;margin-bottom:4px' }, `${String(svc.name || svc.code).replace(/\s*서비스\s*이용료$/, '')} — ${label}`),
            rs.length ? h('table', { class: 'ss-grid', style: 'width:auto' },
              h('thead', {}, h('tr', {}, h('th', {}, '구간'), h('th', {}, '월 금액 (원)'))),
              h('tbody', {}, ...rs.map(([a, b, p]) => h('tr', {},
                h('td', { style: 'text-align:center' }, b == null ? `${a}${unit} 이상` : a === b ? `${a}${unit}` : `${a}~${b}${unit}`),
                h('td', { style: 'text-align:right' }, won(p))))))
              : h('div', { style: 'font-size:12px;color:var(--ss-ink-3)' }, '없음')));
        }
        view.appendChild(box);
      }
    } catch (err) {
      clear(view).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:12px' }, err.message));
    }
  }

  refresh();
}

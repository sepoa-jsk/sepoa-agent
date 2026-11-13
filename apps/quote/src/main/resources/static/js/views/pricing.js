import { api } from '../api.js';
import { store } from '../app.js';
import { h, toast, clear, confirmModal, resizableColumns, numInput, openModal, won, comma, cleanNum } from '../ui.js';

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

// On-premise 역할 탭에 모으는 구분 — 그 밖의 구분(솔루션 · 3rd party 등)은 모듈 탭
const ROLE_CATEGORY = '개발인건비';
const DATASVC_CATEGORY = '데이터서비스';
const MAINT_CATEGORY = '유지보수'; // 온프레미스 유지보수(솔루션 · 운영), 2026-11-04 // 데이터서비스 컴포넌트(경비관리 온프레미스, 2026-11-04)
// On-premise 탭 — 구축형(공통 · 일시불 · 분납) 품목만
const onpremApi = {
  list: (st) => api.pricing(st.solution).then((r) => (r.items || []).filter((x) => String(x.deployment).startsWith('ONPREM'))),
  create: (row) => api.createPriceItem(row),
  update: (id, row) => api.updatePriceItem(id, row),
  remove: (id) => api.deletePriceItem(id),
};

const TABS = [
  // SaaS 안에서 기본정보 | 가격 하위 탭으로 나눈다(2026-10-30 사용자 요청) — 버전 이력은 둘이 함께 쓴다
  { key: 'saas', label: 'SaaS', custom: true },
  {
    key: 'onprem', label: 'On-premise', api: onpremApi, scoped: true,
    // 하위 탭 — 모듈(솔루션 · 3rd party) | 투입인력(개발인건비 — PM · 개발 · 기술지원). 구분(category)으로 나눈다(2026-11-02 사용자 요청)
    sub: {
      module: {
        label: '모듈',
        note: '구축형 견적의 모듈과 금액입니다. 견적 작성 · 템플릿이 이 금액을 기준단가로 씁니다. 이미 있는 모듈의 코드는 고칠 수 없습니다.',
        filter: (r) => r.category !== ROLE_CATEGORY && r.category !== DATASVC_CATEGORY && r.category !== MAINT_CATEGORY,
        fields: [
          { key: 'code', label: '코드', type: 'text', mono: true, required: true, unique: true, lockOnEdit: true, width: 170 },
          // 구축형태 칸은 두지 않는다(2026-11-02 사용자 요청) — 모듈은 구축형(공통) 하나로 쓴다
          { key: 'category', label: '구분', type: 'text', width: 150 },
          { key: 'name', label: '모듈', type: 'text', required: true, width: 220 },
          { key: 'spec', label: '세부기능', type: 'text', width: 320 },
          { key: 'base_price', label: '금액 (원)', type: 'money', width: 150 },
          { key: 'sort', label: '정렬', type: 'number', width: 70 },
        ],
        defaults: () => ({ category: '솔루션' }),
        injectOnCreate: { deployment: 'ONPREM', pricing_type: 'FIXED', qty_default: 1 },
      },
      // 데이터서비스 — 경비관리 컴포넌트(월 사용료, 회사 수 · 건수 구간). 구분 '데이터서비스'(2026-11-04 사용자 요청: 모듈 옆 탭)
      datasvc: {
        label: '데이터서비스',
        note: '견적서 데이터서비스 월사용료 블록에 들어가는 컴포넌트입니다. 금액은 구간(회사 수 · 건수)의 첫 구간 월 금액입니다.',
        filter: (r) => r.category === DATASVC_CATEGORY,
        ranges: true, // 행을 누르면 아래에 그 컴포넌트의 구간표(회사 수 · 건수)
        fields: [
          { key: 'code', label: '코드', type: 'text', mono: true, required: true, unique: true, lockOnEdit: true, width: 170 },
          { key: 'name', label: '컴포넌트', type: 'text', required: true, width: 240 },
          { key: 'spec', label: '세부기능', type: 'text', width: 380 },
          { key: 'unit', label: '구간 단위', type: 'text', width: 90 },
          { key: 'base_price', label: '시작 금액 (월)', type: 'money', width: 150 },
          { key: 'sort', label: '정렬', type: 'number', width: 70 },
        ],
        injectOnCreate: { deployment: 'ONPREM_LUMP', category: DATASVC_CATEGORY, pricing_type: 'BAND', recurring: 1, qty_default: 1 },
      },
      // 유지보수 — 솔루션유지보수(요율 %/년: 솔루션 제안금액 합계 × 요율 ÷ 12) · 운영유지보수(1 M/D 단가: 공수 M/M × 20일 × 단가).
      //   견적 작성에서 유지보수를 넣으면 이 값으로 월 금액을 계산한다(2026-11-04 사용자 요청)
      maint: {
        label: '유지보수',
        filter: (r) => r.category === MAINT_CATEGORY,
        fields: [
          { key: 'code', label: '코드', type: 'text', mono: true, required: true, unique: true, lockOnEdit: true, width: 190 },
          { key: 'name', label: '유지보수', type: 'text', required: true, width: 180 },
          { key: 'spec', label: '세부기능', type: 'text', width: 300 },
          { key: 'unit', label: '단위', type: 'text', width: 90 },
          { key: 'base_price', label: '요율 · 단가', type: 'money', width: 150 },
          { key: 'sort', label: '정렬', type: 'number', width: 70 },
        ],
        injectOnCreate: { deployment: 'ONPREM', category: MAINT_CATEGORY, pricing_type: 'FIXED', recurring: 1, qty_default: 1 },
      },
      role: {
        label: '투입인력',
        note: '구축형 견적의 투입인력(개발인건비)과 1 M/M 금액입니다. 이미 있는 투입인력의 코드는 고칠 수 없습니다.',
        filter: (r) => r.category === ROLE_CATEGORY,
        fields: [
          { key: 'code', label: '코드', type: 'text', mono: true, required: true, unique: true, lockOnEdit: true, width: 170 },
          // 구축형태 칸은 두지 않는다(2026-11-02 사용자 요청) — 투입인력은 구축형(공통) 하나로 쓴다
          { key: 'name', label: '투입인력', type: 'text', required: true, width: 220 },
          { key: 'spec', label: '설명', type: 'text', width: 320 },
          { key: 'base_price', label: '금액 1 M/M (원)', type: 'money', width: 150 },
          { key: 'sort', label: '정렬', type: 'number', width: 70 },
        ],
        // 투입인력 탭에서 만든 행은 구축형(공통) · 구분 '개발인건비' · 공수(M/M) 방식으로
        injectOnCreate: { deployment: 'ONPREM', category: ROLE_CATEGORY, pricing_type: 'MM', unit: 'M/M', qty_default: 1 },
      },
    },
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

  const state = { tab: TABS[0].key, sub: 'module', solution: defaultSolution, deployment: '' };
  const solName = () => solutions.find((x) => x.code === state.solution)?.name || state.solution;
  let rows = [];     // [{ orig, form, isNew, checked, seq }]
  let deleted = [];  // 행삭제한 기존 행 — 저장할 때 사용 중지(active=0)
  let sort = { key: null, dir: null };
  let seq = 0;
  let tbody, headCells = [];
  let rangeBox = null, pickRow = null; // 데이터서비스 — 구간표 자리 · 고른 행

  // 하위 탭이 있는 탭(On-premise)은 고른 하위 탭의 칸 · 안내 · 거르기를 합쳐 쓴다
  const current = () => { const t = TABS.find((x) => x.key === state.tab); return t.sub ? { ...t, ...t.sub[state.sub] } : t; };
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

    // 하위 탭(On-premise: 모듈 | 투입인력) — 바꾸면 그 구분의 행만 다시 불러온다.
    // [저장]은 SaaS 탭처럼 하위 탭 위에 둔다(2026-11-02 사용자 요청). 행추가 · 행삭제는 표 위 그대로
    if (t.sub) {
      pane.appendChild(h('div', { class: 'ss-edithead', style: 'margin-top:16px' }, h('div', { class: 'ss-edithead__fields' }),
        h('div', { class: 'ss-actions' }, h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));
      pane.appendChild(h('div', { class: 'ss-tabs', style: 'margin-top:12px' }, ...Object.entries(t.sub).map(([k, x]) =>
        h('div', { class: 'ss-tabs__tab' + (k === state.sub ? ' ss-tabs__tab--active' : ''), onclick: () => {
          if (k === state.sub) return;
          warnUnsaved();
          state.sub = k;
          refresh();
        } }, x.label))));
    }
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
        t.sub ? null : h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));
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
    pane.appendChild(h('div', { class: 'ss-gridwrap' + (t.ranges ? '' : ' ss-gridwrap--fill'), style: t.note ? 'margin-top:8px' : 'margin-top:12px' }, table));
    rangeBox = t.ranges ? pane.appendChild(h('div', { style: 'margin-top:16px' })) : null;
    resizableColumns(table, `quote2:pricing-cols:${t.key}${t.sub ? '-' + state.sub : ''}`);
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
      rows = (list || []).filter((r) => r.active && (!t.filter || t.filter(r))).map((r) => ({ orig: r, form: toForm(t, r), isNew: false, checked: false, seq: seq++ }));
      if (t.ranges) { rows.forEach((r) => { r.ranges = rangesOf(r.orig.variants); r.rangeBase = JSON.stringify(r.ranges); }); pickRow = rows[0] || null; }
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
    const row = { orig: null, form, isNew: true, checked: false, seq: seq++ };
    if (t.ranges) { row.ranges = { kind: 'COMPANY', list: [] }; row.rangeBase = JSON.stringify(row.ranges); pickRow = row; }
    rows.push(row);
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
      const tr = h('tr', { class: [r.isNew ? 'is-new' : '', t.ranges && r === pickRow ? 'is-selected' : ''].join(' ').trim() || null,
        style: t.ranges ? 'cursor:pointer' : null, onclick: t.ranges ? () => { if (pickRow !== r) { pickRow = r; paintRows(); } } : null },
        h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })));
      t.fields.forEach((f) => tr.appendChild(cellEl(f, r)));
      tbody.appendChild(tr);
    });
    if (t.ranges) paintRange();
  }

  // ── 데이터서비스 구간표(2026-11-04 사용자 요청) — 컴포넌트마다 기준(회사 수 · 건수)과 구간 월 금액.
  //   끝을 비운 마지막 구간에는 '추가 1단위당 금액'(V20 step_price) — 예) 6社 이상 650,000 + 1社당 50,000
  const DS_KINDS = [['COMPANY', '회사 수', '社'], ['COUNT', '건수', '건']];
  const dsUnit = (kind) => (DS_KINDS.find(([k]) => k === kind) || DS_KINDS[0])[2];
  function rangesOf(variants) {
    const vs = [...(variants || [])].sort((a, b) => Number(a.min_qty) - Number(b.min_qty));
    const kind = vs.length && vs[0].key === 'COUNT' ? 'COUNT' : 'COMPANY';
    return { kind, list: vs.map((v) => ({ min: toNum(v.min_qty), max: toNum(v.max_qty), price: toNum(v.price), step: toNum(v.step_price), checked: false })) };
  }
  const rangeLabel = (r, u) => (r.min == null ? '' : r.max == null ? `${r.min.toLocaleString('ko-KR')}${u} 이상` : r.max === r.min
    ? `${r.min.toLocaleString('ko-KR')}${u}` : `${r.min.toLocaleString('ko-KR')}~${r.max.toLocaleString('ko-KR')}${u}`);
  const rangeJson = (rg) => JSON.stringify({ kind: rg.kind, list: rg.list.map(({ min, max, price, step }) => ({ min, max, price, step })) });
  function paintRange() {
    if (!rangeBox) return;
    clear(rangeBox);
    const r = pickRow;
    if (!r) return;
    const rg = r.ranges;
    const u = dsUnit(rg.kind);
    const tb = h('tbody');
    const paint = () => {
      clear(tb);
      if (!rg.list.length) { tb.appendChild(h('tr', {}, h('td', { colspan: 6, class: 'ss-cell--empty' }, '구간이 없습니다. 행추가로 넣으세요.'))); return; }
      for (const x of rg.list) {
        const show = h('td', { style: 'color:var(--ss-ink-3)' }, rangeLabel(x, u));
        const cell = (key, money) => {
          const inp = numInput(x[key], (v) => { x[key] = toNum(v); show.textContent = rangeLabel(x, u); }, { class: 'ss-cellinput', 'aria-label': key,
            style: money ? 'text-align:right' : 'text-align:center' }, !money);
          // 끝을 비우거나 채우면 '추가 1단위당' 칸이 바뀐다 — 칸을 벗어날 때 다시 그린다(입력 중에는 그대로)
          if (key === 'max') inp.addEventListener('change', () => paint());
          return h('td', { class: 'ss-cell--input' }, inp);
        };
        // 추가 1단위당 금액은 끝을 비운 구간(○○ 이상)에만
        const stepTd = x.max == null ? cell('step', true) : h('td', { style: 'text-align:center;color:var(--ss-ink-3)' }, '-');
        tb.appendChild(h('tr', {},
          h('td', {}, h('input', { type: 'checkbox', checked: x.checked, 'aria-label': '선택', onchange: (e) => { x.checked = e.target.checked; } })),
          cell('min'), cell('max'), show, cell('price', true), stepTd));
      }
    };
    paint();
    const kindSel = h('select', { class: 'ss-select', style: 'width:110px', 'aria-label': '구간 기준',
      onchange: (e) => { rg.kind = e.target.value; paintRange(); } }, ...DS_KINDS.map(([k, l]) => h('option', { value: k, selected: k === rg.kind }, l)));
    const cols = [['선택', 60], [`시작 (${u})`, 110], [`끝 (${u})`, 110], ['구간', 150], ['월 금액 (원)', 150], [`추가 1${u}당 (원)`, 150]];
    rangeBox.appendChild(h('div', {},
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, `▣ ${r.form.name || r.form.code || '새 컴포넌트'} — 구간`),
        h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12.5px;margin-left:12px' }, '구간 기준', kindSel),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          const last = rg.list[rg.list.length - 1];
          rg.list.push({ min: last ? (last.max != null ? last.max + 1 : null) : 1, max: null, price: null, step: null, checked: false });
          paint();
        } }, '행추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          if (!rg.list.some((x) => x.checked)) return toast('삭제할 행을 선택하세요.', 'err');
          rg.list = rg.list.filter((x) => !x.checked);
          paint();
        } }, '행삭제')),
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;width:fit-content;max-width:100%' },
        h('table', { class: 'ss-grid ss-grid--sized', style: `width:${cols.reduce((a, [, w]) => a + w, 0)}px` },
          h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
          h('thead', {}, h('tr', {}, ...cols.map(([t0], i) => h('th', i ? {} : { 'data-fixed': '' }, t0)))),
          tb))));
  }
  // 구간 → variants. 잘못된 구간은 컴포넌트 이름과 함께 알리고 null
  function dsVariants(r) {
    const rg = r.ranges;
    const u = dsUnit(rg.kind);
    const name = r.form.name || r.form.code;
    const list = [...rg.list].sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      if (x.min == null || x.price == null) { toast(`${name} 구간 ${i + 1}번째: 시작과 월 금액을 넣으세요.`, 'err'); return null; }
      if (x.max != null && x.max < x.min) { toast(`${name} ${x.min}${u}: 끝이 시작보다 작습니다.`, 'err'); return null; }
      const next = list[i + 1];
      if (next && (x.max == null || x.max >= next.min)) { toast(`${name}: ${x.min}${u} 구간과 ${next.min}${u} 구간이 겹칩니다.`, 'err'); return null; }
      out.push({ key: rg.kind, label: rangeLabel(x, u), min_qty: x.min, max_qty: x.max, rate: null, price: x.price,
        step_price: x.max == null && x.step ? x.step : null, sort: out.length });
    }
    return out;
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
    if (t.ranges && rangeJson(r.ranges) !== rangeJson(JSON.parse(r.rangeBase))) return true;
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
      // 데이터서비스 — 구간(variants)을 함께 보내고, 시작 금액은 첫 구간 금액으로 맞춘다
      const withRanges = (r, payload) => {
        if (!t.ranges) return payload;
        const variants = dsVariants(r);
        if (!variants) throw new Error('구간을 확인하세요');
        return { ...payload, variants, unit: dsUnit(r.ranges.kind), ...(variants.length ? { base_price: variants[0].price } : {}) };
      };
      for (const r of creates) { await io.create(withRanges(r, payloadOf(t, r.form, true).payload)); done++; }
      for (const r of updates) { await io.update(r.orig.id, withRanges(r, payloadOf(t, r.form, false).payload)); done++; }
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
  const INFO_ROWS = [['서비스구분'], ['기본 제공 기능'], ['특별 제공 기능'], ['가격정책'], ['사용자당 가격', '', 'money'], ['최소가격', '', 'money'],
    ['셋업비용', '', 'money'], ['Poa-BiA 비용(인터페이스 모듈)', '', 'money'], ['독립인프라 비용(서버 or DBMS)', '', 'money'], ['유지보수비용'], ['약정기간'],
    ['내부시스템연계'], ['옵션 기능', '1. 협력사평가', 'money'], ['옵션 기능', '2. 예산관리', 'money'], ['옵션 기능', '3. 품질모듈', 'money'],
    ['옵션 기능', '4. 재고관리모듈', 'money']];
  let saasPart = 'info'; // SaaS 하위 탭 — info | price | conds
  let saas = null; // { services, deleted, pick, info: { rows }, infoBase, policy: { current, history } }
  const toNum = (v) => (v === '' || v == null ? null : Number(v));
  const svcForm = (it) => ({ code: it.code || '', name: it.name || '', spec: it.spec || '', unit: it.unit || '', base_price: toNum(it.base_price), sort: toNum(it.sort) });
  const rangeOf = (svc) => JSON.stringify(RANGE_KINDS.map(([k]) => svc.lists[k].map((r) => [r.min, r.max, r.price])));
  const svcChanged = (svc) => svc.isNew || JSON.stringify(svc.form) !== JSON.stringify(svcForm(svc.orig)) || rangeOf(svc) !== svc.base;
  const infoJson = () => JSON.stringify(saas.info.rows.map((r) => [r.label, r.sub, r.desc, r.type, r.values]));
  // 행마다 상세 설명(desc) — 세부 항목이 무엇인지 쓰는 여러 줄 글. 서비스별 값이 아니라 그 행 하나에 하나(2026-10-30 사용자 요청)
  // 기본정보 항목은 분류 — 기본 / 부가 / 옵션 중 하나, 설명은 세부에 쓴다(2026-10-30 사용자 요청). 표는 이 순서로 묶어 보인다.
  // 예전 행(항목에 '서비스구분' · '셋업비용' 같은 이름)은 읽을 때 바꾼다: 그 이름은 세부로, 항목은 이름으로 정한 분류
  //   '옵션 기능' + '1. 협력사평가' → 옵션 + '1. 협력사평가' / 셋업 · Poa-BiA · 인프라 · 연계 · 유지보수 → 부가 / 나머지 → 기본
  const INFO_GROUPS = ['기본', '부가', '옵션'];
  const groupOrder = (g) => Math.max(0, INFO_GROUPS.indexOf(g));
  const normInfo = (x) => {
    const label = String(x.label || '').trim();
    const sub = String(x.sub || '').trim();
    if (INFO_GROUPS.includes(label)) return { ...x, label, sub };
    if (/옵션/.test(label)) return { ...x, label: '옵션', sub: sub || label };
    return { ...x, label: /셋업|Poa-BiA|인프라|연계|유지보수/i.test(label) ? '부가' : '기본', sub: [label, sub].filter(Boolean).join(' ') };
  };
  const sortInfo = (rows) => rows.map((r, i) => [r, i]).sort((a, b) => groupOrder(a[0].label) - groupOrder(b[0].label) || a[1] - b[1]).map(([r]) => r);
  // 기본정보 행 형식 — text(글자) | money(금액: 숫자만, 커서가 나가면 콤마). 정하지 않은 옛 행은 값이 모두 숫자면 금액
  const INFO_TYPES = [['text', '글자'], ['money', '금액']];
  const inferType = (values) => {
    const vs = Object.values(values || {}).map((v) => String(v ?? '').trim()).filter(Boolean);
    return vs.length && vs.every((v) => /^-?[\d,]+(\.\d+)?$/.test(v)) ? 'money' : 'text';
  };
  const moneyValues = (values) => Object.fromEntries(Object.entries(values || {}).map(([k, v]) => [k, cleanNum(v)]));
  // 견적조건은 가격정책에 두지 않는다 — 템플릿이 고른 견적조건 문구(기준정보 > 견적조건 문구)를 그대로 쓴다(2026-11-04 사용자 요청 — 이원화하지 않는다)
  // 모듈(2026-11-04 사용자 요청) — 서비스 이용료에 묶이는 기능 묶음. 견적 작성에서 체크로 골라 서비스 비용 블록의 줄이 된다.
  //   품목(sq_price_items, 분류 '모듈')에는 이름 · 세부기능 · 기준단가, 정책 내용(content.modules)에는 금액 방식과 서비스별 기본 포함
  //   금액 방식 — BUNDLE 서비스 이용료에 포함(금액 없음, 이용료 줄과 묶음) | PRICED 별도 금액(기준단가) | OPTION 옵션(금액 없음, 기본 미포함)
  const MODULE_CAT = '모듈';
  const MODULE_MODES = [['BUNDLE', '이용료에 포함'], ['PRICED', '별도 금액'], ['OPTION', '옵션(금액 없음)']];
  const modForm = (it) => ({ code: it.code || '', name: it.name || '', spec: it.spec || '', base_price: toNum(it.base_price), sort: toNum(it.sort) });
  const modJson = () => JSON.stringify(saas.modules.map((m) => [m.form, m.mode, [...m.services].sort()]));
  const modChanged = (m) => m.isNew || JSON.stringify(m.form) !== JSON.stringify(modForm(m.orig));
  const saasDirty = () => !!saas && (saas.deleted.length > 0 || saas.services.some(svcChanged) || infoJson() !== saas.infoBase
    || saas.modDeleted.length > 0 || modJson() !== saas.modBase);
  // 서비스 코드 채번(2026-11-03 사용자 요청) — 솔루션 접두어 + _SAAS_S + 두 자리 순번. 예) ESEAL_SAAS_S01 · PRO_SAAS_S03
  // 접두어는 기존 품목 코드와 같게(전자구매 PRO · 경비 EXP · 전자인장 ESEAL). 순번은 이 솔루션 서비스 중 가장 큰 번호 + 1
  const SVC_PREFIX = { PROCURE: 'PRO', EXPENSE: 'EXP', SEAL: 'ESEAL' };
  const nextSvcCode = () => {
    const pre = `${SVC_PREFIX[state.solution] || state.solution}_SAAS_S`;
    const used = saas.services.map((x) => String(x.form.code || '')).filter((c) => c.startsWith(pre)).map((c) => Number(c.slice(pre.length)) || 0);
    return pre + String(Math.max(0, ...used) + 1).padStart(2, '0');
  };
  // 모듈 코드 — 솔루션 접두어 + _SAAS_M + 두 자리 순번. 예) PRO_SAAS_M01
  const nextModCode = () => {
    const pre = `${SVC_PREFIX[state.solution] || state.solution}_SAAS_M`;
    const used = [...saas.modules.map((x) => x.form.code), ...saas.modDeleted.map((x) => x.code)].map((c) => String(c || ''))
      .filter((c) => c.startsWith(pre)).map((c) => Number(c.slice(pre.length)) || 0);
    return pre + String(Math.max(0, ...used) + 1).padStart(2, '0');
  };
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
      const rows = saved && Array.isArray(saved.rows) ? saved.rows.map((x) => {
        const type = x.type || inferType(x.values);
        const n = normInfo(x);
        return { label: n.label, sub: n.sub, desc: x.desc || '', type, values: type === 'money' ? moneyValues(x.values) : { ...(x.values || {}) }, checked: false };
      }) : INFO_ROWS.map(([label, sub, type]) => ({ ...normInfo({ label, sub }), desc: '', type: type || 'text', values: {}, checked: false }));
      const content = (policy.current && policy.current.content) || {};
      const modMeta = Object.fromEntries((content.modules || []).map((m) => [m.code, m]));
      const modules = (r.items || []).filter((x) => x.category === MODULE_CAT && x.pricing_type !== 'BAND').map((it) => {
        const meta = modMeta[it.code] || {};
        return { orig: it, form: modForm(it), isNew: false, checked: false,
          mode: MODULE_MODES.some(([k]) => k === meta.mode) ? meta.mode : 'BUNDLE', services: new Set(meta.services || []) };
      });
      saas = { services, deleted: [], pick: services[0] || null, info: { rows: sortInfo(rows) }, policy, modules, modDeleted: [] };
      saas.infoBase = infoJson();
      saas.modBase = modJson();
    } catch (err) {
      clear(body).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, err.message));
      return;
    }
    saas.body = body;
    paintSaasBody();
  }

  function paintSaasBody() {
    const body = clear(saas.body);
    // 하위 탭 — 기본정보(정책 표) | 가격(서비스 · 구간) | 견적조건(문장). 다시 불러오지 않고 그리기만 바꾼다(고친 내용은 그대로 남는다)
    body.appendChild(h('div', { class: 'ss-tabs', style: 'margin-bottom:12px' }, ...[['info', '기본정보'], ['price', '가격'], ['module', '모듈'], ['conds', '견적조건']].map(([k, label]) =>
      h('div', { class: 'ss-tabs__tab' + (saasPart === k ? ' ss-tabs__tab--active' : ''), onclick: () => { saasPart = k; paintSaasBody(); } }, label))));
    body.appendChild(versionBar());
    // 저장은 어느 하위 탭이든 정책 전체를 새 버전으로 남긴다
    if (saasPart === 'info') { body.appendChild(infoCard()); return; }
    if (saasPart === 'module') { body.appendChild(moduleCard()); return; }
    if (saasPart === 'conds') { body.appendChild(condsCard()); return; }
    body.appendChild(serviceCard());
    if (!saas.pick) return;
    const box = h('div', { style: 'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;margin-top:16px;align-items:start' }); // 인원 · 건수 50%씩
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
    // 서비스 칸(글자 형식)에 숫자만 넣으면 3자리 콤마로 보인다(2026-11-04 사용자 요청 — 2000000 → 2,000,000). 글자가 섞이면 그대로
    const commaText = (v) => (/^\s*\d[\d,]*\s*$/.test(String(v || '')) ? Number(String(v).replace(/[,\s]/g, '')).toLocaleString('ko-KR') : v);
    const area = (value, onInput, style = '', comma = false) => {
      const ta = h('textarea', { class: 'ss-cellinput', rows: Math.max(1, String(value || '').split('\n').length),
        style: `height:auto;resize:none;border:0;background:transparent;line-height:1.5;padding:4px 6px;${style}`,
        oninput: (e) => { onInput(e.target.value); e.target.rows = Math.max(1, e.target.value.split('\n').length); } });
      ta.value = (comma ? commaText(value) : value) || '';
      if (comma) ta.addEventListener('blur', () => { const v = commaText(ta.value); if (v !== ta.value) { ta.value = v; onInput(v); } });
      return h('td', { class: 'ss-cell--input' }, ta);
    };
    // 금액 칸 — 숫자만, 입력 중 콤마 없음, 커서가 나가면 콤마(다른 그리드와 같은 numInput). 금액은 오른쪽 정렬
    const money = (r, code) => h('td', { class: 'ss-cell--input' },
      numInput(r.values[code] ?? '', (v) => { r.values[code] = v; }, { class: 'ss-cellinput', 'aria-label': '금액', style: 'text-align:right;padding:4px 10px' }));
    const typeSel = (r) => h('td', { class: 'ss-cell--input' }, h('select', { class: 'ss-cellinput', 'aria-label': '형식',
      onchange: (e) => {
        r.type = e.target.value;
        if (r.type === 'money') {
          const bad = Object.values(r.values).filter((v) => String(v ?? '').trim() && !/^-?[\d,]+(\.\d+)?$/.test(String(v).trim()));
          if (bad.length) toast(`숫자가 아닌 글자는 빠집니다: ${bad.join(', ')}`, 'err');
          r.values = moneyValues(r.values);
        }
        paintSaasBody();
      } }, ...INFO_TYPES.map(([v, l]) => h('option', { value: v, selected: v === r.type }, l))));
    // 항목 = 분류(기본 / 부가 / 옵션) — 고르면 그 묶음으로 옮긴다. 같은 분류가 이어지면 흐리게
    const groupSel = (r, same) => h('td', { class: 'ss-cell--input' }, h('select', { class: 'ss-cellinput', 'aria-label': '항목',
      style: `text-align:center;font-weight:600;background:#F8FAFC;${same ? 'color:#B6BDC8' : ''}`,
      onchange: (e) => { r.label = e.target.value; saas.info.rows = sortInfo(saas.info.rows); paintSaasBody(); } },
      ...INFO_GROUPS.map((g) => h('option', { value: g, selected: g === r.label }, g))));
    const widths = [60, 90, 220, 320, 80, ...cols.map(() => 300)];
    const tbody = h('tbody');
    saas.info.rows.forEach((r, i) => {
      const prev = saas.info.rows[i - 1];
      tbody.appendChild(h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })),
        groupSel(r, prev && prev.label === r.label),
        area(r.sub, (v) => { r.sub = v; }, 'font-weight:600;background:#F8FAFC'),
        area(r.desc, (v) => { r.desc = v; }, 'text-align:left;color:var(--ss-ink-2)'),
        typeSel(r),
        ...cols.map((svc) => (r.type === 'money' ? money(r, svc.form.code)
          : area(r.values[svc.form.code], (v) => { r.values[svc.form.code] = v; }, 'text-align:center', true)))));
    });
    return h('div', { style: 'margin-top:16px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ SaaS 정책 기본정보'),
        h('span', { class: 'ss-detailbar__note' }, '칸을 눌러 고칩니다. 형식이 금액인 행은 숫자만 받습니다. 글자 칸의 줄바꿈은 Enter.'),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => { const last = saas.info.rows[saas.info.rows.length - 1];
          saas.info.rows.push({ label: last ? last.label : '기본', sub: '', desc: '', type: 'text', values: {}, checked: false }); paintSaasBody(); } }, '행추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          if (!saas.info.rows.some((r) => r.checked)) return toast('삭제할 행을 선택하세요.', 'err');
          saas.info.rows = saas.info.rows.filter((r) => !r.checked);
          paintSaasBody();
        } }, '행삭제')),
      // 서비스 열은 화면 폭에서 남는 너비를 나눠 갖는다(2026-11-04 사용자 요청 — 서비스가 하나뿐이면 좁아 보였다). 좁은 화면이면 최소 300px · 가로 스크롤
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' },
        sized(h('table', { class: 'ss-grid ss-grid--sized', style: `width:100%;min-width:${widths.reduce((x, w) => x + w, 0)}px` },
          h('colgroup', {}, ...widths.map((w, i) => h('col', { style: i < 5 ? `width:${w}px` : '' }))),
          h('thead', {}, h('tr', {}, h('th', { 'data-fixed': '' }, '선택'), h('th', {}, '항목'), h('th', {}, '세부'), h('th', {}, '상세 설명'), h('th', {}, '형식'),
            ...cols.map((svc) => h('th', {}, shortName(svc))))),
          tbody), 'info5')));
  }

  // 칸 경계를 끌어 너비 조절 — 조절한 너비는 이 브라우저에 기억(두 번 누르면 처음 너비). 선택 칸은 고정
  const sized = (table, key) => { resizableColumns(table, `quote2:pricing-saas:${key}`); return table; };

  // 서비스 표 — 코드 · 서비스. 이미 있는 서비스의 코드는 템플릿 · 견적이 참조하므로 잠근다. 행을 누르면 아래에 그 서비스의 구간표
  function serviceCard() {
    const tbody = h('tbody');
    const cols = [['선택', 60], ['코드', 160], ['서비스', 220], ['상세 내용', 560]];
    const pct = cols.slice(1).reduce((x, [, w]) => x + w, 0);
    // 상세 내용 — 여러 줄. 줄 수만큼 칸이 늘어난다
    const detail = (svc) => {
      const ta = h('textarea', { class: 'ss-cellinput', 'aria-label': '상세 내용', placeholder: '제공 기능 · 조건 등 서비스 설명',
        rows: Math.max(1, String(svc.form.spec || '').split('\n').length),
        style: 'height:auto;resize:none;border:0;background:transparent;line-height:1.5;padding:4px 6px;text-align:left',
        onclick: (e) => e.stopPropagation(),
        oninput: (e) => { svc.form.spec = e.target.value; e.target.rows = Math.max(1, e.target.value.split('\n').length); } });
      ta.value = svc.form.spec || '';
      return h('td', { class: 'ss-cell--input' }, ta);
    };
    const txt = (svc, key, attrs = {}) => h('td', { class: 'ss-cell--input' }, h('input', { class: 'ss-cellinput', 'aria-label': key, value: svc.form[key] ?? '', ...attrs,
      onclick: (e) => e.stopPropagation(), oninput: (e) => { svc.form[key] = e.target.value; } }));
    if (!saas.services.length) tbody.appendChild(h('tr', {}, h('td', { colspan: cols.length, class: 'ss-cell--empty' }, '서비스가 없습니다. 행추가로 넣으세요 (예: S2C, S2P).')));
    for (const svc of saas.services) {
      tbody.appendChild(h('tr', {
        class: (svc === saas.pick ? 'is-selected' : '') + (svc.isNew ? ' is-new' : ''), style: 'cursor:pointer',
        title: '눌러서 이 서비스의 구간표 보기', onclick: () => { saas.pick = svc; paintSaasBody(); },
      },
      h('td', {}, h('input', { type: 'checkbox', checked: svc.checked, 'aria-label': '선택', onclick: (e) => e.stopPropagation(), onchange: (e) => { svc.checked = e.target.checked; } })),
      // 코드는 자동 채번 — 새 행도 고치지 않는다(저장 전에는 옅게)
      h('td', { class: 'ss-cell--link', style: 'text-align:center' + (svc.isNew ? ';opacity:.7' : ''),
        title: svc.isNew ? '자동 채번된 코드 — 저장하면 확정됩니다' : '템플릿이 참조하는 코드라 고칠 수 없습니다' }, svc.form.code),
      txt(svc, 'name'), detail(svc)));
    }
    return h('div', { style: 'margin-top:16px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1);white-space:nowrap' }, '▣ 서비스'),
        h('span', { class: 'ss-detailbar__note' }, '누르면 아래에 구간표(구간 월 사용료)가 나옵니다.'),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          const svc = { orig: null, form: { code: nextSvcCode(), name: '', unit: 'User/월', base_price: null, sort: saas.services.length + 1 },
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
      // 화면 폭에 맞춘다 — 선택 칸만 고정, 나머지는 비율
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px' },
        sized(h('table', { class: 'ss-grid ss-grid--sized', style: 'width:100%' },
          h('colgroup', {}, ...cols.map(([, w], i) => h('col', { style: i ? `width:${Math.round((w / pct) * 100)}%` : `width:${w}px` }))),
          h('thead', {}, h('tr', {}, ...cols.map(([t], i) => h('th', i ? {} : { 'data-fixed': '' }, t)))),
          tbody), 'service')));
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
    return h('div', { style: 'min-width:0' },
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
      // 칸(50%) 폭에 맞춘다 — 선택 칸만 고정, 나머지는 비율
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px' },
        sized(h('table', { class: 'ss-grid ss-grid--sized', style: 'width:100%' },
          h('colgroup', {}, ...cols.map(([, w], i) => h('col', { style: i ? `width:${Math.round((w / (width - 60)) * 100)}%` : `width:${w}px` }))),
          h('thead', {}, h('tr', {}, ...cols.map(([t], i) => h('th', i ? {} : { 'data-fixed': '' }, t)))),
          tbody), `range-${kind}`)));
  }

  // 모듈 표 — 코드 · 모듈 · 세부기능 · 금액 방식 · 기준단가 · 서비스별 기본 포함(체크하면 그 서비스로 견적을 시작할 때 미리 체크된다)
  function moduleCard() {
    const svcs = saas.services;
    const area = (m, key, ph) => {
      const ta = h('textarea', { class: 'ss-cellinput', 'aria-label': key, placeholder: ph, rows: Math.max(1, String(m.form[key] || '').split('\n').length),
        style: 'height:auto;resize:none;border:0;background:transparent;line-height:1.5;padding:4px 6px;text-align:left',
        oninput: (e) => { m.form[key] = e.target.value; e.target.rows = Math.max(1, e.target.value.split('\n').length); } });
      ta.value = m.form[key] || '';
      return h('td', { class: 'ss-cell--input' }, ta);
    };
    const tbody = h('tbody');
    if (!saas.modules.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 7 + svcs.length, class: 'ss-cell--empty' }, '모듈이 없습니다. 행추가로 넣으세요 (예: Easy Sourcing™).')));
    for (const m of saas.modules) {
      const priced = m.mode === 'PRICED';
      const price = numInput(priced ? m.form.base_price ?? '' : '', (v) => { m.form.base_price = toNum(v); },
        { class: 'ss-cellinput', 'aria-label': '기준단가', style: 'text-align:right;padding:4px 10px', placeholder: priced ? '' : '-' });
      price.disabled = !priced;
      tbody.appendChild(h('tr', { class: m.isNew ? 'is-new' : '' },
        h('td', {}, h('input', { type: 'checkbox', checked: m.checked, 'aria-label': '선택', onchange: (e) => { m.checked = e.target.checked; } })),
        h('td', { class: 'ss-cell--link', style: 'text-align:center' + (m.isNew ? ';opacity:.7' : ''),
          title: m.isNew ? '자동 채번된 코드 — 저장하면 확정됩니다' : '템플릿 · 견적이 참조하는 코드라 고칠 수 없습니다' }, m.form.code),
        h('td', { class: 'ss-cell--input' }, h('input', { class: 'ss-cellinput', 'aria-label': '모듈', value: m.form.name, style: 'font-weight:600',
          oninput: (e) => { m.form.name = e.target.value; } })),
        area(m, 'spec', '세부기능 (줄바꿈은 Enter)'),
        h('td', { class: 'ss-cell--input' }, h('select', { class: 'ss-cellinput', 'aria-label': '금액 방식', style: 'text-align:center',
          onchange: (e) => {
            m.mode = e.target.value;
            if (m.mode !== 'PRICED') m.form.base_price = 0;
            if (m.mode === 'OPTION') m.services.clear(); // 옵션은 기본 포함 없이 골라서 넣는다
            paintSaasBody();
          } }, ...MODULE_MODES.map(([k, l]) => h('option', { value: k, selected: k === m.mode }, l)))),
        h('td', { class: 'ss-cell--input' }, price),
        // 정렬 — 모듈 목록 · 견적 작성의 모듈 줄 순서(작은 수가 위). 저장하면 그 순서로 다시 보인다
        h('td', { class: 'ss-cell--input' }, numInput(m.form.sort ?? '', (v) => { m.form.sort = toNum(v); },
          { class: 'ss-cellinput', 'aria-label': '정렬', style: 'text-align:center;padding:4px 6px' }, true)),
        ...svcs.map((svc) => h('td', { style: 'text-align:center' }, h('input', { type: 'checkbox', 'aria-label': `${shortName(svc)} 기본 포함`,
          checked: m.services.has(svc.form.code), disabled: m.mode === 'OPTION',
          onchange: (e) => { if (e.target.checked) m.services.add(svc.form.code); else m.services.delete(svc.form.code); } })))));
    }
    const widths = [60, 140, 180, 320, 130, 120, 70, ...svcs.map(() => 90)];
    return h('div', { style: 'margin-top:16px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1);white-space:nowrap' }, '▣ 모듈'),
        h('span', { class: 'ss-detailbar__note' }, '서비스 칸에 체크하면 그 서비스로 견적을 시작할 때 미리 선택됩니다. 이용료에 포함 모듈은 서비스 이용료 줄과 묶여 금액이 한 번만 나갑니다.'),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          saas.modules.push({ orig: null, form: { code: nextModCode(), name: '', spec: '', base_price: 0, sort: saas.modules.length + 1 },
            isNew: true, checked: false, mode: 'BUNDLE', services: new Set() });
          paintSaasBody();
        } }, '행추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          const picked = saas.modules.filter((x) => x.checked);
          if (!picked.length) return toast('삭제할 행을 선택하세요.', 'err');
          picked.forEach((x) => { if (!x.isNew) saas.modDeleted.push(x.orig); });
          saas.modules = saas.modules.filter((x) => !x.checked);
          paintSaasBody();
        } }, '행삭제')),
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;width:fit-content;max-width:100%;overflow:auto' },
        sized(h('table', { class: 'ss-grid ss-grid--sized', style: `width:${widths.reduce((x, w) => x + w, 0)}px` },
          h('colgroup', {}, ...widths.map((w) => h('col', { style: `width:${w}px` }))),
          h('thead', {}, h('tr', {}, h('th', { 'data-fixed': '' }, '선택'), h('th', {}, '코드'), h('th', {}, '모듈'), h('th', {}, '세부기능'),
            h('th', {}, '금액 방식'), h('th', {}, '기준단가(월)'), h('th', {}, '정렬'), ...svcs.map((svc) => h('th', {}, shortName(svc))))),
          tbody), 'module')));
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

  const VERSIONING = false; // 저장할 때 새 버전으로 남길지 — 프로젝트 완료 전에는 v1.0 유지
  // 다음 버전 번호 — v1.0 → v1.1. 형식이 다르면 v1.0 부터
  function nextVersion() {
    const m = String(saas.policy.current?.version || '').match(/^v?(\d+)\.(\d+)$/i);
    return m ? `v${m[1]}.${Number(m[2]) + 1}` : 'v1.0';
  }

  // 견적조건 — 조회만(2026-11-04 사용자 요청). 이 솔루션 SaaS 템플릿이 쓰는 견적조건 문구 세트의 문장을 그대로 보인다.
  //   고치는 곳은 기준정보 > 견적조건 문구 한 곳 — 가격정책에는 견적조건을 저장하지 않는다(이원화하지 않는다)
  function condsCard() {
    const wrap = h('div', { style: 'margin-top:16px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1);white-space:nowrap' }, '▣ SaaS 견적조건'),
        h('span', { class: 'ss-detailbar__note' }, '조회만 합니다. 이 솔루션 SaaS 템플릿이 쓰는 견적조건 문구입니다. 문장은 기준정보 > 견적조건 문구에서 고칩니다.'),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => { location.hash = '#/conditions'; } }, '견적조건 문구에서 고치기')));
    const list = h('div', {}, h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '불러오는 중...'));
    wrap.appendChild(list);
    (async () => {
      try {
        const [tr, cs] = await Promise.all([api.templates({ quote_type: 'BUILD', solution: state.solution }), api.conditionSets()]);
        const tpls = (tr.templates || []).filter((t) => t.deployment === 'SAAS');
        const sets = cs.sets || [];
        // 같은 세트를 쓰는 템플릿은 한 표로 묶는다
        const groups = [];
        for (const t of tpls) {
          const g = groups.find((x) => x.code === (t.condition_set || ''));
          if (g) g.tpls.push(t); else groups.push({ code: t.condition_set || '', tpls: [t] });
        }
        clear(list);
        if (!groups.length) { list.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '이 솔루션의 SaaS 템플릿이 없습니다.')); return; }
        for (const g of groups) {
          const set = sets.find((x) => x.code === g.code);
          const lines = ((set && set.lines) || []).map((t) => String(t || '').trim()).filter(Boolean);
          const tbody = h('tbody', {}, ...lines.map((t, i) => h('tr', {},
            h('td', { style: 'text-align:center' }, String(i + 1)),
            h('td', { style: 'text-align:left;white-space:pre-line' }, t))));
          if (!lines.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 2, class: 'ss-cell--empty' }, set ? '문장이 없습니다.' : '템플릿에 견적조건 문구 세트가 없습니다.')));
          list.appendChild(h('div', { style: 'margin-top:12px' },
            h('div', { style: 'font-size:13px;font-weight:600;color:var(--ss-ink-1)' }, set ? `${set.name} (${set.code})` : '견적조건 없음',
              h('span', { style: 'font-weight:400;color:var(--ss-ink-3);margin-left:8px;font-size:12px' }, '템플릿: ' + g.tpls.map((t) => t.name).join(', '))),
            h('div', { class: 'ss-gridwrap', style: 'margin-top:6px' },
              h('table', { class: 'ss-grid', style: 'width:100%' },
                h('colgroup', {}, h('col', { style: 'width:60px' }), h('col', {})),
                h('thead', {}, h('tr', {}, h('th', {}, '번호'), h('th', {}, '내용'))),
                tbody))));
        }
      } catch (err) {
        clear(list).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, err.message));
      }
    })();
    return wrap;
  }

  // 정책 전체 사본 — 버전 이력에 남긴다
  const policyContent = () => ({
    info: {
      columns: saas.services.map((svc) => ({ code: svc.form.code, label: shortName(svc) })),
      rows: saas.info.rows.map((r) => ({ label: r.label, sub: r.sub, desc: (r.desc || '').trim(), type: r.type,
        values: Object.fromEntries(saas.services.map((svc) => [svc.form.code, r.values[svc.form.code] || ''])) })),
    },
    services: saas.services.map((svc) => ({ code: svc.form.code, name: svc.form.name, spec: svc.form.spec || '', unit: svc.form.unit,
      ranges: Object.fromEntries(RANGE_KINDS.map(([k]) => [k, [...svc.lists[k]].sort((a, b) => a.min - b.min).map((r) => [r.min, r.max, r.price])])) })),
    modules: [...saas.modules].sort((a, b) => (a.form.sort ?? 0) - (b.form.sort ?? 0)).map((m) => ({ code: m.form.code, name: m.form.name, spec: m.form.spec || '', mode: m.mode,
      base_price: m.mode === 'PRICED' ? m.form.base_price ?? 0 : 0,
      services: saas.services.map((svc) => svc.form.code).filter((c) => m.services.has(c)) })),
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
    const modTodo = saas.modules.filter(modChanged);
    if (saas.modules.some((m) => !String(m.form.name || '').trim())) { saasPart = 'module'; paintSaasBody(); return toast('모듈 이름을 넣으세요.', 'err'); }
    const noPrice = saas.modules.find((m) => m.mode === 'PRICED' && !(m.form.base_price > 0));
    if (noPrice) { saasPart = 'module'; paintSaasBody(); return toast(`별도 금액 모듈의 기준단가를 넣으세요: ${noPrice.form.name}`, 'err'); }
    const plan = [];
    for (const svc of todo) {
      const variants = variantsOf(svc);
      if (!variants) { saas.pick = svc; paintSaasBody(); return; }
      plan.push([svc, variants]);
    }
    const offCount = saas.deleted.length + saas.modDeleted.length;
    if (offCount && !(await confirmModal({
      title: '사용 중지', message: `행삭제한 서비스 · 모듈 ${offCount}건은 사용 중지됩니다. 저장하시겠습니까?`, okLabel: '계속', danger: true,
    }))) return;
    // 프로젝트 완료 전까지는 버전을 올리지 않고 지금 버전(없으면 v1.0)을 덮어쓴다(2026-11-04 사용자 요청). 완료 후 VERSIONING 을 true 로
    const ver = VERSIONING ? await askVersion() : { version: saas.policy.current?.version || 'v1.0', note: '' };
    if (!ver) return;
    let done = 0;
    try {
      for (const o of saas.deleted) { await api.deletePriceItem(o.id); done++; }
      for (const [svc, variants] of plan) {
        const f = { name: svc.form.name.trim(), spec: String(svc.form.spec || '').trim() || null, unit: svc.form.unit?.trim() || null, base_price: svc.form.base_price ?? 0, sort: svc.form.sort ?? 0, variants };
        if (svc.isNew) {
          await api.createPriceItem({ ...f, solution: state.solution, deployment: 'SAAS', code: svc.form.code.trim(),
            category: '서비스이용료', pricing_type: 'BAND', recurring: 1, qty_default: 1 });
        } else {
          await api.updatePriceItem(svc.orig.id, f);
        }
        done++;
      }
      for (const o of saas.modDeleted) { await api.deletePriceItem(o.id); done++; }
      for (const m of modTodo) {
        const f = { name: m.form.name.trim(), spec: String(m.form.spec || '').trim() || null, base_price: m.mode === 'PRICED' ? m.form.base_price ?? 0 : 0,
          sort: m.form.sort ?? 0, unit: '식' };
        if (m.isNew) {
          await api.createPriceItem({ ...f, solution: state.solution, deployment: 'SAAS', code: m.form.code, category: MODULE_CAT,
            pricing_type: 'FIXED', recurring: 1, qty_default: 1 });
        } else {
          await api.updatePriceItem(m.orig.id, f);
        }
        done++;
      }
      await api.savePricePolicy({ solution: state.solution, deployment: 'SAAS', version: ver.version, note: ver.note, content: policyContent() });
      toast(`${ver.version} 으로 저장되었습니다.`, 'ok');
      store.master = null;
    } catch (err) {
      toast(`${done}건 저장 후 실패: ${err.message}`, 'err');
      refresh();
      return;
    }
    // 저장한 정책으로 SaaS 템플릿을 검사한다 — 맞출 곳이 있으면 확인 창(2026-11-04 사용자 요청). refresh 가 saas 를 지우므로 먼저 떠 둔다
    const snap = {
      solution: state.solution,
      services: saas.services.map((x) => x.form.code),
      deletedSvc: saas.deleted.map((o) => ({ code: o.code, name: o.name })),
      modules: saas.modules.map((m) => ({ code: m.form.code, name: m.form.name, mode: m.mode, services: [...m.services] })),
      deletedMods: saas.modDeleted.map((o) => ({ code: o.code, name: o.name })),
    };
    refresh();
    try { await syncTemplates(snap); } catch (err) { toast(`템플릿 검사 실패: ${err.message}`, 'err'); }
  }

  // 템플릿 맞추기 — 서비스 이용료(구간형) 행 바로 뒤 모듈 행을 정책의 '서비스별 기본 포함'으로 맞춘다.
  //   빠진 모듈 추가 · 기본 포함이 아니거나 사용 중지된 모듈 빼기 · 금액 방식에 맞춰 수량(이용료에 포함 0 / 별도 금액 1).
  //   사용 중지된 서비스를 쓰는 템플릿은 알리기만 한다(무엇으로 바꿀지 정할 수 없다)
  async function syncTemplates(snap) {
    const svcCodes = new Set([...snap.services, ...snap.deletedSvc.map((x) => x.code)]);
    const modByCode = Object.fromEntries(snap.modules.map((m) => [m.code, m]));
    const modName = (c) => (modByCode[c] || snap.deletedMods.find((x) => x.code === c) || { name: c }).name;
    const isMod = (c) => !!modByCode[c] || snap.deletedMods.some((x) => x.code === c) || /_SAAS_M\d+$/.test(String(c || ''));
    const list = ((await api.templates({ quote_type: 'BUILD', solution: snap.solution })).templates || []).filter((t) => t.deployment === 'SAAS');
    const plans = [];
    for (const t of list) {
      const d = await api.templateDetail(t.code);
      const order = (d.blocks || []).map((b) => b.block_code);
      const items = Object.values(d.items || {}).flat()
        .sort((a, b) => order.indexOf(a.block_code) - order.indexOf(b.block_code) || a.sort - b.sort)
        .map((it) => ({ block_code: it.block_code, item_code: it.item_code, qty_default: Number(it.qty_default ?? 1),
          band_key: it.band_key || null, band_qty: it.band_qty == null ? null : Number(it.band_qty) }));
      const next = [];
      const changes = [];
      const warns = [];
      for (const it of items) {
        if (isMod(it.item_code)) continue; // 모듈 행은 서비스 행 뒤에 다시 만든다
        next.push(it);
        if (!svcCodes.has(it.item_code)) continue;
        const gone = snap.deletedSvc.find((x) => x.code === it.item_code);
        if (gone) { warns.push(`사용 중지된 서비스 '${gone.name}' 를 씁니다 — 템플릿 화면에서 바꾸세요`); continue; }
        const was = items.filter((x) => x.block_code === it.block_code && isMod(x.item_code));
        for (const m of snap.modules.filter((x) => x.mode !== 'OPTION' && x.services.includes(it.item_code))) {
          const qty = m.mode === 'PRICED' ? 1 : 0;
          const old = was.find((x) => x.item_code === m.code);
          if (!old) changes.push(`${m.name} 추가`);
          else if (Number(old.qty_default) !== qty) changes.push(`${m.name} 수량 ${old.qty_default} → ${qty}`);
          next.push({ block_code: it.block_code, item_code: m.code, qty_default: qty, band_key: null, band_qty: null });
        }
        for (const x of was) if (!next.some((y) => y.block_code === x.block_code && y.item_code === x.item_code)) changes.push(`${modName(x.item_code)} 빼기`);
      }
      // 순서만 다른 경우도 맞춘다(바뀐 내용이 없으면 창에 올리지 않는다)
      if (!changes.length && !warns.length) continue;
      plans.push({ t, d, items: next, changes, warns, checked: changes.length > 0 });
    }
    if (!plans.length) return;
    const tbody = h('tbody', {}, ...plans.map((pl) => h('tr', {},
      h('td', { style: 'text-align:center' }, pl.changes.length
        ? h('input', { type: 'checkbox', checked: pl.checked, 'aria-label': '반영', onchange: (e) => { pl.checked = e.target.checked; } }) : ''),
      h('td', { style: 'text-align:left;padding:8px 12px' }, h('b', {}, pl.t.name), h('div', { style: 'font-size:11px;color:var(--ss-ink-3)' }, pl.t.code)),
      h('td', { style: 'text-align:left;line-height:1.7;padding:8px 12px;white-space:normal' },
        ...pl.changes.map((c) => h('div', {}, c)),
        ...pl.warns.map((w) => h('div', { style: 'color:var(--ss-red,#FF5252)' }, w))))));
    const m = openModal({
      title: '템플릿 변경 확인',
      body: h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
        h('div', { style: 'font-size:12.5px;line-height:1.6;color:var(--ss-ink-2)' },
          '바뀐 가격정책에 맞춰 바꿔야 하는 SaaS 템플릿입니다.', h('br'), '체크한 템플릿만 바꾸며, 이미 저장된 견적은 바뀌지 않습니다.'),
        h('table', { class: 'ss-grid', style: 'width:100%;table-layout:fixed' },
          h('colgroup', {}, h('col', { style: 'width:60px' }), h('col', { style: 'width:240px' }), h('col', {})),
          h('thead', {}, h('tr', {}, h('th', {}, '반영'), h('th', {}, '템플릿'), h('th', {}, '바뀌는 내용'))),
          tbody)),
      footer: [
        h('button', { class: 'btn', onclick: () => m.close() }, '나중에'),
        h('button', { class: 'btn btn-primary', onclick: async () => {
          const todo = plans.filter((pl) => pl.checked && pl.changes.length);
          if (!todo.length) return toast('반영할 템플릿을 체크하세요.', 'err');
          let n = 0;
          try {
            for (const pl of todo) { await api.updateTemplate(pl.t.id ?? pl.d.template.id, templatePayload(pl.d.template, pl.d.blocks, pl.items, pl.d.labor)); n++; }
            toast(`템플릿 ${n}개를 바꿨습니다.`, 'ok');
            m.close();
          } catch (err) { toast(`${n}개 바꾼 뒤 실패: ${err.message}`, 'err'); }
        } }, '템플릿에 반영'),
      ],
    });
    // 기본 창 폭(520px)으로는 표가 잘린다 — 넓혀서 가로 스크롤 없이
    Object.assign(m.back.querySelector('.modal').style, { width: '760px', overflowX: 'hidden' });
  }

  // 템플릿 저장 본문 — 템플릿 화면의 [저장]과 같은 모양(그 화면 payload())
  function templatePayload(t, blocks, items, labor) {
    return {
      quote_type: t.quote_type || 'BUILD', solution: t.solution, code: t.code, name: t.name, deployment: t.deployment, brand: t.brand || null,
      condition_set: t.condition_set || null, include_maintenance: t.include_maintenance ? 1 : 0, include_component: t.include_component ? 1 : 0,
      has_labor_plan: t.has_labor_plan ? 1 : 0, has_pay_plan: t.has_pay_plan ? 1 : 0, active: t.active ? 1 : 0, sort: Number(t.sort) || 0,
      blocks: (blocks || []).map((b) => b.block_code),
      items,
      labor: (labor || []).map((l) => ({ block_code: l.block_code || 'LABOR', role_code: l.role_code, role_label: l.role_label || null,
        grade: l.grade || null, task: l.task || null, mm_default: Number(l.mm_default ?? 0) })),
    };
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
        h('thead', {}, h('tr', {}, h('th', {}, '항목'), h('th', {}, '세부'), h('th', {}, '상세 설명'), ...cols.map((x) => h('th', {}, x.label)))),
        h('tbody', {}, ...sortInfo(((c.info && c.info.rows) || []).map(normInfo)).map((r) => h('tr', {},
          h('td', { style: 'text-align:center;font-weight:600' }, r.label), h('td', { style: 'font-weight:600' }, r.sub),
          h('td', { style: 'text-align:left' }, ...lines(r.desc)),
          ...cols.map((x) => ((r.type || inferType(r.values)) === 'money'
            ? h('td', { style: 'text-align:right' }, comma(cleanNum(r.values && r.values[x.code])))
            : h('td', { style: 'text-align:center' }, ...lines(r.values && r.values[x.code])))))))));
      if ((c.conds || []).length) {
        view.appendChild(h('div', { style: 'margin-top:12px;font-size:12px;line-height:1.6;color:var(--ss-ink-2)' },
          h('b', {}, '견적조건'), ...c.conds.flatMap((t) => [h('br'), `-. ${t}`])));
      }
      for (const svc of c.services || []) {
        if (svc.spec) {
          view.appendChild(h('div', { style: 'margin-top:12px;font-size:12px;line-height:1.5;color:var(--ss-ink-2)' },
            h('b', {}, `${String(svc.name || svc.code).replace(/\s*서비스\s*이용료$/, '')} 상세 내용`), h('br'), ...lines(svc.spec)));
        }
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

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

// On-premise 탭 — 구축형(공통 · 일시불 · 분납) 품목만
const ONPREM_DEPS = DEPLOYMENTS.filter(([v]) => v.startsWith('ONPREM'));
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

  // ── SaaS: 버전 줄 → 서비스 탭 → 서비스 개요 → [기본(구간) | 부가 | 옵션] → 고른 항목 상세 ─────
  // 서비스 = 이 솔루션의 SaaS 구간형 품목(sq_price_items: deployment SAAS · pricing_type BAND · 월).
  // 구간은 그 품목의 variants 에 key USER(인원) / COUNT(건수)로 둔다. 끝을 비우면 '이상'(마지막 구간).
  // [저장] 할 때마다 버전 번호 · 변경 내용을 받아 정책 전체(개요 · 서비스 · 구간 · 가격 항목 · 견적조건)를 새 버전으로 남긴다.
  const RANGE_KINDS = [['USER', '인원 구간', '인'], ['COUNT', '건수 구간', '건']];
  // SaaS 화면(2026-10-30 다시 기획 — 아래로 늘어나지 않는 고정 틀):
  //   서비스 탭(S2C · S2P …) → 서비스 개요 → [기본: 인원 · 건수 구간 | 부가 | 옵션] 세 칸 → 고른 항목의 상세(아래 한 칸).
  //   가격 항목 = 서비스(구간형)가 아닌 SaaS 품목(sq_price_items) 하나. 서비스별 사용 · 금액 · 금액 글(별도협의)은
  //   그 품목의 variants(key 'SVC:서비스코드', price, label)에 둔다 — 가격정책 화면 · 템플릿 · 견적이 같은 품목을 쓴다.
  //   서비스 개요(서비스구분 · 기본 제공 기능 …)는 정책 버전 내용(content.overview)에 둔다. 저장하면 정책 전체가 새 버전.
  let saas = null; // { services, deleted, pick, items, itemsDeleted, itemPick, overview, conds, policy, rangeKind }
  const toNum = (v) => (v === '' || v == null ? null : Number(v));
  const svcForm = (it) => ({ code: it.code || '', name: it.name || '', spec: it.spec || '', unit: it.unit || '', base_price: toNum(it.base_price), sort: toNum(it.sort) });
  const rangeOf = (svc) => JSON.stringify(RANGE_KINDS.map(([k]) => svc.lists[k].map((r) => [r.min, r.max, r.price])));
  const svcChanged = (svc) => svc.isNew || JSON.stringify(svc.form) !== JSON.stringify(svcForm(svc.orig)) || rangeOf(svc) !== svc.base;
  // 예전 기본정보(정책 버전 content.info — 이력 보기 · 옮기기에 쓴다).
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
  // 기본정보 행 형식 — 정하지 않은 옛 행은 값이 모두 숫자면 금액
  const inferType = (values) => {
    const vs = Object.values(values || {}).map((v) => String(v ?? '').trim()).filter(Boolean);
    return vs.length && vs.every((v) => /^-?[\d,]+(\.\d+)?$/.test(v)) ? 'money' : 'text';
  };
  // 견적조건 — 한 줄에 한 문장. 견적서 아래 '-. ' 로 시작하는 문장들(정책 버전 내용 content.conds 에 둔다)
  const condsJson = () => JSON.stringify(saas.conds.map((r) => r.text.trim()).filter(Boolean));
  const itemJson = (it) => JSON.stringify([it.form, it.svc]);
  const itemChanged = (it) => it.isNew || it.migrate || itemJson(it) !== it.base;
  const overviewJson = () => JSON.stringify(saas.overview);
  const saasDirty = () => !!saas && (saas.deleted.length > 0 || saas.services.some(svcChanged) || condsJson() !== saas.condsBase
    || saas.itemsDeleted.length > 0 || saas.items.some(itemChanged) || overviewJson() !== saas.overviewBase);
  const ITEM_GROUPS = ['부가', '옵션']; // 기본 = 서비스 이용료(구간) — 서비스 탭이 맡는다
  const SVC_PREFIX = 'SVC:';
  const svcCodes = () => saas.services.map((x) => x.form.code).filter(Boolean);
  const amountText = (v) => (v ? (v.text || (v.price != null ? won(v.price) : '')) : '');
  // 품목 → 가격 항목. variants 에 SVC: 가 없으면(옮기기 전) 예전 기본정보 행(같은 세부 이름)의 서비스별 값으로 채운다
  function itemOf(it, codes, infoRows) {
    const byCode = {};
    for (const v of it.variants || []) if (String(v.key || '').startsWith(SVC_PREFIX)) byCode[v.key.slice(SVC_PREFIX.length)] = v;
    const migrated = Object.keys(byCode).length > 0;
    const row = infoRows.find((r) => r.label !== '기본' && r.sub === it.name);
    const svc = {};
    for (const c of codes) {
      if (migrated) {
        const v = byCode[c];
        svc[c] = v ? { use: true, price: toNum(v.price), text: v.label || '' } : { use: false, price: null, text: '' };
      } else if (row) svc[c] = cellToSvc(row.values && row.values[c]);
      else svc[c] = { use: true, price: toNum(it.base_price), text: '' };
    }
    const t = `${it.category || ''} ${it.name || ''}`;
    const group = row && ITEM_GROUPS.includes(row.label) ? row.label : /옵션/.test(t) ? '옵션' : '부가';
    const out = { orig: it, isNew: false, migrate: !migrated, form: { code: it.code, group, name: it.name || '', spec: it.spec || '', unit: it.unit || '', recurring: it.recurring ? 1 : 0 }, svc };
    out.base = itemJson(out);
    return out;
  }
  // 예전 기본정보 칸 값 → 서비스별 값. 숫자면 금액, 글이면 금액 글(별도협의 · 없음), 비었으면 이 서비스에 쓰지 않음
  function cellToSvc(raw) {
    const t = String(raw ?? '').trim();
    if (!t) return { use: false, price: null, text: '' };
    return /^-?[\d,]+$/.test(t) ? { use: true, price: Number(t.replace(/,/g, '')), text: '' } : { use: true, price: null, text: t };
  }
  // 새 항목 코드 — 이 솔루션 SaaS 품목 코드 앞부분 + ADD + 번호(겹치지 않게)
  function newItemCode() {
    const all = [...saas.items.map((x) => x.form.code), ...saas.services.map((x) => x.form.code)].filter(Boolean);
    const prefix = (all.find((c) => /_SAAS_/.test(c)) || `${state.solution}_SAAS_X`).replace(/_[^_]+$/, '');
    let n = 1;
    while (all.includes(`${prefix}_ADD${n}`)) n++;
    return `${prefix}_ADD${n}`;
  }
  const OVERVIEW_FIELDS = ['서비스구분', '기본 제공 기능', '특별 제공 기능', '가격정책', '사용자당 가격', '최소가격', '약정기간'];
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
      const content = (policy.current && policy.current.content) || {};
      const infoRows = content.info && Array.isArray(content.info.rows) ? content.info.rows.map(normInfo) : [];
      const codes = services.map((x) => x.form.code);
      const items = (r.items || []).filter((x) => x.pricing_type !== 'BAND').map((it) => itemOf(it, codes, infoRows));
      // 예전 기본정보에만 있고 품목이 없는 부가 · 옵션 행(예: 유지보수비용)은 새 항목으로 — 저장하면 품목이 생긴다
      for (const row of infoRows) {
        if (!ITEM_GROUPS.includes(row.label) || !row.sub || items.some((x) => x.form.name === row.sub)) continue;
        items.push({ orig: null, isNew: true, form: { code: '', group: row.label, name: row.sub, spec: row.desc || '', unit: '', recurring: 1 },
          svc: Object.fromEntries(codes.map((c) => [c, cellToSvc(row.values && row.values[c])])) });
      }
      // 순서 — 정책에 적힌 순서(템플릿 순서로 맞춰 둔 것), 없으면 품목 정렬 순서
      const at = (it) => { const i = infoRows.findIndex((x) => x.label === it.form.group && x.sub === it.form.name); return i < 0 ? 1e6 : i; };
      items.sort((x, y) => at(x) - at(y));
      // 서비스 개요 — 저장된 것, 없으면 예전 기본정보의 기본 행(서비스 이용료 행 제외)
      let overview = content.overview;
      if (!overview || !Array.isArray(overview.fields)) {
        const baseRows = infoRows.filter((x) => x.label === '기본' && x.sub && !/서비스 이용료$/.test(x.sub));
        const fields = baseRows.length ? baseRows.map((x) => x.sub) : OVERVIEW_FIELDS;
        const values = {};
        for (const c of codes) {
          values[c] = {};
          for (const x of baseRows) {
            const v = String((x.values && x.values[c]) ?? '').trim();
            values[c][x.sub] = (x.type || inferType(x.values)) === 'money' && /^\d+$/.test(v) ? comma(v) : v;
          }
        }
        overview = { fields, values };
      }
      saas = { services, deleted: [], pick: services[0] || null, items, itemsDeleted: [], itemPick: null, overview, policy, rangeKind: 'USER' };
      saas.overviewBase = overviewJson();
      const savedConds = policy.current && policy.current.content && policy.current.content.conds;
      saas.conds = (Array.isArray(savedConds) ? savedConds : []).map((text) => ({ text: String(text || ''), checked: false }));
      saas.condsBase = condsJson();
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
    body.appendChild(svcTabs());
    if (!saas.pick) { body.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '서비스가 없습니다. [서비스 관리] 에서 넣으세요.')); return; }
    body.appendChild(overviewCard(saas.pick));
    // 세 칸 — 높이가 고정이고 칸 안에서만 스크롤한다(화면이 아래로 늘어나지 않게)
    saas.cols = h('div', { style: 'display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:12px' },
      baseCard(saas.pick), groupCard('부가'), groupCard('옵션'));
    body.appendChild(saas.cols);
    body.appendChild(itemPanel());
  }
  // 부가 · 옵션 칸만 다시 그린다(상세 칸에서 고칠 때 — 입력 중인 칸이 사라지지 않게)
  function repaintGroups() {
    if (!saas.cols) return;
    saas.cols.children[1].replaceWith(groupCard('부가'));
    saas.cols.children[2].replaceWith(groupCard('옵션'));
  }

  // 버전 줄 — 지금 버전 · 최종 수정 · 변경 내용 + [견적조건] [이력]
  function versionBar() {
    const cur = saas.policy.current;
    return h('div', { class: 'ss-detailbar', style: 'margin-top:0;background:#F8FAFC;border:1px solid #E7EAF0;padding:8px 12px' },
      h('span', { style: 'font-size:13px;font-weight:600;color:var(--ss-primary)' }, cur ? `현재 버전 ${cur.version}` : '저장된 버전 없음'),
      cur ? h('span', { style: 'font-size:12px;color:var(--ss-ink-2);margin-left:12px' },
        `최종 수정 ${when(cur.created_at)} · ${cur.created_by_name || '-'}${cur.note ? ' · ' + cur.note : ''}`)
        : h('span', { class: 'ss-detailbar__note' }, '저장하면 v1.0 으로 기록됩니다.'),
      h('div', { class: 'ss-detailbar__spacer' }),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: openConds }, `견적조건 (${saas.conds.filter((x) => x.text.trim()).length})`),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: openHistory }, `이력 (${saas.policy.history.length})`));
  }

  // 서비스 탭 — 하나를 고르면 아래가 모두 그 서비스 내용. [서비스 관리] 는 서비스 추가 · 이름 · 삭제
  function svcTabs() {
    return h('div', { style: 'display:flex;align-items:flex-end;gap:8px;margin-top:12px' },
      h('div', { class: 'ss-tabs', style: 'margin-top:0;flex:1' }, ...saas.services.map((svc) =>
        h('div', { class: 'ss-tabs__tab' + (svc === saas.pick ? ' ss-tabs__tab--active' : ''), style: 'cursor:pointer',
          onclick: () => { saas.pick = svc; paintSaasBody(); } }, shortName(svc)))),
      h('button', { class: 'ss-btn ss-btn--gridrow', style: 'margin-bottom:4px', onclick: openServices }, '서비스 관리'));
  }

  function openServices() {
    const box = h('div', {});
    const repaint = () => { clear(box).appendChild(serviceCard(repaint)); paintSaasBody(); };
    box.appendChild(serviceCard(repaint));
    const m = openModal({ title: `서비스 관리 — ${solName()} SaaS`, body: box,
      footer: [h('button', { class: 'btn btn-primary', onclick: () => m.close() }, '닫기')] });
    m.back.querySelector('.modal').style.width = '1000px';
  }
  function openConds() {
    const box = h('div', {});
    const repaint = () => { clear(box).appendChild(condsCard(repaint)); };
    box.appendChild(condsCard(repaint));
    const m = openModal({ title: `견적조건 — ${solName()} SaaS`, body: h('div', { style: 'max-height:65vh;overflow:auto' }, box),
      footer: [h('button', { class: 'btn btn-primary', onclick: () => { m.close(); paintSaasBody(); } }, '닫기')] });
    m.back.querySelector('.modal').style.width = '900px';
  }

  // 서비스 개요 — 두 줄 칸(라벨 · 값) 격자. 긴 글은 칸 안에서 3줄까지 보이고 스크롤
  function overviewCard(svc) {
    const code = svc.form.code;
    const vals = (saas.overview.values[code] = saas.overview.values[code] || {});
    const area = (value, onInput, attrs = {}) => {
      const ta = h('textarea', { class: 'ss-cellinput', rows: Math.min(3, Math.max(1, String(value || '').split('\n').length)), ...attrs,
        style: 'height:auto;resize:none;line-height:1.5;padding:4px 6px;text-align:left;overflow:auto',
        oninput: (e) => { onInput(e.target.value); e.target.rows = Math.min(3, Math.max(1, e.target.value.split('\n').length)); } });
      ta.value = value || '';
      return ta;
    };
    const cell = (label, input) => h('div', { style: 'display:grid;grid-template-columns:110px minmax(0,1fr);border-bottom:1px solid #E7EAF0' },
      h('div', { style: 'background:#F8FAFC;font-size:12px;font-weight:600;padding:6px 8px;color:var(--ss-ink-2)' }, label),
      h('div', { style: 'padding:2px 4px' }, input));
    const cells = [
      cell('서비스명', area(svc.form.name, (v) => { svc.form.name = v; })),
      cell('단위', area(svc.form.unit, (v) => { svc.form.unit = v; })),
      ...saas.overview.fields.map((f) => cell(f, area(vals[f], (v) => { vals[f] = v; }))),
      cell('상세 내용', area(svc.form.spec, (v) => { svc.form.spec = v; }, { placeholder: '견적서 세부기능에 들어갈 서비스 설명' })),
    ];
    return h('div', { style: 'margin-top:12px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, `▣ ${shortName(svc)} 서비스 개요`),
        h('span', { class: 'ss-detailbar__note' }, '항목 이름은 모든 서비스에 같습니다.'),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          const name = (prompt('추가할 개요 항목 이름') || '').trim();
          if (!name) return;
          if (saas.overview.fields.includes(name)) return toast('이미 있는 항목입니다.', 'err');
          saas.overview.fields.push(name); paintSaasBody();
        } }, '항목 추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          const name = (prompt(`뺄 개요 항목 이름\n(${saas.overview.fields.join(', ')})`) || '').trim();
          if (!name) return;
          if (!saas.overview.fields.includes(name)) return toast('그런 항목이 없습니다.', 'err');
          saas.overview.fields = saas.overview.fields.filter((x) => x !== name);
          for (const c of Object.keys(saas.overview.values)) delete saas.overview.values[c][name];
          paintSaasBody();
        } }, '항목 빼기')),
      h('div', { style: 'margin-top:8px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:16px;border-top:1px solid #E7EAF0' }, ...cells));
  }

  const COL_H = 'height:330px;overflow:auto;border:1px solid #E7EAF0;border-top:0';
  const colHead = (title, ...btns) => h('div', { class: 'ss-detailbar', style: 'margin-top:0;border:1px solid #E7EAF0;background:#F8FAFC;padding:6px 10px' },
    h('span', { style: 'font-size:13px;font-weight:600;color:var(--ss-ink-1)' }, title), h('div', { class: 'ss-detailbar__spacer' }), ...btns);

  // 기본 — 서비스 이용료: 인원 구간 | 건수 구간 (구간 월 금액)
  function baseCard(svc) {
    const kinds = RANGE_KINDS;
    const k = kinds.find(([x]) => x === saas.rangeKind) || kinds[0];
    return h('div', { style: 'min-width:0' },
      colHead('▣ 기본 — 서비스 이용료',
        ...kinds.map(([x, label]) => h('button', { class: 'ss-btn ss-btn--gridrow' + (x === k[0] ? ' ss-btn--save' : ''),
          onclick: () => { saas.rangeKind = x; paintSaasBody(); } }, label))),
      h('div', { style: COL_H + ';padding:8px' }, rangeCard(svc, k[0], k[1], k[2])));
  }

  // 부가 · 옵션 — 한 줄에 [사용] 세부 · 금액. 누르면 아래 상세 칸
  function groupCard(group) {
    const code = saas.pick.form.code;
    const list = saas.items.filter((x) => x.form.group === group);
    const tbody = h('tbody');
    for (const it of list) {
      const v = it.svc[code] = it.svc[code] || { use: false, price: null, text: '' };
      const tr = h('tr', { class: it === saas.itemPick ? 'is-selected' : '', style: `cursor:pointer;${v.use ? '' : 'color:#B6BDC8'}`,
        title: '눌러서 상세 보기', onclick: () => { saas.itemPick = it; paintSaasBody(); } },
        h('td', {}, h('input', { type: 'checkbox', checked: v.use, title: `${shortName(saas.pick)} 에 씀`,
          onclick: (e) => e.stopPropagation(), onchange: (e) => { v.use = e.target.checked; repaintGroups(); } })),
        h('td', { style: 'text-align:left' }, it.form.name || '(이름 없음)'),
        h('td', { style: 'text-align:right' }, v.use ? amountText(v) : '미사용'));
      tbody.appendChild(tr);
    }
    if (!list.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 3, class: 'ss-cell--empty' }, '항목이 없습니다. [추가] 로 넣으세요.')));
    return h('div', { style: 'min-width:0' },
      colHead(`▣ ${group}`, h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
        const it = { orig: null, isNew: true, form: { code: '', group, name: '', spec: '', unit: '월', recurring: 1 },
          svc: Object.fromEntries(svcCodes().map((c) => [c, { use: c === code, price: null, text: '' }])) };
        saas.items.push(it); saas.itemPick = it; paintSaasBody();
      } }, '추가')),
      h('div', { style: COL_H },
        h('table', { class: 'ss-grid', style: 'width:100%;border:0' },
          h('colgroup', {}, h('col', { style: 'width:44px' }), h('col', {}), h('col', { style: 'width:120px' })),
          h('thead', {}, h('tr', {}, h('th', {}, '사용'), h('th', {}, '세부'), h('th', {}, '금액'))), tbody)));
  }

  // 고른 항목의 상세 — 구분 · 세부 · 단위 · 이 서비스 금액(또는 금액 글) · 상세 설명. 다른 서비스 금액은 참고로 한 줄
  function itemPanel() {
    const it = saas.itemPick && saas.items.includes(saas.itemPick) ? saas.itemPick : null;
    const wrap = h('div', { style: 'margin-top:12px;border:1px solid #E7EAF0;min-height:150px' });
    if (!it) {
      wrap.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, '부가 · 옵션에서 항목을 누르면 여기에 상세가 나옵니다.'));
      return wrap;
    }
    const code = saas.pick.form.code;
    const v = it.svc[code] = it.svc[code] || { use: false, price: null, text: '' };
    const field = (label, el, span) => h('label', { style: `display:grid;grid-template-columns:90px minmax(0,1fr);align-items:center;gap:6px;font-size:12px;${span ? 'grid-column:1 / -1' : ''}` },
      h('span', { style: 'font-weight:600;color:var(--ss-ink-2)' }, label), el);
    const input = (val, on, attrs = {}) => h('input', { class: 'ss-input', value: val ?? '', ...attrs, oninput: (e) => on(e.target.value), onchange: repaintGroups });
    const groupSel = h('select', { class: 'ss-input', onchange: (e) => { it.form.group = e.target.value; repaintGroups(); } },
      ...ITEM_GROUPS.map((g) => h('option', { value: g, selected: g === it.form.group }, g)));
    const price = numInput(v.price ?? '', (x) => { v.price = toNum(x); }, { class: 'ss-input', style: 'text-align:right', 'aria-label': '금액' });
    price.addEventListener('change', repaintGroups);
    const desc = h('textarea', { class: 'ss-input', rows: 4, style: 'height:auto;resize:vertical;line-height:1.5', placeholder: '견적서 세부기능에 들어갈 설명',
      oninput: (e) => { it.form.spec = e.target.value; } });
    desc.value = it.form.spec || '';
    const others = saas.services.filter((x) => x !== saas.pick).map((x) => `${shortName(x)} ${it.svc[x.form.code]?.use ? amountText(it.svc[x.form.code]) || '-' : '미사용'}`).join(' · ');
    wrap.append(
      h('div', { class: 'ss-detailbar', style: 'margin-top:0;background:#F8FAFC;padding:6px 10px' },
        h('span', { style: 'font-size:13px;font-weight:600' }, `▣ ${it.form.name || '새 항목'} — ${shortName(saas.pick)}`),
        h('span', { class: 'ss-detailbar__note' }, others ? `다른 서비스: ${others}` : ''),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', title: '이 금액 · 금액 글을 다른 서비스에도 넣고 모두 사용으로', onclick: () => {
          for (const c of svcCodes()) it.svc[c] = { ...v, use: true };
          toast('모든 서비스에 같은 금액을 넣었습니다.', 'ok'); paintSaasBody();
        } }, '모든 서비스에 같게'),
        h('button', { class: 'ss-btn ss-btn--delete', onclick: () => {
          if (!it.isNew) saas.itemsDeleted.push(it.orig);
          saas.items = saas.items.filter((x) => x !== it); saas.itemPick = null; paintSaasBody();
        } }, '항목 삭제')),
      h('div', { style: 'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:8px 16px;padding:10px' },
        field('구분', groupSel),
        field('세부', input(it.form.name, (x) => { it.form.name = x; })),
        field('단위', input(it.form.unit, (x) => { it.form.unit = x; }, { placeholder: '월 · 식 · MM' })),
        field('사용', h('span', {}, h('input', { type: 'checkbox', checked: v.use, onchange: (e) => { v.use = e.target.checked; repaintGroups(); } }),
          ` ${shortName(saas.pick)} 에 씀`)),
        field('금액 (원)', price),
        field('금액 글', input(v.text, (x) => { v.text = x.trim(); }, { placeholder: '별도협의 · 없음 (있으면 금액 대신 보임)' })),
        field('상세 설명', desc, true)));
    return wrap;
  }

  // 칸 경계를 끌어 너비 조절 — 조절한 너비는 이 브라우저에 기억(두 번 누르면 처음 너비). 선택 칸은 고정
  const sized = (table, key) => { resizableColumns(table, `quote2:pricing-saas:${key}`); return table; };

  // 서비스 표 — 코드 · 서비스. 이미 있는 서비스의 코드는 템플릿 · 견적이 참조하므로 잠근다. 행을 누르면 아래에 그 서비스의 구간표
  function serviceCard(repaint = paintSaasBody) {
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
        title: '눌러서 이 서비스 고르기', onclick: () => { saas.pick = svc; repaint(); },
      },
      h('td', {}, h('input', { type: 'checkbox', checked: svc.checked, 'aria-label': '선택', onclick: (e) => e.stopPropagation(), onchange: (e) => { svc.checked = e.target.checked; } })),
      svc.isNew ? txt(svc, 'code', { style: 'text-align:center' }) : h('td', { class: 'ss-cell--link', style: 'text-align:center', title: '템플릿이 참조하는 코드라 고칠 수 없습니다' }, svc.form.code),
      txt(svc, 'name'), detail(svc)));
    }
    return h('div', { style: 'margin-top:16px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1);white-space:nowrap' }, '▣ 서비스'),
        h('span', { class: 'ss-detailbar__note' }, '코드는 템플릿 · 견적이 참조합니다. 서비스 개요 · 구간은 화면의 서비스 탭에서 고칩니다.'),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          const svc = { orig: null, form: { code: '', name: '', unit: 'User/월', base_price: null, sort: saas.services.length + 1 },
            isNew: true, checked: false, lists: { USER: [], COUNT: [] } };
          svc.base = rangeOf(svc);
          saas.services.push(svc);
          saas.pick = svc;
          repaint();
        } }, '행추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
          const picked = saas.services.filter((x) => x.checked);
          if (!picked.length) return toast('삭제할 행을 선택하세요.', 'err');
          picked.forEach((x) => { if (!x.isNew) saas.deleted.push(x.orig); });
          saas.services = saas.services.filter((x) => !x.checked);
          if (!saas.services.includes(saas.pick)) saas.pick = saas.services[0] || null;
          repaint();
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

  // 견적조건 — 선택 · 번호 · 내용(여러 줄). 행추가 · 행삭제 · 위로 · 아래로
  function condsCard(repaint = paintSaasBody) {
    const tbody = h('tbody');
    const move = (d) => {
      const list = saas.conds;
      const picked = list.filter((r) => r.checked);
      if (!picked.length) return toast('옮길 행을 선택하세요.', 'err');
      const idx = picked.map((r) => list.indexOf(r));
      if (d < 0 ? idx[0] === 0 : idx[idx.length - 1] === list.length - 1) return;
      for (const i of d < 0 ? idx : [...idx].reverse()) [list[i], list[i + d]] = [list[i + d], list[i]];
      repaint();
    };
    saas.conds.forEach((r, i) => {
      const ta = h('textarea', { class: 'ss-cellinput', rows: Math.max(1, r.text.split('\n').length),
        style: 'height:auto;resize:none;line-height:1.5;padding:4px 6px;text-align:left',
        oninput: (e) => { r.text = e.target.value; e.target.rows = Math.max(1, e.target.value.split('\n').length); } });
      ta.value = r.text;
      tbody.appendChild(h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })),
        h('td', { style: 'text-align:center' }, String(i + 1)),
        h('td', { class: 'ss-cell--input' }, ta)));
    });
    if (!saas.conds.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 3, class: 'ss-cell--empty' }, '견적조건이 없습니다. 행추가로 넣으세요.')));
    const gbtn = (label, onclick) => h('button', { class: 'ss-btn ss-btn--gridrow', onclick }, label);
    return h('div', { style: 'margin-top:16px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ SaaS 견적조건'),
        h('span', { class: 'ss-detailbar__note' }, '한 줄에 한 조건. 견적서에는 \'-. \' 로 시작하는 문장으로 나옵니다.'),
        h('div', { class: 'ss-detailbar__spacer' }),
        gbtn('▲ 위로', () => move(-1)), gbtn('▼ 아래로', () => move(1)),
        gbtn('행추가', () => { saas.conds.push({ text: '', checked: false }); repaint(); }),
        gbtn('행삭제', () => {
          if (!saas.conds.some((r) => r.checked)) return toast('삭제할 행을 선택하세요.', 'err');
          saas.conds = saas.conds.filter((r) => !r.checked);
          repaint();
        })),
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px' },
        sized(h('table', { class: 'ss-grid ss-grid--sized', style: 'width:100%' },
          h('colgroup', {}, h('col', { style: 'width:60px' }), h('col', { style: 'width:60px' }), h('col', {})),
          h('thead', {}, h('tr', {}, h('th', { 'data-fixed': '' }, '선택'), h('th', {}, '번호'), h('th', {}, '내용'))),
          tbody), 'conds')));
  }

  // 정책 전체 사본 — 버전 이력에 남긴다
  //   info 는 예전 형식(항목 · 세부 · 상세 설명 · 서비스별 값) — 견적 작성 3단계의 구분 → 모듈 목록이 읽는다.
  //   기본 = 서비스(이름 · 상세 내용), 부가 · 옵션 = 가격 항목
  const policyContent = () => ({
    overview: saas.overview,
    items: saas.items.map((it) => ({ code: it.form.code, group: it.form.group, name: it.form.name, spec: it.form.spec, unit: it.form.unit, svc: it.svc })),
    info: {
      columns: saas.services.map((svc) => ({ code: svc.form.code, label: shortName(svc) })),
      rows: [
        ...saas.services.map((svc) => ({ label: '기본', sub: svc.form.name, desc: (svc.form.spec || '').trim(), type: 'text',
          values: Object.fromEntries(saas.services.map((x) => [x.form.code, x === svc ? '사용' : ''])) })),
        ...ITEM_GROUPS.flatMap((g) => saas.items.filter((it) => it.form.group === g).map((it) => ({ label: g, sub: it.form.name, desc: (it.form.spec || '').trim(), type: 'text',
          values: Object.fromEntries(saas.services.map((x) => { const v = it.svc[x.form.code]; return [x.form.code, v && v.use ? (v.text || (v.price != null ? String(v.price) : '')) : '']; })) }))),
      ],
    },
    conds: saas.conds.map((r) => r.text.trim()).filter(Boolean),
    services: saas.services.map((svc) => ({ code: svc.form.code, name: svc.form.name, spec: svc.form.spec || '', unit: svc.form.unit,
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
    const itemTodo = saas.items.filter(itemChanged);
    const noName = itemTodo.find((it) => !String(it.form.name || '').trim());
    if (noName) { saas.itemPick = noName; paintSaasBody(); return toast('항목의 세부(이름)를 넣으세요.', 'err'); }
    const plan = [];
    for (const svc of todo) {
      const variants = variantsOf(svc);
      if (!variants) { saas.pick = svc; paintSaasBody(); return; }
      plan.push([svc, variants]);
    }
    const stopN = saas.deleted.length + saas.itemsDeleted.length;
    if (stopN && !(await confirmModal({
      title: '사용 중지', message: `삭제한 서비스 · 항목 ${stopN}건은 사용 중지됩니다. 저장하시겠습니까?`, okLabel: '계속', danger: true,
    }))) return;
    const ver = await askVersion();
    if (!ver) return;
    let done = 0;
    try {
      for (const o of [...saas.deleted, ...saas.itemsDeleted]) { await api.deletePriceItem(o.id); done++; }
      // 가격 항목 — 서비스별 사용 · 금액 · 금액 글을 variants(SVC:코드)로. 기준단가는 첫 서비스의 금액(견적 작성 기본값).
      // 금액이 모두 글(별도협의)이면 기준단가는 그대로 둔다 — 템플릿 견적(내부시스템 연계 2MM × 단가 등)이 쓰고 있다
      for (const it of itemTodo) {
        const variants = svcCodes().filter((c) => it.svc[c] && it.svc[c].use)
          .map((c, i) => ({ key: SVC_PREFIX + c, label: it.svc[c].text || null, price: it.svc[c].price, sort: i }));
        const first = variants.find((x) => x.price != null);
        const f = { category: it.form.group, name: it.form.name.trim(), spec: String(it.form.spec || '').trim() || null,
          unit: String(it.form.unit || '').trim() || null, base_price: first ? first.price : it.orig ? Number(it.orig.base_price) || 0 : 0, variants };
        if (it.isNew) {
          if (!it.form.code) it.form.code = newItemCode();
          await api.createPriceItem({ ...f, solution: state.solution, deployment: 'SAAS', code: it.form.code, pricing_type: 'FIXED',
            recurring: it.form.recurring ? 1 : 0, qty_default: 1 });
        } else {
          await api.updatePriceItem(it.orig.id, f);
        }
        done++;
      }
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
      if (c.overview && Array.isArray(c.items)) { // 새 형식(서비스 개요 · 가격 항목)
        view.appendChild(h('table', { class: 'ss-grid' },
          h('thead', {}, h('tr', {}, h('th', {}, '서비스 개요'), ...cols.map((x) => h('th', {}, x.label)))),
          h('tbody', {}, ...c.overview.fields.map((f) => h('tr', {}, h('td', { style: 'font-weight:600' }, f),
            ...cols.map((x) => h('td', { style: 'text-align:center' }, ...lines(((c.overview.values || {})[x.code] || {})[f]))))))));
        view.appendChild(h('table', { class: 'ss-grid', style: 'margin-top:12px' },
          h('thead', {}, h('tr', {}, h('th', {}, '구분'), h('th', {}, '세부'), h('th', {}, '상세 설명'), ...cols.map((x) => h('th', {}, x.label)))),
          h('tbody', {}, ...c.items.map((it) => h('tr', {}, h('td', { style: 'text-align:center' }, it.group), h('td', { style: 'font-weight:600' }, it.name),
            h('td', {}, ...lines(it.spec)),
            ...cols.map((x) => { const s1 = (it.svc || {})[x.code]; return h('td', { style: 'text-align:right' }, s1 && s1.use ? amountText(s1) : '-'); }))))));
      } else {
      view.appendChild(h('table', { class: 'ss-grid' },
        h('thead', {}, h('tr', {}, h('th', {}, '항목'), h('th', {}, '세부'), h('th', {}, '상세 설명'), ...cols.map((x) => h('th', {}, x.label)))),
        h('tbody', {}, ...sortInfo(((c.info && c.info.rows) || []).map(normInfo)).map((r) => h('tr', {},
          h('td', { style: 'text-align:center;font-weight:600' }, r.label), h('td', { style: 'font-weight:600' }, r.sub),
          h('td', { style: 'text-align:left' }, ...lines(r.desc)),
          ...cols.map((x) => ((r.type || inferType(r.values)) === 'money'
            ? h('td', { style: 'text-align:right' }, comma(cleanNum(r.values && r.values[x.code])))
            : h('td', { style: 'text-align:center' }, ...lines(r.values && r.values[x.code])))))))));
      }
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

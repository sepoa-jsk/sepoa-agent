import { api } from '../api.js';
import { store } from '../app.js';
import { h, toast, clear, confirmModal, resizableColumns, numInput } from '../ui.js';

// 가격정책 = 견적 품목(sq_price_items) + 모듈 단가(sq_modules.base_price) + 직무 단가(sq_labor_roles.base_price).
// L1 인라인 편집형 (2026-10-29 화면 재작성) — 화면 내 탭 상자 + 머리(솔루션 등) + 행추가/행삭제/저장 + 편집 그리드.
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

const TABS = [
  {
    key: 'items', label: '견적 품목', api: itemApi, scoped: true, deploymentFilter: true,
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
    key: 'modules', label: '솔루션 모듈 단가', type: 'modules', scoped: true,
    fields: [
      { key: 'code', label: '코드', type: 'text', mono: true, required: true, unique: true, width: 130 },
      { key: 'name', label: '모듈명', type: 'text', required: true },
      { key: 'base_price', label: '기준단가 (원)', type: 'money', width: 150 },
      { key: 'required', label: '필수', type: 'checkbox', width: 60 },
      { key: 'sort', label: '정렬', type: 'number', width: 70 },
    ],
  },
  {
    key: 'labor', label: '직무별 단가', type: 'labor_roles', scoped: false,
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
  let rows = [];     // [{ orig, form, isNew, checked, seq }]
  let deleted = [];  // 행삭제한 기존 행 — 저장할 때 사용 중지(active=0)
  let sort = { key: null, dir: null };
  let seq = 0;
  let tbody, headCells = [];

  const current = () => TABS.find((t) => t.key === state.tab);
  const isDirty = () => deleted.length > 0 || rows.some((r) => r.isNew || changed(r));

  // ── 탭 상자: 탭줄 + 내용 ──
  const tabs = h('div', { class: 'ss-tabs' });
  const pane = h('div', { class: 'ss-tabbox__pane' });
  root.appendChild(h('div', { class: 'ss-tabbox' }, tabs, pane));

  function paintTabs() {
    clear(tabs);
    TABS.forEach((t) => tabs.appendChild(h('div', {
      class: 'ss-tabs__tab' + (t.key === state.tab ? ' ss-tabs__tab--active' : ''),
      onclick: () => {
        if (t.key === state.tab) return;
        if (isDirty()) return toast('저장하지 않은 변경이 있습니다. 먼저 저장하세요.', 'err');
        state.tab = t.key;
        refresh();
      },
    }, t.label)));
  }

  function refresh() {
    rows = []; deleted = []; sort = { key: null, dir: null };
    paintTabs();
    clear(pane);
    const t = current();

    // 머리: 솔루션 선택 상자(라벨 글자 없이) + 행추가 · 행삭제 · 저장
    const fields = h('div', { class: 'ss-edithead__fields' });
    if (t.scoped) {
      fields.appendChild(h('div', { class: 'ss-field' },
        h('select', { class: 'ss-select', 'aria-label': '솔루션', onchange: (e) => {
          if (isDirty()) { toast('저장하지 않은 변경이 있습니다. 먼저 저장하세요.', 'err'); e.target.value = state.solution; return; }
          state.solution = e.target.value; load();
        } }, ...solutions.map((s) => h('option', { value: s.code, selected: s.code === state.solution }, s.name || s.code)))));
    }
    if (t.deploymentFilter) {
      fields.appendChild(h('div', { class: 'ss-field' },
        h('select', { class: 'ss-select', 'aria-label': '구축형태', onchange: (e) => {
          if (isDirty()) { toast('저장하지 않은 변경이 있습니다. 먼저 저장하세요.', 'err'); e.target.value = state.deployment; return; }
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

  refresh();
}

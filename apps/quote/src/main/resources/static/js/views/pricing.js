import { api } from '../api.js';
import { store } from '../app.js';
import { h, toast, clear, confirmModal, resizableColumns, numInput } from '../ui.js';

// 가격정책 = 모듈 단가(sq_modules.base_price) + 직무 단가(sq_labor_roles.base_price).
// L1 인라인 편집형 (2026-10-29 화면 재작성) — 화면 내 탭 상자 + 머리(솔루션) + 행추가/행삭제/저장 + 편집 그리드.
// 등록·수정·삭제는 팝업 없이 그리드에서. 동작은 마스터 관리와 같다(선택 60px · 칸 너비 조절 · 머리 정렬 · 콤마 입력).
// std_mm(표준투입 M/M)·비고는 보내지 않으므로 기존 값이 그대로 남는다. 네고율은 마스터에서 관리한다.
const TABS = [
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

  const state = { tab: TABS[0].key, solution: defaultSolution };
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
    pane.appendChild(h('div', { class: 'ss-edithead', style: 'margin-top:16px' }, fields,
      h('div', { class: 'ss-actions' },
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: addRow }, '행추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: removeRows }, '행삭제'),
        h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));
    if (t.note) {
      pane.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
        h('span', { class: 'ss-detailbar__note' }, t.note)));
    }

    // 첫 칸 '선택' 60px 고정, 남는 폭은 이름 칸이 받는다
    const cols = [h('col', { style: 'width:60px' }), ...t.fields.map((f) => h('col', { style: f.width ? `width:${f.width}px` : null }))];
    tbody = h('tbody');
    const table = h('table', { class: 'ss-grid', style: `min-width:${60 + t.fields.reduce((s, f) => s + (f.width || 240), 0)}px` },
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
      const { rows: list } = await api.masterList(t.type, t.scoped ? state.solution : undefined);
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
    const num = f.type !== 'text';
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
      t.fields.forEach((f) => tr.appendChild(cellEl(f, r.form)));
      tbody.appendChild(tr);
    });
  }

  function cellEl(f, form) {
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
      else if (f.type !== 'text') v = v === '' || v == null ? null : Number(v);
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
      for (const o of deleted) { await api.masterDelete(t.type, o.id); done++; }
      for (const r of creates) { await api.masterCreate(t.type, payloadOf(t, r.form, true).payload); done++; }
      for (const r of updates) { await api.masterUpdate(t.type, r.orig.id, payloadOf(t, r.form, false).payload); done++; }
      toast(`저장되었습니다. (${done}건)`, 'ok');
      store.master = null; // 견적 작성 화면이 새 단가를 다시 받게
    } catch (err) {
      toast(`${done}건 저장 후 실패: ${err.message}`, 'err');
    }
    load();
  }

  refresh();
}

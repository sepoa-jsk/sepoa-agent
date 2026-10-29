import { api } from '../api.js';
import { h, toast, clear, confirmModal, resizableColumns } from '../ui.js';

// 고객사 = sq_mst_customer (V4, 2026-10-29). 수신처는 고객사명으로 쓴다.
// L1 인라인 편집형 — 머리(검색 · 기업구분 · 채널, 라벨 글자 없이) + 행추가/행삭제/저장 + 편집 그리드.
// 동작은 가격정책·마스터 관리와 같다(선택 60px · 칸 너비 고정·조절 · 머리 정렬 · 사용 중지 행 숨김).
const CHANNELS = [['DIRECT', '직거래'], ['AGENCY', '에이전시']];

const FIELDS = [
  { key: 'code', label: '코드', type: 'text', mono: true, required: true, width: 130 },
  { key: 'name', label: '고객사명', type: 'text', required: true, width: 200 },
  { key: '_company_code', label: '기업구분코드', type: 'codeview', of: 'company_key', width: 110 },
  { key: 'company_key', label: '기업구분', type: 'preset', options: 'company', width: 150 },
  { key: 'channel', label: '채널', type: 'preset', options: CHANNELS, width: 110 },
  { key: 'contact_name', label: '담당자', type: 'text', width: 110 },
  { key: 'contact_phone', label: '연락처', type: 'text', width: 130 },
  { key: 'contact_email', label: '이메일', type: 'text', width: 180 },
  { key: 'payment_terms', label: '결제조건', type: 'text', width: 200 },
  { key: 'note', label: '비고', type: 'text', width: 240 },
  { key: 'sort', label: '정렬', type: 'number', width: 70 },
];
const DATA = FIELDS.filter((f) => f.type !== 'codeview'); // 저장하는 칸

const icon = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

export async function renderCustomers(root) {
  const filter = { q: '', company: '', channel: '' };
  let companyOpts = [];
  let rows = [];     // [{ orig, form, isNew, checked, seq }] — 지금 그리드에 있는 행(검색 조건에 맞는 것)
  let deleted = [];
  let sort = { key: null, dir: null };
  let seq = 0;
  let headCells = [];

  const optionsOf = (f) => (f.options === 'company' ? companyOpts : f.options);
  const isDirty = () => deleted.length > 0 || rows.some((r) => r.isNew || changed(r));
  const blockIfDirty = () => {
    if (!isDirty()) return false;
    toast('저장하지 않은 변경이 있습니다. 먼저 저장하세요.', 'err');
    return true;
  };

  // ── 머리: 검색 · 기업구분 · 채널 | 행추가 · 행삭제 · 저장 ──
  const qInput = h('input', { placeholder: '고객사명 · 코드', 'aria-label': '검색',
    onkeydown: (e) => { if (e.key === 'Enter') search(); } });
  const companySel = h('select', { class: 'ss-select', 'aria-label': '기업구분', onchange: () => search() });
  const channelSel = h('select', { class: 'ss-select', 'aria-label': '채널', onchange: () => search() },
    h('option', { value: '' }, '채널 전체'), ...CHANNELS.map(([v, t]) => h('option', { value: v }, t)));
  root.appendChild(h('div', { class: 'ss-edithead' },
    h('div', { class: 'ss-edithead__fields', style: 'grid-template-columns:220px 152px 152px' },
      h('div', { class: 'ss-search' }, qInput,
        h('button', { class: 'ss-search__btn', 'aria-label': '검색', html: icon.search, onclick: () => search() })),
      h('div', { class: 'ss-field' }, companySel),
      h('div', { class: 'ss-field' }, channelSel)),
    h('div', { class: 'ss-actions' },
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: addRow }, '행추가'),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: removeRows }, '행삭제'),
      h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));

  // 검색 조건을 바꿀 때 저장 안 한 변경이 있으면 조건을 되돌린다
  function search() {
    if (blockIfDirty()) {
      qInput.value = filter.q; companySel.value = filter.company; channelSel.value = filter.channel;
      return;
    }
    filter.q = qInput.value.trim(); filter.company = companySel.value; filter.channel = channelSel.value;
    load();
  }

  // ── 편집 그리드: 칸마다 정한 너비 그대로 (한 칸만 길어지지 않게) ──
  const widths = [60, ...FIELDS.map((f) => f.width)];
  const tbody = h('tbody');
  const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${widths.reduce((s, w) => s + w, 0)}px` },
    h('colgroup', {}, ...widths.map((w) => h('col', { style: `width:${w}px` }))),
    h('thead', {}, h('tr', {},
      h('th', { 'data-fixed': '' }, '선택'),
      ...(headCells = FIELDS.map((f) => h('th', {
        class: 'is-sortable' + (f.required ? ' req' : ''), title: '눌러서 정렬', onclick: () => toggleSort(f),
      }, f.label, h('span', { class: 'ss-sortmark' })))))),
    tbody);
  root.appendChild(h('div', { class: 'ss-gridwrap ss-gridwrap--fill', style: 'margin-top:12px' }, table));
  resizableColumns(table, 'quote2:customer-cols');

  const emptyRow = (text) => h('tr', {}, h('td', { colspan: FIELDS.length + 1, class: 'ss-cell--empty' }, text));
  const toForm = (row) => Object.fromEntries(DATA.map((f) => [f.key, row[f.key]]));

  async function loadCompanies() {
    try {
      const { rows: cc } = await api.masterList('company_classes');
      companyOpts = (cc || []).filter((r) => r.active).sort((a, b) => a.sort - b.sort).map((r) => [r.key, r.label]);
    } catch { companyOpts = []; }
    clear(companySel).append(h('option', { value: '' }, '기업구분 전체'),
      ...companyOpts.map(([v, t]) => h('option', { value: v }, t)));
  }

  async function load() {
    rows = []; deleted = [];
    clear(tbody).appendChild(emptyRow('불러오는 중...'));
    try {
      const { rows: list } = await api.masterList('customers');
      const q = filter.q.toLowerCase();
      const data = (list || []).filter((r) => r.active
        && (!q || String(r.name || '').toLowerCase().includes(q) || String(r.code || '').toLowerCase().includes(q))
        && (!filter.company || r.company_key === filter.company)
        && (!filter.channel || r.channel === filter.channel));
      rows = data.map((r) => ({ orig: r, form: toForm(r), isNew: false, checked: false, seq: seq++ }));
      applySort();
      paintRows();
    } catch (err) {
      clear(tbody).appendChild(emptyRow(err.message));
    }
  }

  // 새 행은 머리에서 고른 기업구분 · 채널로 시작한다
  function addRow() {
    const form = Object.fromEntries(DATA.map((f) => [f.key, null]));
    form.company_key = filter.company || null;
    form.channel = filter.channel || null;
    form.sort = rows.length + 1;
    rows.push({ orig: null, form, isNew: true, checked: false, seq: seq++ });
    paintRows();
    tbody.lastElementChild?.querySelector('input.ss-cellinput')?.focus();
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
      const on = FIELDS[i].key === sort.key;
      th.querySelector('.ss-sortmark').textContent = on ? (sort.dir === 'asc' ? '▲' : '▼') : '';
      th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    applySort();
    paintRows();
  }

  function applySort() {
    const f = sort.key && FIELDS.find((x) => x.key === sort.key);
    if (!f) { rows.sort((a, b) => a.seq - b.seq); return; }
    const num = f.type === 'number';
    const val = (r) => {
      const v = f.type === 'codeview' ? r.form[f.of]
        : f.type === 'preset' ? ((optionsOf(f).find(([k]) => k === r.form[f.key]) || [])[1] ?? r.form[f.key])
          : r.form[f.key];
      return v == null || v === '' ? null : num ? Number(v) : String(v);
    };
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return x == null && y == null ? a.seq - b.seq : x == null ? 1 : -1;
      const c = num ? x - y : x.localeCompare(y, 'ko', { numeric: true });
      return c ? c * dir : a.seq - b.seq;
    });
  }

  function paintRows() {
    clear(tbody);
    if (!rows.length) { tbody.appendChild(emptyRow('데이터가 없습니다. 행추가로 등록하세요.')); return; }
    rows.forEach((r) => tbody.appendChild(rowEl(r)));
  }

  function rowEl(r) {
    const tr = h('tr', { class: r.isNew ? 'is-new' : null },
      h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })));
    FIELDS.forEach((f) => tr.appendChild(cellEl(f, r, () => tr.replaceWith(rowEl(r)))));
    return tr;
  }

  function cellEl(f, r, repaint) {
    const form = r.form;
    if (f.type === 'codeview') return h('td', { class: 'ss-cell--link' }, form[f.of] || '');
    if (f.type === 'preset') {
      return h('td', { class: 'ss-cell--input' }, h('select', { class: 'ss-cellinput', 'aria-label': f.label,
        onchange: (e) => { form[f.key] = e.target.value || null; repaint(); } }, // 코드 보기 칸을 다시 그린다
      h('option', { value: '', selected: !form[f.key] }, '선택'),
      ...optionsOf(f).map(([v, t]) => h('option', { value: v, selected: v === form[f.key] }, t))));
    }
    const attrs = { class: 'ss-cellinput', 'aria-label': f.label,
      style: f.key === 'sort' || f.mono ? 'text-align:center' : null };
    const inp = h('input', { ...attrs, type: 'text', inputMode: f.type === 'number' ? 'numeric' : null, value: form[f.key] ?? '',
      oninput: (e) => {
        if (f.type === 'number') e.target.value = e.target.value.replace(/[^\d-]/g, '');
        form[f.key] = e.target.value;
      } });
    return h('td', { class: 'ss-cell--input' + (f.mono ? ' ss-cell--link' : '') }, inp);
  }

  function payloadOf(form, isNew) {
    const payload = {};
    let missing = null;
    DATA.forEach((f) => {
      let v = form[f.key];
      if (f.type === 'number') v = v === '' || v == null ? 0 : Number(v);
      else if (f.type === 'preset') v = v || null;
      else v = v == null || String(v).trim() === '' ? null : String(v).trim();
      if (f.required && v == null) missing = missing || f.label;
      payload[f.key] = v;
    });
    if (isNew) payload.active = 1;
    return { payload, missing };
  }

  function changed(r) {
    if (r.isNew) return true;
    return JSON.stringify(payloadOf(r.form, false).payload) !== JSON.stringify(payloadOf(toForm(r.orig), false).payload);
  }

  async function save() {
    const creates = rows.filter((r) => r.isNew);
    const updates = rows.filter((r) => !r.isNew && changed(r));
    if (!creates.length && !updates.length && !deleted.length) return toast('변경된 내용이 없습니다.', 'ok');
    for (const r of [...creates, ...updates]) {
      const { missing } = payloadOf(r.form, r.isNew);
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
      for (const o of deleted) { await api.masterDelete('customers', o.id); done++; }
      for (const r of creates) { await api.masterCreate('customers', payloadOf(r.form, true).payload); done++; }
      for (const r of updates) { await api.masterUpdate('customers', r.orig.id, payloadOf(r.form, false).payload); done++; }
      toast(`저장되었습니다. (${done}건)`, 'ok');
    } catch (err) {
      // 화면에 안 보이는(검색에서 빠졌거나 사용 중지한) 고객사와 코드가 겹치면 서버가 막는다
      toast(`${done}건 저장 후 실패: ${err.status === 409 || /중복/.test(err.message) ? '이미 있는 코드입니다.' : err.message}`, 'err');
    }
    load();
  }

  await loadCompanies();
  load();
}

import { api } from '../api.js';
import { store } from '../app.js';
import { h, toast, clear, confirmModal, openModal, debounce, resizableColumns } from '../ui.js';

// 고객사관리 = sq_mst_customer (V4, 2026-10-29). 수신처는 고객사명으로 쓴다.
// L1 조회형(인라인 편집) — 2026-10-31 공통 패턴으로 다시 맞춤:
//   툴바 좌: Search(고객사명 · 코드, 입력하면 바로 걸린다) → 필터(솔루션 · 기업구분 · 채널) 상자 / 우: 행추가 · 행삭제 · 저장
//   걸린 조건은 필터칩 줄, 건수는 명세바 오른쪽. 거르기만 하므로 고치던 값은 조건을 바꿔도 남는다.
// 코드는 자동 채번(서버 — 새 행을 저장할 때 C0001 …). 기업구분코드 · 정렬 칸은 뺐다(목록은 고객사명 순).
// 사용 솔루션(V12) — 한 고객사가 여러 솔루션을 쓸 수 있다. 칸을 누르면 체크로 고른다. V12 전 DB 에서는 칸이 보이지 않는다.
// 채널 — 고객사와 바로 하는지, 컨설팅펌 · SI 업체 등을 끼고 하는지(2026-11-02 사용자 요청으로 이름만 바꿈, 코드는 그대로)
export const CHANNELS = [['DIRECT', '직접 (고객사)'], ['AGENCY', '간접 (컨설팅펌 · SI 경유)']];

const FIELDS = [
  { key: 'code', label: '코드', type: 'auto', width: 100 },
  { key: 'name', label: '고객사명', type: 'text', required: true, width: 200 },
  { key: 'solutions', label: '사용 솔루션', type: 'multi', width: 200, v12: true },
  { key: 'company_key', label: '기업구분', type: 'preset', options: 'company', width: 140 },
  { key: 'channel', label: '채널', type: 'preset', options: CHANNELS, width: 110 },
  { key: 'contact_name', label: '담당자', type: 'text', width: 110 },
  { key: 'contact_phone', label: '연락처', type: 'text', width: 130 },
  { key: 'contact_email', label: '이메일', type: 'text', width: 200 },
  { key: 'payment_terms', label: '결제조건', type: 'text', width: 200 },
  { key: 'note', label: '비고', type: 'text', width: 240 },
];

const icon = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  filter: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18l-7 8v7l-4 2v-9z"/></svg>',
};
const splitSol = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export async function renderCustomers(root) {
  const filter = { q: '', solution: '', company: '', channel: '' };
  let companyOpts = [];
  const solutionOpts = (store.master?.solutions || []).map((s) => [s.code, s.name]);
  let hasSol = false; // V12 칸이 있는가(서버가 has_solutions 로 알려 준다)
  let rows = [];     // [{ orig, form, isNew, checked, seq }] — 사용 중인 고객사 전부. 화면에는 조건에 맞는 것만 그린다
  let deleted = [];
  let sort = { key: null, dir: null };
  let seq = 0;

  const fields = () => FIELDS.filter((f) => !f.v12 || hasSol);
  const optionsOf = (f) => (f.options === 'company' ? companyOpts : f.options);
  const solName = (code) => (solutionOpts.find(([c]) => c === code) || [])[1] || code;
  const nameOf = (opts, v) => (opts.find(([k]) => k === v) || [])[1] || v;

  // ── 툴바 좌: Search ──
  const applyQ = () => { filter.q = qInput.value.trim().toLowerCase(); paintRows(); };
  const qInput = h('input', { placeholder: 'Search', 'aria-label': '고객사명 · 코드 검색', oninput: debounce(applyQ, 250) });
  const search = h('div', { class: 'ss-search' }, qInput,
    h('button', { class: 'ss-search__btn', 'aria-label': '검색', html: icon.search, onclick: applyQ }));

  // ── 필터: 상세 검색 팝오버 (솔루션 · 기업구분 · 채널) ──
  const solSel = h('select', { class: 'ss-select' }, h('option', { value: '' }, '전체'), ...solutionOpts.map(([v, t]) => h('option', { value: v }, t)));
  const companySel = h('select', { class: 'ss-select' });
  const channelSel = h('select', { class: 'ss-select' }, h('option', { value: '' }, '전체'), ...CHANNELS.map(([v, t]) => h('option', { value: v }, t)));
  const solRow = h('div', { class: 'ss-popover__row' }, h('label', {}, '솔루션'), solSel);
  const popover = h('div', { class: 'ss-popover', hidden: true },
    h('div', { class: 'ss-popover__head' }, '상세 검색',
      h('button', { class: 'ss-popover__close', 'aria-label': '닫기', html: '&times;', onclick: () => { popover.hidden = true; } })),
    h('div', { class: 'ss-popover__body' },
      h('div', { class: 'ss-popover__actions' },
        h('button', { class: 'ss-btn ss-btn--save', onclick: () => {
          filter.solution = solSel.value; filter.company = companySel.value; filter.channel = channelSel.value;
          popover.hidden = true;
          paintRows();
        } }, '조회'),
        h('button', { class: 'ss-btn ss-btn--default', onclick: () => {
          solSel.value = ''; companySel.value = ''; channelSel.value = '';
          filter.solution = ''; filter.company = ''; filter.channel = '';
          paintRows();
        } }, '초기화')),
      solRow,
      h('div', { class: 'ss-popover__row' }, h('label', {}, '기업구분'), companySel),
      h('div', { class: 'ss-popover__row' }, h('label', {}, '채널'), channelSel)));
  const filterBtn = h('button', { class: 'ss-tbtn', onclick: (e) => { e.stopPropagation(); popover.hidden = !popover.hidden; } },
    h('span', { class: 'ss-tbtn__ico--filter', html: icon.filter }), ' 필터');

  const outside = (e) => {
    if (!root.isConnected) { document.removeEventListener('click', outside); return; }
    if (!popover.contains(e.target)) popover.hidden = true;
  };
  document.addEventListener('click', outside);

  root.appendChild(h('div', { class: 'ss-toolbar' },
    search,
    h('div', { class: 'ss-toolbar__tools' }, h('div', { class: 'ss-dropdown' }, filterBtn, popover)),
    h('div', { class: 'ss-toolbar__spacer' }),
    h('div', { class: 'ss-actions' },
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: addRow }, '행추가'),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: removeRows }, '행삭제'),
      h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));

  const chips = h('div', { class: 'ss-chips', hidden: true });
  root.appendChild(chips);
  const note = h('div', { class: 'ss-detailbar' });
  root.appendChild(note);
  const gridBox = h('div', { class: 'ss-gridwrap ss-gridwrap--fill', style: 'margin-top:8px' });
  root.appendChild(gridBox);

  const toForm = (row) => Object.fromEntries(FIELDS.map((f) => [f.key, row[f.key]]));

  async function loadCompanies() {
    try {
      const { rows: cc } = await api.masterList('company_classes');
      // 기업구분은 솔루션 · 구축형태마다 행이 있다 — key 로 한 번만
      const seen = new Map();
      for (const r of (cc || []).filter((x) => x.active).sort((a, b) => a.sort - b.sort)) if (!seen.has(r.key)) seen.set(r.key, r.label);
      companyOpts = [...seen];
    } catch { companyOpts = []; }
    clear(companySel).append(h('option', { value: '' }, '전체'), ...companyOpts.map(([v, t]) => h('option', { value: v }, t)));
  }

  async function load() {
    rows = []; deleted = [];
    clear(gridBox).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '불러오는 중...'));
    try {
      const { rows: list, has_solutions: hs } = await api.masterList('customers');
      hasSol = !!hs;
      solRow.hidden = !hasSol;
      rows = (list || []).filter((r) => r.active)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'))
        .map((r) => ({ orig: r, form: toForm(r), isNew: false, checked: false, seq: seq++ }));
      paintRows();
    } catch (err) {
      clear(gridBox).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, err.message));
    }
  }

  const visible = () => {
    const q = filter.q;
    return rows.filter((r) => r.isNew || ((!q || String(r.form.name || '').toLowerCase().includes(q) || String(r.form.code || '').toLowerCase().includes(q))
      && (!filter.solution || splitSol(r.form.solutions).includes(filter.solution))
      && (!filter.company || r.form.company_key === filter.company)
      && (!filter.channel || r.form.channel === filter.channel)));
  };

  // 새 행은 필터에서 고른 솔루션 · 기업구분 · 채널로 시작한다
  function addRow() {
    const form = Object.fromEntries(FIELDS.map((f) => [f.key, null]));
    form.solutions = filter.solution || null;
    form.company_key = filter.company || null;
    form.channel = filter.channel || null;
    rows.push({ orig: null, form, isNew: true, checked: false, seq: seq++ });
    paintRows();
    gridBox.querySelector('tbody tr:last-child input.ss-cellinput')?.focus();
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
    paintRows();
  }

  function sorted(list) {
    const f = sort.key && FIELDS.find((x) => x.key === sort.key);
    if (!f) return [...list].sort((a, b) => a.seq - b.seq);
    const val = (r) => {
      const v = f.type === 'preset' ? nameOf(optionsOf(f), r.form[f.key])
        : f.type === 'multi' ? splitSol(r.form[f.key]).map(solName).join(', ') : r.form[f.key];
      return v == null || v === '' ? null : String(v);
    };
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return x == null && y == null ? a.seq - b.seq : x == null ? 1 : -1;
      const c = x.localeCompare(y, 'ko', { numeric: true });
      return c ? c * dir : a.seq - b.seq;
    });
  }

  function paintChips() {
    clear(chips);
    const list = [];
    if (filter.q) list.push(['검색어 ' + filter.q, () => { filter.q = ''; qInput.value = ''; }]);
    if (filter.solution) list.push(['솔루션 ' + solName(filter.solution), () => { filter.solution = ''; solSel.value = ''; }]);
    if (filter.company) list.push(['기업구분 ' + nameOf(companyOpts, filter.company), () => { filter.company = ''; companySel.value = ''; }]);
    if (filter.channel) list.push(['채널 ' + nameOf(CHANNELS, filter.channel), () => { filter.channel = ''; channelSel.value = ''; }]);
    chips.hidden = !list.length;
    filterBtn.classList.toggle('is-active', !!(filter.solution || filter.company || filter.channel));
    if (!list.length) return;
    chips.appendChild(h('span', {}, '필터 조건'));
    for (const [label, off] of list) {
      chips.appendChild(h('span', { class: 'ss-chip' }, label,
        h('span', { style: 'cursor:pointer', title: '제거', html: '&times;', onclick: () => { off(); paintRows(); } })));
    }
    chips.appendChild(h('span', { style: 'cursor:pointer', title: '전체 지우기', html: '&#9003;', onclick: () => {
      Object.assign(filter, { q: '', solution: '', company: '', channel: '' });
      qInput.value = ''; solSel.value = ''; companySel.value = ''; channelSel.value = '';
      paintRows();
    } }));
  }

  function paintRows() {
    paintChips();
    const fs = fields();
    const list = sorted(visible());
    const widths = [60, ...fs.map((f) => f.width)];
    const tbody = h('tbody');
    if (!list.length) tbody.appendChild(h('tr', {}, h('td', { colspan: fs.length + 1, class: 'ss-cell--empty' }, rows.length ? '조건에 맞는 고객사가 없습니다.' : '데이터가 없습니다. 행추가로 등록하세요.')));
    list.forEach((r) => tbody.appendChild(rowEl(r, fs)));
    const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${widths.reduce((s, w) => s + w, 0)}px` },
      h('colgroup', {}, ...widths.map((w) => h('col', { style: `width:${w}px` }))),
      h('thead', {}, h('tr', {},
        h('th', { 'data-fixed': '' }, '선택'),
        ...fs.map((f) => {
          const on = sort.key === f.key;
          return h('th', { class: 'is-sortable' + (f.required ? ' req' : ''), title: '눌러서 정렬', onclick: () => toggleSort(f),
            'aria-sort': on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
          f.label, h('span', { class: 'ss-sortmark' }, on ? (sort.dir === 'asc' ? '▲' : '▼') : ''));
        }))),
      tbody);
    clear(gridBox).appendChild(table);
    resizableColumns(table, `quote2:customer-cols2:${hasSol ? 'sol' : 'base'}`);
    clear(note).append(h('span', { class: 'ss-detailbar__note' }, '코드는 저장할 때 자동으로 붙습니다. 행삭제한 고객사는 사용 중지됩니다.'),
      h('div', { class: 'ss-detailbar__spacer' }),
      h('span', { class: 'ss-detailbar__count' }, h('b', {}, String(list.length)), ' 건'));
  }

  function rowEl(r, fs) {
    const tr = h('tr', { class: r.isNew ? 'is-new' : null },
      h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })));
    fs.forEach((f) => tr.appendChild(cellEl(f, r, () => tr.replaceWith(rowEl(r, fs)))));
    return tr;
  }

  function cellEl(f, r, repaint) {
    const form = r.form;
    if (f.type === 'auto') {
      return h('td', { class: 'ss-cell--link', style: 'text-align:center' }, form.code || h('span', { style: 'color:var(--ss-ink-3);font-weight:400' }, '자동'));
    }
    if (f.type === 'multi') {
      const names = splitSol(form[f.key]).map(solName).join(', ');
      return h('td', { class: 'ss-cell--input' }, h('button', { type: 'button', class: 'ss-cellinput', title: '눌러서 고르기',
        style: 'text-align:left;cursor:pointer;background:none;border:0;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
        onclick: () => pickSolutions(form[f.key], (v) => { form[f.key] = v; repaint(); }) },
      names || h('span', { style: 'color:var(--ss-ink-3)' }, '선택')));
    }
    if (f.type === 'preset') {
      return h('td', { class: 'ss-cell--input' }, h('select', { class: 'ss-cellinput', 'aria-label': f.label,
        onchange: (e) => { form[f.key] = e.target.value || null; } },
      h('option', { value: '', selected: !form[f.key] }, '선택'),
      ...optionsOf(f).map(([v, t]) => h('option', { value: v, selected: v === form[f.key] }, t))));
    }
    return h('td', { class: 'ss-cell--input' }, h('input', { class: 'ss-cellinput', 'aria-label': f.label, type: 'text', value: form[f.key] ?? '',
      oninput: (e) => { form[f.key] = e.target.value; } }));
  }

  // 사용 솔루션 고르기 — 체크(여러 개). 솔루션 마스터 순서대로 'PROCURE,SEAL' 로 담는다
  function pickSolutions(value, onDone) {
    const cur = new Set(splitSol(value));
    const boxes = solutionOpts.map(([code, name]) => {
      const cb = h('input', { type: 'checkbox', checked: cur.has(code), value: code });
      return h('label', { style: 'display:flex;align-items:center;gap:8px;padding:6px 2px;font-size:13px;cursor:pointer' }, cb, name, h('span', { style: 'color:var(--ss-ink-3);font-size:11px' }, code));
    });
    const m = openModal({
      title: '사용 솔루션',
      body: h('div', {}, ...boxes),
      footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'),
        h('button', { class: 'btn btn-primary', onclick: () => {
          const v = boxes.map((b) => b.querySelector('input')).filter((cb) => cb.checked).map((cb) => cb.value).join(',');
          m.close();
          onDone(v || null);
        } }, '확인')],
    });
    m.back.querySelector('.modal').style.width = '320px';
  }

  function payloadOf(form, isNew) {
    const payload = {};
    let missing = null;
    FIELDS.forEach((f) => {
      if (f.type === 'auto') return; // 코드는 서버가 붙인다(새 행) · 바꾸지 않는다(기존 행)
      if (f.v12 && !hasSol) return;
      let v = form[f.key];
      if (f.type === 'preset' || f.type === 'multi') v = v || null;
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
      toast(`${done}건 저장 후 실패: ${err.message}`, 'err');
    }
    load();
  }

  await loadCompanies();
  load();
}

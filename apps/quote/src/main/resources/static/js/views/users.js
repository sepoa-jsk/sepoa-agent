import { api } from '../api.js';
import { h, toast, clear, debounce, resizableColumns } from '../ui.js';

// 사용자관리(시스템관리) — 2026-10-31. 로그인한 적 있는 계정 목록(sq_users).
// 계정은 처음 로그인할 때 저절로 생긴다(Google 로그인 · 회사 도메인) — 여기서 새로 만들거나 비밀번호를 다루지 않는다.
// 고치는 칸: 관리자 여부 · 부서 · 직위 · 업무 역할 · 사용(중지하면 로그인 불가). 바뀐 내용은 그 사람이 다시 로그인하면 반영된다.
// 부서 · 직위 · 역할 · 사용 칸은 DB 변경(V10) 뒤에 나온다 — 그 전에는 관리자 여부만 고친다.
// L1 조회형 — 툴바 좌: Search(이름 · 계정, 입력하면 바로 걸린다) → 필터(관리자 여부 · 부서 · 업무 역할) · 상태(사용 · 중지) 상자 / 우: 저장.
//   걸린 조건은 필터칩 줄, 건수는 명세바 오른쪽. 거르기만 하므로 고치던 값은 조건을 바꿔도 남는다.
const ADMIN_OPTS = [['ADMIN', '관리자'], ['USER', '일반']];
const ACTIVE_OPTS = [['1', '사용'], ['0', '중지']];
const STATUS_OPTS = [['', '전체'], ...ACTIVE_OPTS];
const icon = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  filter: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18l-7 8v7l-4 2v-9z"/></svg>',
  status: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="10" width="4" height="11"/><rect x="10" y="4" width="4" height="17"/><rect x="17" y="13" width="4" height="8"/></svg>',
};
const when = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '-');

export async function renderUsers(root) {
  let org = false;
  let depts = [];
  let roles = [];
  let rows = []; // [{ orig, form }]
  const filter = { q: '', admin: '', dept: '', role: '', active: '' };

  // ── 툴바 좌: Search ──
  const applyQ = () => { filter.q = qInput.value.trim().toLowerCase(); paint(); };
  const qInput = h('input', { placeholder: 'Search', 'aria-label': '이름 · 계정 검색', oninput: debounce(applyQ, 250) });
  const search = h('div', { class: 'ss-search' }, qInput,
    h('button', { class: 'ss-search__btn', 'aria-label': '검색', html: icon.search, onclick: applyQ }));

  // ── 필터: 상세 검색 팝오버 (관리자 여부 · 부서 · 업무 역할) ──
  const adminSel = h('select', { class: 'ss-select' }, h('option', { value: '' }, '전체'), ...ADMIN_OPTS.map(([v, t]) => h('option', { value: v }, t)));
  const deptSel = h('select', { class: 'ss-select' });
  const roleSel = h('select', { class: 'ss-select' });
  const orgRows = [
    h('div', { class: 'ss-popover__row' }, h('label', {}, '부서'), deptSel),
    h('div', { class: 'ss-popover__row' }, h('label', {}, '업무 역할'), roleSel),
  ];
  const popover = h('div', { class: 'ss-popover', hidden: true },
    h('div', { class: 'ss-popover__head' }, '상세 검색',
      h('button', { class: 'ss-popover__close', 'aria-label': '닫기', html: '&times;', onclick: () => { popover.hidden = true; } })),
    h('div', { class: 'ss-popover__body' },
      h('div', { class: 'ss-popover__actions' },
        h('button', { class: 'ss-btn ss-btn--save', onclick: () => {
          filter.admin = adminSel.value; filter.dept = deptSel.value; filter.role = roleSel.value;
          popover.hidden = true;
          paint();
        } }, '조회'),
        h('button', { class: 'ss-btn ss-btn--default', onclick: () => {
          adminSel.value = ''; deptSel.value = ''; roleSel.value = '';
          filter.admin = ''; filter.dept = ''; filter.role = '';
          paint();
        } }, '초기화')),
      h('div', { class: 'ss-popover__row' }, h('label', {}, '관리자 여부'), adminSel), ...orgRows));
  const filterBtn = h('button', { class: 'ss-tbtn', onclick: (e) => { e.stopPropagation(); statusMenu.hidden = true; popover.hidden = !popover.hidden; } },
    h('span', { class: 'ss-tbtn__ico--filter', html: icon.filter }), ' 필터');

  // ── 상태 드롭다운 (사용 · 중지) ──
  const statusMenu = h('div', { class: 'ss-dropdown__menu', hidden: true });
  const statusBtn = h('button', { class: 'ss-tbtn', onclick: (e) => { e.stopPropagation(); popover.hidden = true; statusMenu.hidden = !statusMenu.hidden; } },
    h('span', { class: 'ss-tbtn__ico--status', html: icon.status }), ' 상태');
  const paintStatusMenu = () => {
    clear(statusMenu);
    for (const [v, label] of STATUS_OPTS) {
      statusMenu.appendChild(h('button', { class: 'ss-dropdown__item' + (filter.active === v ? ' is-active' : ''),
        onclick: () => { filter.active = v; statusMenu.hidden = true; paint(); } }, label));
    }
  };

  // 팝오버 · 드롭다운 바깥을 누르면 닫는다
  const outside = (e) => {
    if (!root.isConnected) { document.removeEventListener('click', outside); return; }
    if (!popover.contains(e.target)) popover.hidden = true;
    if (!statusMenu.contains(e.target)) statusMenu.hidden = true;
  };
  document.addEventListener('click', outside);

  root.appendChild(h('div', { class: 'ss-toolbar' },
    search,
    h('div', { class: 'ss-toolbar__tools' },
      h('div', { class: 'ss-dropdown' }, filterBtn, popover),
      h('div', { class: 'ss-dropdown' }, statusBtn, statusMenu)),
    h('div', { class: 'ss-toolbar__spacer' }),
    h('div', { class: 'ss-actions' }, h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));

  // ── 필터칩: 걸린 조건이 있을 때만 ──
  const chips = h('div', { class: 'ss-chips', hidden: true });
  root.appendChild(chips);
  // ── 명세바: 좌 안내 / 우 건수 ──
  const note = h('div', { class: 'ss-detailbar' });
  root.appendChild(note);
  const gridBox = h('div', { class: 'ss-gridwrap ss-gridwrap--fill', style: 'margin-top:8px' });
  root.appendChild(gridBox);

  const cols = () => [
    { key: 'name', label: '이름', width: 120, ro: true },
    { key: 'email', label: '계정', width: 240, ro: true, link: true },
    { key: 'role', label: '관리자 여부', width: 120, options: ADMIN_OPTS },
    ...(org ? [
      { key: 'dept_code', label: '부서', width: 150, options: depts.filter((d) => d.active).map((d) => [d.code, d.name]), blank: '미지정' },
      { key: 'position', label: '직위', width: 100 },
      { key: 'role_code', label: '업무 역할', width: 140, options: roles.filter((r) => r.active).map((r) => [r.code, r.name]), blank: '미지정' },
      { key: 'active', label: '사용', width: 80, options: ACTIVE_OPTS },
    ] : []),
    { key: 'last_login_at', label: '최근 로그인', width: 140, ro: true, date: true },
    { key: 'created_at', label: '등록일', width: 140, ro: true, date: true },
  ];
  const editKeys = () => cols().filter((c) => !c.ro).map((c) => c.key);
  const formOf = (u) => Object.fromEntries(editKeys().map((k) => [k, k === 'active' ? String(u.active ?? 1) : (u[k] ?? '')]));
  const changed = (r) => editKeys().some((k) => String(r.form[k] ?? '') !== String(formOf(r.orig)[k] ?? ''));

  const nameOf = (list, code) => (list.find((x) => x.code === code) || {}).name || code;
  function paintChips() {
    clear(chips);
    const list = [];
    if (filter.q) list.push(['검색어 ' + filter.q, () => { filter.q = ''; qInput.value = ''; }]);
    if (filter.admin) list.push(['관리자 여부 ' + ADMIN_OPTS.find(([v]) => v === filter.admin)[1], () => { filter.admin = ''; adminSel.value = ''; }]);
    if (filter.dept) list.push(['부서 ' + nameOf(depts, filter.dept), () => { filter.dept = ''; deptSel.value = ''; }]);
    if (filter.role) list.push(['업무 역할 ' + nameOf(roles, filter.role), () => { filter.role = ''; roleSel.value = ''; }]);
    if (filter.active) list.push(['상태 ' + ACTIVE_OPTS.find(([v]) => v === filter.active)[1], () => { filter.active = ''; }]);
    chips.hidden = !list.length;
    filterBtn.classList.toggle('is-active', !!(filter.admin || filter.dept || filter.role));
    statusBtn.classList.toggle('is-active', !!filter.active);
    paintStatusMenu();
    if (!list.length) return;
    chips.appendChild(h('span', {}, '필터 조건'));
    for (const [label, off] of list) {
      chips.appendChild(h('span', { class: 'ss-chip' }, label,
        h('span', { style: 'cursor:pointer', title: '제거', html: '&times;', onclick: () => { off(); paint(); } })));
    }
    chips.appendChild(h('span', { style: 'cursor:pointer', title: '전체 지우기', html: '&#9003;', onclick: () => {
      Object.assign(filter, { q: '', admin: '', dept: '', role: '', active: '' });
      qInput.value = ''; adminSel.value = ''; deptSel.value = ''; roleSel.value = '';
      paint();
    } }));
  }

  function paint() {
    const list = rows.filter(({ orig: u }) => (!filter.q || String(u.name || '').toLowerCase().includes(filter.q) || String(u.email).toLowerCase().includes(filter.q))
      && (!filter.admin || u.role === filter.admin) && (!filter.dept || u.dept_code === filter.dept)
      && (!filter.role || u.role_code === filter.role) && (!filter.active || String(u.active ?? 1) === filter.active));
    paintChips();
    const cs = cols();
    const tbody = h('tbody');
    for (const r of list) {
      const tr = h('tr', {});
      for (const c of cs) {
        if (c.ro) {
          tr.appendChild(h('td', { class: c.link ? 'ss-cell--link' : null, style: c.date ? 'text-align:center' : null },
            c.date ? when(r.orig[c.key]) : (r.orig[c.key] ?? '')));
        } else if (c.options) {
          tr.appendChild(h('td', { class: 'ss-cell--input' }, h('select', { class: 'ss-cellinput', 'aria-label': c.label,
            onchange: (e) => { r.form[c.key] = e.target.value; } },
          ...(c.blank ? [h('option', { value: '', selected: !r.form[c.key] }, c.blank)] : []),
          ...c.options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(r.form[c.key]) }, t)))));
        } else {
          tr.appendChild(h('td', { class: 'ss-cell--input' }, h('input', { class: 'ss-cellinput', value: r.form[c.key] ?? '', 'aria-label': c.label,
            oninput: (e) => { r.form[c.key] = e.target.value; } })));
        }
      }
      if (r.orig.active === 0) tr.style.opacity = '.55';
      tbody.appendChild(tr);
    }
    if (!list.length) tbody.appendChild(h('tr', {}, h('td', { colspan: cs.length, class: 'ss-cell--empty' }, '사용자가 없습니다.')));
    const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${cs.reduce((a, c) => a + c.width, 0)}px` },
      h('colgroup', {}, ...cs.map((c) => h('col', { style: `width:${c.width}px` }))),
      h('thead', {}, h('tr', {}, ...cs.map((c) => h('th', {}, c.label)))),
      tbody);
    clear(gridBox).appendChild(table);
    resizableColumns(table, `quote2:user-cols:${org ? 'org' : 'base'}`);
    clear(note).append(h('span', { class: 'ss-detailbar__note' }, org
      ? '계정은 처음 로그인할 때 생깁니다. 사용을 중지하면 로그인할 수 없습니다. 바꾼 권한은 그 사람이 다시 로그인하면 반영됩니다.'
      : '부서 · 직위 · 업무 역할 · 사용 칸은 DB 변경(V10) 적용 후 나옵니다. 지금은 관리자 여부만 고칠 수 있습니다.'),
    h('div', { class: 'ss-detailbar__spacer' }),
    h('span', { class: 'ss-detailbar__count' }, h('b', {}, String(list.length)), ' 건'));
  }

  async function save() {
    const list = rows.filter(changed);
    if (!list.length) return toast('변경된 내용이 없습니다.', 'ok');
    let done = 0;
    try {
      for (const r of list) {
        const body = {};
        for (const k of editKeys()) if (String(r.form[k] ?? '') !== String(formOf(r.orig)[k] ?? '')) body[k] = k === 'active' ? Number(r.form[k]) : (r.form[k] || null);
        await api.updateUser(r.orig.id, body);
        done++;
      }
      toast(`저장되었습니다. (${done}건)`, 'ok');
    } catch (err) {
      toast(`${done}건 저장 후 실패: ${err.message}`, 'err');
    }
    load();
  }

  async function load() {
    try {
      const r = await api.users();
      org = !!r.org;
      if (org) {
        [depts, roles] = await Promise.all([
          api.depts().then((x) => x.rows || []).catch(() => []),
          api.roles().then((x) => x.roles || []).catch(() => []),
        ]);
      }
      rows = (r.users || []).map((u) => ({ orig: u, form: formOf(u) }));
      orgRows.forEach((el) => { el.hidden = !org; });
      clear(deptSel).append(h('option', { value: '' }, '전체'), ...depts.filter((d) => d.active).map((d) => h('option', { value: d.code }, d.name)));
      clear(roleSel).append(h('option', { value: '' }, '전체'), ...roles.filter((x) => x.active).map((x) => h('option', { value: x.code }, x.name)));
      deptSel.value = filter.dept; roleSel.value = filter.role;
      paint();
    } catch (err) {
      clear(gridBox).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, err.message));
    }
  }
  load();
}

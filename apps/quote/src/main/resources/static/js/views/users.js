import { api } from '../api.js';
import { h, toast, clear, resizableColumns } from '../ui.js';

// 사용자(시스템관리) — 2026-10-31. 로그인한 적 있는 계정 목록(sq_users).
// 계정은 처음 로그인할 때 저절로 생긴다(Google 로그인 · 회사 도메인) — 여기서 새로 만들거나 비밀번호를 다루지 않는다.
// 고치는 칸: 관리자 여부 · 부서 · 직위 · 업무 역할 · 사용(중지하면 로그인 불가). 바뀐 내용은 그 사람이 다시 로그인하면 반영된다.
// 부서 · 직위 · 역할 · 사용 칸은 DB 변경(V10) 뒤에 나온다 — 그 전에는 관리자 여부만 고친다.
const ADMIN_OPTS = [['ADMIN', '관리자'], ['USER', '일반']];
const ACTIVE_OPTS = [['1', '사용'], ['0', '중지']];
const icon = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};
const when = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '-');

export async function renderUsers(root) {
  let org = false;
  let depts = [];
  let roles = [];
  let rows = []; // [{ orig, form }]
  const filter = { q: '', admin: '', dept: '' };

  const qInput = h('input', { placeholder: '이름 · 계정', 'aria-label': '검색', onkeydown: (e) => { if (e.key === 'Enter') search(); } });
  const adminSel = h('select', { class: 'ss-select', 'aria-label': '관리자 여부', onchange: () => search() },
    h('option', { value: '' }, '관리자 여부 전체'), ...ADMIN_OPTS.map(([v, t]) => h('option', { value: v }, t)));
  const deptSel = h('select', { class: 'ss-select', 'aria-label': '부서', onchange: () => search() });
  const fields = h('div', { class: 'ss-edithead__fields', style: 'grid-template-columns:220px 152px 152px' },
    h('div', { class: 'ss-search' }, qInput, h('button', { class: 'ss-search__btn', 'aria-label': '검색', html: icon.search, onclick: () => search() })),
    h('div', { class: 'ss-field' }, adminSel), h('div', { class: 'ss-field' }, deptSel));
  root.appendChild(h('div', { class: 'ss-edithead' }, fields,
    h('div', { class: 'ss-actions' }, h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));
  const note = h('div', { class: 'ss-detailbar', style: 'margin-top:12px' });
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

  function search() {
    if (rows.some(changed)) {
      toast('저장하지 않은 변경이 있습니다. 먼저 저장하세요.', 'err');
      qInput.value = filter.q; adminSel.value = filter.admin; deptSel.value = filter.dept;
      return;
    }
    filter.q = qInput.value.trim().toLowerCase(); filter.admin = adminSel.value; filter.dept = deptSel.value;
    paint();
  }

  function paint() {
    const list = rows.filter(({ orig: u }) => (!filter.q || String(u.name || '').toLowerCase().includes(filter.q) || String(u.email).toLowerCase().includes(filter.q))
      && (!filter.admin || u.role === filter.admin) && (!filter.dept || u.dept_code === filter.dept));
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
    clear(note).append(h('span', { style: 'font-size:12.5px;color:var(--ss-ink-2)' }, `사용자 ${list.length}명 / 전체 ${rows.length}명`),
      h('div', { class: 'ss-detailbar__spacer' }),
      h('span', { class: 'ss-detailbar__note' }, org
        ? '계정은 처음 로그인할 때 생깁니다. 사용을 중지하면 로그인할 수 없습니다. 바꾼 권한은 그 사람이 다시 로그인하면 반영됩니다.'
        : '부서 · 직위 · 업무 역할 · 사용 칸은 DB 변경(V10) 적용 후 나옵니다. 지금은 관리자 여부만 고칠 수 있습니다.'));
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
      deptSel.style.display = org ? '' : 'none';
      clear(deptSel).append(h('option', { value: '' }, '부서 전체'), ...depts.filter((d) => d.active).map((d) => h('option', { value: d.code }, d.name)));
      paint();
    } catch (err) {
      clear(gridBox).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, err.message));
    }
  }
  load();
}

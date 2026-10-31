import { api } from '../api.js';
import { h, toast, clear, confirmModal } from '../ui.js';
import { ROLE_MENUS } from '../layout/sidebar.js';

// 역할·권한(시스템관리) — 2026-10-31. 업무 역할(sq_roles, V10)과 역할별 메뉴 권한(sq_role_menus).
// M1 좌측 레일(코드 / 이름 · 인원) + 본문(코드 · 역할명 · 설명 · 정렬 · 사용 → 메뉴 × 조회 · 등록 · 수정 · 삭제 표).
// 관리자(사용자 화면의 '관리자 여부')는 이 표와 상관없이 모든 메뉴를 쓴다. 사람에게 역할을 주는 곳은 사용자 화면.
// 지금 실제로 적용되는 것은 '조회' — 조회가 없는 메뉴는 그 역할의 사람에게 메뉴판에서 숨고 열리지 않는다.
// 등록 · 수정 · 삭제는 권한표에 기록해 두며, 기준정보의 저장은 지금처럼 관리자만 된다.
const PERMS = [['R', '조회'], ['C', '등록'], ['U', '수정'], ['D', '삭제']];
const icon = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

export async function renderRoles(root) {
  let roles = [];
  let cur = null; // { code, name, note, sort, active, perms: {menu: 'RCU'}, isNew, user_count }
  let baseline = '';

  document.querySelector('.ss-app')?.classList.add('ss-app--railtitle');
  const railSearch = h('input', { placeholder: 'Search', oninput: () => paintRail() });
  const railList = h('div');
  const rail = h('aside', { class: 'ss-rail ss-rail--code', style: '--ss-rail-w:260px' },
    h('div', { class: 'ss-rail__head ss-rail__head--title' }, '역할·권한'),
    h('div', { class: 'ss-rail__search' }, h('div', { class: 'ss-search' }, railSearch,
      h('button', { class: 'ss-search__btn', 'aria-label': '검색', html: icon.search }))),
    railList);
  const pane = h('div', { class: 'ss-railview__body', style: 'overflow:auto' });
  root.appendChild(h('div', { class: 'ss-railview' }, rail, pane));

  function paintRail() {
    const q = railSearch.value.trim().toLowerCase();
    clear(railList);
    const list = roles.filter((r) => !q || r.code.toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q));
    if (!list.length) railList.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '역할이 없습니다.'));
    for (const r of list) {
      railList.appendChild(h('div', {
        class: 'ss-rail__code' + (cur && !cur.isNew && cur.code === r.code ? ' ss-rail__code--active' : ''),
        style: r.active ? null : 'opacity:.55', onclick: () => open(r.code),
      },
      h('span', { class: 'ss-rail__code-key' }, r.code),
      h('span', { class: 'ss-rail__code-name' }, `${r.name} · ${r.user_count || 0}명${r.active ? '' : ' (중지)'}`)));
    }
  }

  const snap = () => JSON.stringify([cur.code, cur.name, cur.note, Number(cur.sort) || 0, cur.active ? 1 : 0,
    ROLE_MENUS.map(([k]) => cur.perms[k] || '')]);

  function open(code) {
    const r = roles.find((x) => x.code === code);
    if (!r) return;
    cur = { code: r.code, name: r.name, note: r.note || '', sort: r.sort ?? 0, active: !!r.active, perms: { ...(r.perms || {}) },
      isNew: false, user_count: r.user_count || 0 };
    baseline = snap();
    paintRail();
    paint();
  }

  function startNew() {
    cur = { code: '', name: '', note: '', sort: roles.length + 1, active: true, perms: { quotes: 'R' }, isNew: true, user_count: 0 };
    baseline = '';
    paintRail();
    paint();
  }

  function paint() {
    clear(pane);
    const inp = (key, attrs = {}) => h('input', { class: 'ss-input', value: cur[key] ?? '', ...attrs,
      oninput: (e) => { cur[key] = attrs.upper ? e.target.value.toUpperCase() : e.target.value; if (attrs.upper) e.target.value = cur[key]; } });
    const fld = (label, el, req, cls = '') => h('div', { class: 'ss-field ' + cls }, h('label', {}, label, req ? h('span', { class: 'req' }, ' *') : null), el);
    pane.appendChild(h('div', { class: 'ss-subtitle' }, cur.isNew ? '새 역할' : `${cur.name}(${cur.code})`));
    pane.appendChild(h('div', { class: 'ss-edithead', style: 'margin-top:16px' }, h('div', { class: 'ss-edithead__fields' }),
      h('div', { class: 'ss-actions' },
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: startNew }, '신규'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: remove, disabled: cur.isNew }, '삭제'),
        h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));
    pane.appendChild(h('div', { class: 'ss-form ss-form--cols4', style: 'max-width:none;margin:16px 0 0' },
      h('div', { class: 'ss-fields' },
        fld('코드', inp('code', { disabled: !cur.isNew, upper: true, placeholder: '예) SALES' }), true),
        fld('역할명', inp('name', { placeholder: '예) 영업담당' }), true),
        fld('정렬', inp('sort', { inputMode: 'numeric' })),
        fld('사용', h('select', { class: 'ss-select', onchange: (e) => { cur.active = e.target.value === '1'; } },
          h('option', { value: '1', selected: cur.active }, '사용'), h('option', { value: '0', selected: !cur.active }, '중지'))),
        fld('설명', inp('note'), false, 'ss-field--w2'))));

    pane.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
      h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ 메뉴 권한'),
      h('span', { style: 'font-size:12.5px;color:var(--ss-ink-2);margin-left:12px' }, `이 역할의 사용자 ${cur.user_count}명`),
      h('div', { class: 'ss-detailbar__spacer' }),
      h('span', { class: 'ss-detailbar__note' }, '조회가 없는 메뉴는 이 역할의 사용자에게 보이지 않습니다. 등록 · 수정 · 삭제는 기록만 하고, 기준정보 저장은 지금처럼 관리자만 됩니다. 시스템관리 메뉴는 관리자 전용입니다.')));

    const tbody = h('tbody');
    let group = '';
    for (const [key, label, g] of ROLE_MENUS) {
      if (g !== group) {
        group = g;
        tbody.appendChild(h('tr', { style: 'background:var(--ss-grid-head, #F8FAFC)' }, h('td', { colspan: PERMS.length + 2, style: 'font-weight:600;text-align:left' }, g)));
      }
      const has = (p) => (cur.perms[key] || '').includes(p);
      const set = (p, on) => {
        let s = new Set((cur.perms[key] || '').split(''));
        if (on) { s.add(p); if (p !== 'R') s.add('R'); } else { s.delete(p); if (p === 'R') s = new Set(); } // 등록 · 수정 · 삭제는 조회가 있어야
        cur.perms[key] = PERMS.map(([x]) => x).filter((x) => s.has(x)).join('');
        paint();
      };
      tbody.appendChild(h('tr', {},
        h('td', { style: 'text-align:left;padding-left:24px' }, label),
        ...PERMS.map(([p]) => h('td', { style: 'text-align:center' },
          h('input', { type: 'checkbox', checked: has(p), 'aria-label': `${label} ${p}`, onchange: (e) => set(p, e.target.checked) }))),
        h('td', { style: 'text-align:center;color:var(--ss-ink-3)' }, cur.perms[key] || '—')));
    }
    pane.appendChild(h('div', { class: 'ss-gridwrap', style: 'margin-top:8px' },
      h('table', { class: 'ss-grid ss-grid--sized', style: 'width:640px' },
        h('colgroup', {}, h('col', { style: 'width:220px' }), ...PERMS.map(() => h('col', { style: 'width:80px' })), h('col', { style: 'width:100px' })),
        h('thead', {}, h('tr', {}, h('th', {}, '메뉴'), ...PERMS.map(([, t]) => h('th', {}, t)), h('th', {}, '요약'))),
        tbody)));
  }

  async function save() {
    if (!/^[A-Z0-9_]{1,30}$/.test(cur.code)) return toast('코드는 영문 대문자 · 숫자 · _ 로 넣으세요.', 'err');
    if (cur.code === 'ADMIN') return toast('ADMIN 은 쓸 수 없습니다. 관리자는 사용자 화면의 관리자 여부로 정합니다.', 'err');
    if (!String(cur.name).trim()) return toast('역할명을 넣으세요.', 'err');
    if (cur.isNew && roles.some((r) => r.code === cur.code)) return toast(`이미 있는 코드입니다: ${cur.code}`, 'err');
    if (!cur.isNew && snap() === baseline) return toast('변경된 내용이 없습니다.', 'ok');
    try {
      await api.saveRole(cur.code, { name: cur.name.trim(), note: cur.note, sort: Number(cur.sort) || 0, active: cur.active ? 1 : 0,
        perms: Object.fromEntries(ROLE_MENUS.map(([k]) => [k, cur.perms[k] || '']).filter(([, v]) => v)) });
      toast('저장되었습니다.', 'ok');
      await load(cur.code);
    } catch (err) { toast(err.message, 'err'); }
  }

  async function remove() {
    if (cur.user_count) return toast('이 역할을 가진 사용자가 있어 지울 수 없습니다. 사용자 화면에서 역할을 먼저 바꾸세요.', 'err');
    if (!(await confirmModal({ title: '역할 삭제', message: `${cur.code} (${cur.name}) 역할과 메뉴 권한을 지웁니다.`, okLabel: '삭제', danger: true }))) return;
    try {
      await api.deleteRole(cur.code);
      toast('삭제되었습니다.', 'ok');
      cur = null;
      await load();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function load(pick) {
    try {
      const r = await api.roles();
      roles = r.roles || [];
    } catch (err) {
      clear(pane).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message));
      return;
    }
    paintRail();
    const code = pick || (roles[0] && roles[0].code);
    if (code && roles.some((x) => x.code === code)) open(code); else startNew();
  }
  load();
}

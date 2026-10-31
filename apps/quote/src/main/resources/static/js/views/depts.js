import { api } from '../api.js';
import { h, toast, clear, confirmModal, resizableColumns } from '../ui.js';

// 조직(시스템관리) — 2026-10-31. 부서(sq_depts, V10) 목록을 그리드에서 바로 고친다(고객사 화면과 같은 동작).
// 상위 부서를 고르면 표에서 그 아래로 들여 쓴다. 행삭제는 사용 중지 — 사람이 남은 부서는 서버가 막는다.
// 사용자의 부서는 사용자 화면에서 정한다.
const FIELDS = [
  { key: 'code', label: '부서 코드', width: 130, mono: true, required: true },
  { key: 'name', label: '부서명', width: 200, required: true },
  { key: 'parent_code', label: '상위 부서', width: 180, parent: true },
  { key: 'note', label: '비고', width: 300 },
  { key: 'sort', label: '정렬', width: 70, number: true },
];

export async function renderDepts(root) {
  let rows = [];    // [{ orig, form, isNew, checked }]
  let deleted = [];

  root.appendChild(h('div', { class: 'ss-edithead' },
    h('div', { class: 'ss-edithead__fields' },
      h('span', { class: 'ss-detailbar__note' }, '사람의 부서는 사용자 화면에서 정합니다. 행삭제한 부서는 사용 중지됩니다(사람이 남은 부서는 지울 수 없습니다).')),
    h('div', { class: 'ss-actions' },
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: addRow }, '행추가'),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: removeRows }, '행삭제'),
      h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));

  const widths = [60, ...FIELDS.map((f) => f.width), 70];
  const tbody = h('tbody');
  const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${widths.reduce((a, w) => a + w, 0)}px` },
    h('colgroup', {}, ...widths.map((w) => h('col', { style: `width:${w}px` }))),
    h('thead', {}, h('tr', {}, h('th', { 'data-fixed': '' }, '선택'),
      ...FIELDS.map((f) => h('th', { class: f.required ? 'req' : null }, f.label)), h('th', {}, '인원'))),
    tbody);
  root.appendChild(h('div', { class: 'ss-gridwrap ss-gridwrap--fill', style: 'margin-top:12px' }, table));
  resizableColumns(table, 'quote2:dept-cols');

  const toForm = (d) => Object.fromEntries(FIELDS.map((f) => [f.key, d[f.key] ?? '']));
  const changed = (r) => r.isNew || FIELDS.some((f) => String(r.form[f.key] ?? '') !== String(r.orig[f.key] ?? ''));

  // 상위 → 하위 순서로 펼친다(표에서 들여 쓰기). 상위가 없거나 고리가 생긴 부서는 맨 위로
  function ordered() {
    const byParent = new Map();
    const codes = new Set(rows.map((r) => r.form.code));
    for (const r of rows) {
      const p = r.form.parent_code && codes.has(r.form.parent_code) && r.form.parent_code !== r.form.code ? r.form.parent_code : '';
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(r);
    }
    const out = [];
    const seen = new Set();
    const walk = (p, depth) => {
      for (const r of (byParent.get(p) || []).sort((a, b) => (Number(a.form.sort) || 0) - (Number(b.form.sort) || 0))) {
        if (seen.has(r)) continue;
        seen.add(r); out.push([r, depth]);
        if (r.form.code) walk(r.form.code, depth + 1);
      }
    };
    walk('', 0);
    rows.filter((r) => !seen.has(r)).forEach((r) => out.push([r, 0]));
    return out;
  }

  function paint() {
    clear(tbody);
    if (!rows.length) {
      tbody.appendChild(h('tr', {}, h('td', { colspan: FIELDS.length + 2, class: 'ss-cell--empty' }, '부서가 없습니다. 행추가로 등록하세요.')));
      return;
    }
    for (const [r, depth] of ordered()) {
      const tr = h('tr', { class: r.isNew ? 'is-new' : null },
        h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })));
      for (const f of FIELDS) {
        if (f.parent) {
          tr.appendChild(h('td', { class: 'ss-cell--input' }, h('select', { class: 'ss-cellinput', 'aria-label': f.label,
            onchange: (e) => { r.form.parent_code = e.target.value; paint(); } },
          h('option', { value: '', selected: !r.form.parent_code }, '(최상위)'),
          ...rows.filter((x) => x !== r && x.form.code).map((x) => h('option', { value: x.form.code, selected: x.form.code === r.form.parent_code }, x.form.name || x.form.code)))));
          continue;
        }
        const inp = h('input', { class: 'ss-cellinput', value: r.form[f.key] ?? '', 'aria-label': f.label,
          inputMode: f.number ? 'numeric' : null,
          style: f.number || f.mono ? 'text-align:center' : f.key === 'name' && depth ? `padding-left:${8 + depth * 18}px` : null,
          oninput: (e) => {
            if (f.number) e.target.value = e.target.value.replace(/[^\d-]/g, '');
            if (f.mono) e.target.value = e.target.value.toUpperCase();
            r.form[f.key] = e.target.value;
          } });
        tr.appendChild(h('td', { class: 'ss-cell--input' + (f.mono ? ' ss-cell--link' : '') }, f.key === 'name' && depth ? h('div', { style: 'position:relative' },
          h('span', { style: `position:absolute;left:${depth * 18 - 10}px;top:50%;transform:translateY(-50%);color:var(--ss-ink-3);font-size:11px;pointer-events:none` }, '└'), inp) : inp));
      }
      tr.appendChild(h('td', { style: 'text-align:center' }, r.isNew ? '' : String(r.orig.user_count ?? 0)));
      tbody.appendChild(tr);
    }
  }

  function addRow() {
    const picked = rows.find((r) => r.checked);
    rows.push({ orig: {}, form: { code: '', name: '', parent_code: picked ? picked.form.code : '', note: '', sort: rows.length + 1 }, isNew: true, checked: false });
    paint();
  }

  function removeRows() {
    const picked = rows.filter((r) => r.checked);
    if (!picked.length) return toast('삭제할 행을 선택하세요.', 'err');
    picked.forEach((r) => { if (!r.isNew) deleted.push(r.orig); });
    rows = rows.filter((r) => !r.checked);
    paint();
  }

  async function save() {
    const creates = rows.filter((r) => r.isNew);
    const updates = rows.filter((r) => !r.isNew && changed(r));
    if (!creates.length && !updates.length && !deleted.length) return toast('변경된 내용이 없습니다.', 'ok');
    for (const r of [...creates, ...updates]) {
      if (!/^[A-Z0-9_]{1,30}$/.test(String(r.form.code))) return toast(`부서 코드는 영문 대문자 · 숫자 · _ 로 넣으세요: ${r.form.code || '(빈칸)'}`, 'err');
      if (!String(r.form.name || '').trim()) return toast('부서명은 필수입니다.', 'err');
    }
    const codes = rows.map((r) => r.form.code);
    const dup = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dup) return toast(`부서 코드가 겹칩니다: ${dup}`, 'err');
    if (deleted.length && !(await confirmModal({ title: '사용 중지', message: `행삭제한 ${deleted.length}개 부서는 사용 중지됩니다. 저장하시겠습니까?`, okLabel: '저장', danger: true }))) return;
    const body = (r) => ({ ...r.form, sort: Number(r.form.sort) || 0, parent_code: r.form.parent_code || null, note: r.form.note || null });
    let done = 0;
    try {
      // 상위 부서를 먼저 만든다(새 부서끼리 상위 · 하위로 이을 때)
      for (const r of ordered().map(([x]) => x).filter((x) => x.isNew)) { await api.createDept(body(r)); done++; }
      for (const r of updates) { await api.updateDept(r.orig.id, body(r)); done++; }
      for (const d of deleted) { await api.deleteDept(d.id); done++; }
      toast(`저장되었습니다. (${done}건)`, 'ok');
    } catch (err) {
      toast(`${done}건 저장 후 실패: ${err.message}`, 'err');
    }
    load();
  }

  async function load() {
    rows = []; deleted = [];
    clear(tbody).appendChild(h('tr', {}, h('td', { colspan: FIELDS.length + 2, class: 'ss-cell--empty' }, '불러오는 중...')));
    try {
      const { rows: list } = await api.depts();
      rows = (list || []).filter((d) => d.active).map((d) => ({ orig: d, form: toForm(d), isNew: false, checked: false }));
      paint();
    } catch (err) {
      clear(tbody).appendChild(h('tr', {}, h('td', { colspan: FIELDS.length + 2, class: 'ss-cell--empty' }, err.message)));
    }
  }
  load();
}

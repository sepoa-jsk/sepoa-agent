import { api } from '../api.js';
import { h, toast, clear, confirmModal } from '../ui.js';

// 견적조건 문구(기준정보) — 2026-10-31.
// M1 좌측 레일(코드 빨강 / 이름 · 문장 수) + 본문(코드 · 이름 · 쓰는 곳 → 문장 표).
// 견적조건 문장은 여기서만 고친다. 템플릿은 '견적조건 문구' 칸으로, 가격정책(SaaS)은 견적조건 탭에서 세트를 골라 가져다 쓴다.
// 저장은 세트 한 건을 통째로(이름 + 문장 전체) 보낸다 — PUT /api/condition-sets/{code}.
const icon = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

export async function renderConditions(root) {
  let sets = [];
  let cur = null;      // { code, name, isNew, lines: [{ text, checked }], templates, policies }
  let baseline = '';

  document.querySelector('.ss-app')?.classList.add('ss-app--railtitle');

  // ── 레일 ──
  const railSearch = h('input', { placeholder: 'Search', oninput: () => paintRail() });
  const railList = h('div');
  const rail = h('aside', { class: 'ss-rail ss-rail--code', style: '--ss-rail-w:300px' },
    h('div', { class: 'ss-rail__head ss-rail__head--title' }, '견적조건 문구'),
    h('div', { class: 'ss-rail__search' }, h('div', { class: 'ss-search' }, railSearch,
      h('button', { class: 'ss-search__btn', 'aria-label': '검색', html: icon.search }))),
    railList);
  const pane = h('div', { class: 'ss-railview__body', style: 'overflow:auto' });
  root.appendChild(h('div', { class: 'ss-railview' }, rail, pane));

  function paintRail() {
    const q = railSearch.value.trim().toLowerCase();
    clear(railList);
    const list = sets.filter((s) => !q || s.code.toLowerCase().includes(q) || String(s.name).toLowerCase().includes(q));
    if (!list.length) railList.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '문구 세트가 없습니다.'));
    for (const s of list) {
      railList.appendChild(h('div', {
        class: 'ss-rail__code' + (cur && !cur.isNew && cur.code === s.code ? ' ss-rail__code--active' : ''),
        onclick: () => open(s.code),
      },
      h('span', { class: 'ss-rail__code-key' }, s.code),
      h('span', { class: 'ss-rail__code-name' }, `${s.name} · ${(s.lines || []).length}문장`)));
    }
  }

  async function load(pick) {
    const r = await api.conditionSets();
    sets = r.sets || [];
    paintRail();
    const code = pick || (cur && !cur.isNew && cur.code) || (sets[0] && sets[0].code);
    if (code && sets.some((s) => s.code === code)) open(code);
    else if (!sets.length) startNew();
  }

  // 레일 항목을 누르면 무조건 그 세트로 다시 그린다(저장 안 한 변경은 버린다 — 마스터 관리와 같은 규칙)
  function open(code) {
    const s = sets.find((x) => x.code === code);
    if (!s) return;
    cur = { code: s.code, name: s.name, isNew: false, lines: (s.lines || []).map((t) => ({ text: String(t), checked: false })),
      templates: s.templates || [], policies: s.policies || [] };
    baseline = snap();
    paintRail();
    paint();
  }

  function startNew() {
    cur = { code: '', name: '', isNew: true, lines: [{ text: '', checked: false }], templates: [], policies: [] };
    baseline = '';
    paintRail();
    paint();
  }

  const snap = () => JSON.stringify([cur.code, cur.name, cur.lines.map((l) => l.text.trim()).filter(Boolean)]);

  // ── 본문 ──
  function paint() {
    clear(pane);
    const codeIn = h('input', { class: 'ss-input', value: cur.code, disabled: !cur.isNew, placeholder: '예) COND_EPRO_SAAS',
      oninput: (e) => { cur.code = e.target.value.trim().toUpperCase(); e.target.value = cur.code; } });
    const nameIn = h('input', { class: 'ss-input', value: cur.name, placeholder: '예) 전자구매 SaaS 조건',
      oninput: (e) => { cur.name = e.target.value; } });
    const field = (label, ctrl, cls = '') => h('div', { class: 'ss-field ' + cls }, h('label', {}, label, h('span', { class: 'req' }, ' *')), ctrl);
    pane.appendChild(h('div', { class: 'ss-subtitle' }, cur.isNew ? '새 문구 세트' : `${cur.name}(${cur.code})`));
    pane.appendChild(h('div', { class: 'ss-edithead', style: 'margin-top:16px' }, h('div', { class: 'ss-edithead__fields' }),
      h('div', { class: 'ss-actions' },
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: startNew }, '신규'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: copyCurrent, disabled: cur.isNew }, '복사'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: remove, disabled: cur.isNew }, '삭제'),
        h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));
    pane.appendChild(h('div', { class: 'ss-form ss-form--cols4', style: 'max-width:none;margin:16px 0 0' },
      h('div', { class: 'ss-fields' }, field('코드', codeIn), field('이름', nameIn, 'ss-field--w2'))));

    // 쓰는 곳 — 여기서 고치면 아래 템플릿 · 가격정책으로 시작하는 새 견적에 바로 들어간다(이미 저장된 견적은 그대로)
    const uses = [...cur.templates.map((t) => `템플릿 ${t}`), ...cur.policies.map((p) => `가격정책 ${p}`)];
    pane.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
      h('span', { style: 'font-size:12.5px;color:var(--ss-ink-2)' }, h('b', {}, '쓰는 곳  '), uses.length ? uses.join(' · ') : '없음'),
      h('div', { class: 'ss-detailbar__spacer' }),
      h('span', { class: 'ss-detailbar__note' }, '고친 문장은 이 세트를 쓰는 템플릿 · 가격정책으로 새로 시작하는 견적부터 들어갑니다. 이미 저장된 견적은 바뀌지 않습니다.')));

    const tbody = h('tbody');
    cur.lines.forEach((r, i) => {
      const ta = h('textarea', { class: 'ss-cellinput', rows: Math.max(1, r.text.split('\n').length),
        style: 'height:auto;resize:none;line-height:1.5;padding:4px 6px;text-align:left',
        oninput: (e) => { r.text = e.target.value; e.target.rows = Math.max(1, e.target.value.split('\n').length); } });
      ta.value = r.text;
      tbody.appendChild(h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })),
        h('td', { style: 'text-align:center' }, String(i + 1)),
        h('td', { class: 'ss-cell--input' }, ta)));
    });
    if (!cur.lines.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 3, class: 'ss-cell--empty' }, '문장이 없습니다. 행추가로 넣으세요.')));
    const gbtn = (label, onclick) => h('button', { class: 'ss-btn ss-btn--gridrow', onclick }, label);
    pane.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
      h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ 문장'),
      h('span', { class: 'ss-detailbar__note' }, '한 줄에 한 조건. 견적서에는 \'-. \' 로 시작하는 문장으로 나옵니다.'),
      h('div', { class: 'ss-detailbar__spacer' }),
      gbtn('▲ 위로', () => move(-1)), gbtn('▼ 아래로', () => move(1)),
      gbtn('행추가', () => { cur.lines.push({ text: '', checked: false }); paint(); pane.querySelector('tbody tr:last-child textarea')?.focus(); }),
      gbtn('행삭제', () => {
        if (!cur.lines.some((r) => r.checked)) return toast('삭제할 행을 선택하세요.', 'err');
        cur.lines = cur.lines.filter((r) => !r.checked);
        paint();
      })));
    pane.appendChild(h('div', { class: 'ss-gridwrap', style: 'margin-top:8px' },
      h('table', { class: 'ss-grid ss-grid--sized', style: 'width:100%' },
        h('colgroup', {}, h('col', { style: 'width:60px' }), h('col', { style: 'width:60px' }), h('col', {})),
        h('thead', {}, h('tr', {}, h('th', { 'data-fixed': '' }, '선택'), h('th', {}, '번호'), h('th', {}, '내용'))),
        tbody)));
  }

  function move(d) {
    const list = cur.lines;
    const picked = list.filter((r) => r.checked);
    if (!picked.length) return toast('옮길 행을 선택하세요.', 'err');
    const idx = picked.map((r) => list.indexOf(r));
    if (d < 0 ? idx[0] === 0 : idx[idx.length - 1] === list.length - 1) return;
    for (const i of d < 0 ? idx : [...idx].reverse()) [list[i], list[i + d]] = [list[i + d], list[i]];
    paint();
  }

  function copyCurrent() {
    if (!cur || cur.isNew) return toast('복사할 세트를 왼쪽에서 고르세요.', 'err');
    cur = { code: `${cur.code}_COPY`.slice(0, 30), name: `${cur.name} (복사)`, isNew: true,
      lines: cur.lines.map((l) => ({ text: l.text, checked: false })), templates: [], policies: [] };
    baseline = '';
    paintRail();
    paint();
  }

  async function save() {
    if (!/^[A-Z0-9_]{1,30}$/.test(cur.code)) return toast('코드는 영문 대문자 · 숫자 · _ 로 30자까지 넣으세요.', 'err');
    if (!cur.name.trim()) return toast('이름을 넣으세요.', 'err');
    if (cur.isNew && sets.some((s) => s.code === cur.code)) return toast(`이미 있는 코드입니다: ${cur.code}`, 'err');
    if (!cur.isNew && snap() === baseline) return toast('변경된 내용이 없습니다.', 'ok');
    try {
      await api.saveConditionSet(cur.code, { name: cur.name.trim(), lines: cur.lines.map((l) => l.text.trim()).filter(Boolean) });
      toast('저장되었습니다.', 'ok');
      const code = cur.code;
      cur = null;
      await load(code);
    } catch (err) { toast(err.message, 'err'); }
  }

  async function remove() {
    if (cur.templates.length || cur.policies.length) return toast('쓰는 곳이 있어 지울 수 없습니다. 템플릿 · 가격정책에서 다른 세트로 바꾼 뒤 지우세요.', 'err');
    if (!(await confirmModal({ title: '문구 세트 삭제', message: `${cur.code} (${cur.name}) 세트와 문장을 지웁니다.`, okLabel: '삭제', danger: true }))) return;
    try {
      await api.deleteConditionSet(cur.code);
      toast('삭제되었습니다.', 'ok');
      cur = null;
      await load();
    } catch (err) { toast(err.message, 'err'); }
  }

  try { await load(); } catch (err) { clear(pane).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message)); }
}

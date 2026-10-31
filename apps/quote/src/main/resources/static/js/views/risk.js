import { api } from '../api.js';
import { h, toast, clear, resizableColumns } from '../ui.js';
import { RISK_KEY, DEFAULT_RISK_FACTORS, RISK_FACTORS, parseRiskFactors } from './quote/wizard/risk-factors.js';

// 리스크 계수(기준정보) — 2026-10-31. 견적 작성 4단계(인건비) 왼쪽 체크리스트의 항목과 계수.
// L1 인라인 편집형 — 행추가 · 행삭제 · 위로 · 아래로 · 저장. 저장 위치는 설정(sq_settings) 'risk_factors'(JSON) — 새 표 없음.
// 계수는 아직 인건비 금액에 반영되지 않는다(체크리스트 표시만).
const TYPES = [['MULTIPLY', '공수 × 계수'], ['ADD_MM', '건당 공수 + 계수']];
const FIELDS = [
  { key: 'code', label: '코드', width: 140, mono: true, required: true },
  { key: 'label', label: '이름', width: 180, required: true },
  { key: 'desc', label: '설명', width: 380 },
  { key: 'type', label: '계산 방식', width: 150, options: TYPES },
  { key: 'factor', label: '계수', width: 90, number: true, required: true },
  { key: 'unit', label: '단위', width: 70 },
];

export async function renderRisk(root) {
  let rows = [];
  let base = '';
  const tbody = h('tbody');
  const json = () => JSON.stringify(rows.map(clean));
  const clean = (r) => {
    const o = { code: String(r.code || '').trim().toUpperCase(), label: String(r.label || '').trim(), desc: String(r.desc || '').trim(),
      factor: r.factor === '' || r.factor == null ? null : Number(r.factor), type: r.type || 'MULTIPLY' };
    if (o.type === 'ADD_MM' && String(r.unit || '').trim()) o.unit = String(r.unit).trim();
    return o;
  };

  root.appendChild(h('div', { class: 'ss-edithead' },
    h('div', { class: 'ss-edithead__fields' }),
    h('div', { class: 'ss-actions' },
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => move(-1) }, '▲ 위로'),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => move(1) }, '▼ 아래로'),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: addRow }, '행추가'),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: removeRows }, '행삭제'),
      h('button', { class: 'ss-btn ss-btn--default', onclick: reset }, '기본값으로'),
      h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));

  root.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
    h('span', { class: 'ss-detailbar__note' }, '견적 작성 4단계(인건비)의 리스크 계수 목록입니다. 계수는 아직 인건비 금액에 반영되지 않습니다.')));
  const widths = [60, ...FIELDS.map((f) => f.width)];
  const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${widths.reduce((a, w) => a + w, 0)}px` },
    h('colgroup', {}, ...widths.map((w) => h('col', { style: `width:${w}px` }))),
    h('thead', {}, h('tr', {}, h('th', { 'data-fixed': '' }, '선택'),
      ...FIELDS.map((f) => h('th', { class: f.required ? 'req' : null }, f.label)))),
    tbody);
  root.appendChild(h('div', { class: 'ss-gridwrap ss-gridwrap--fill', style: 'margin-top:8px' }, table));
  resizableColumns(table, 'quote2:risk-cols');

  function paint() {
    clear(tbody);
    if (!rows.length) {
      tbody.appendChild(h('tr', {}, h('td', { colspan: FIELDS.length + 1, class: 'ss-cell--empty' }, '항목이 없습니다. 행추가로 넣으세요.')));
      return;
    }
    rows.forEach((r) => {
      const tr = h('tr', { class: r.isNew ? 'is-new' : null },
        h('td', {}, h('input', { type: 'checkbox', checked: !!r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })));
      for (const f of FIELDS) {
        if (f.options) {
          tr.appendChild(h('td', { class: 'ss-cell--input' }, h('select', { class: 'ss-cellinput', 'aria-label': f.label,
            onchange: (e) => { r[f.key] = e.target.value; paint(); } },
          ...f.options.map(([v, t]) => h('option', { value: v, selected: v === (r[f.key] || 'MULTIPLY') }, t)))));
          continue;
        }
        const off = f.key === 'unit' && (r.type || 'MULTIPLY') !== 'ADD_MM'; // 단위는 '건당 공수 + 계수' 일 때만
        tr.appendChild(h('td', { class: 'ss-cell--input' + (f.mono ? ' ss-cell--link' : '') }, h('input', {
          class: 'ss-cellinput', type: 'text', value: off ? '' : (r[f.key] ?? ''), disabled: off, 'aria-label': f.label,
          inputMode: f.number ? 'decimal' : null, style: f.number || f.mono || f.key === 'unit' ? 'text-align:center' : 'text-align:left',
          oninput: (e) => {
            if (f.number) e.target.value = e.target.value.replace(/[^\d.]/g, '');
            r[f.key] = e.target.value;
          } })));
      }
      tbody.appendChild(tr);
    });
  }

  function addRow() { rows.push({ code: '', label: '', desc: '', type: 'MULTIPLY', factor: '', isNew: true }); paint(); }
  function removeRows() {
    if (!rows.some((r) => r.checked)) return toast('삭제할 행을 선택하세요.', 'err');
    rows = rows.filter((r) => !r.checked);
    paint();
  }
  function move(d) {
    const idx = rows.map((r, i) => (r.checked ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return toast('옮길 행을 선택하세요.', 'err');
    if (d < 0 ? idx[0] === 0 : idx[idx.length - 1] === rows.length - 1) return;
    for (const i of d < 0 ? idx : [...idx].reverse()) [rows[i], rows[i + d]] = [rows[i + d], rows[i]];
    paint();
  }
  function reset() {
    rows = DEFAULT_RISK_FACTORS.map((f) => ({ ...f }));
    paint();
    toast('기본값을 채웠습니다. 저장해야 반영됩니다.', 'ok');
  }

  async function save() {
    const list = rows.map(clean);
    const bad = list.find((r) => !r.code || !r.label || r.factor == null || Number.isNaN(r.factor));
    if (bad) return toast('코드 · 이름 · 계수는 필수입니다.', 'err');
    const codes = list.map((r) => r.code);
    const dup = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dup) return toast(`코드가 겹칩니다: ${dup}`, 'err');
    if (json() === base) return toast('변경된 내용이 없습니다.', 'ok');
    try {
      await api.putSettings({ [RISK_KEY]: JSON.stringify(list) });
      RISK_FACTORS.splice(0, RISK_FACTORS.length, ...list); // 열려 있는 견적 작성 4단계도 새 값으로
      toast('저장되었습니다.', 'ok');
      load();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function load() {
    try {
      const { settings } = await api.getSettings();
      const list = parseRiskFactors(settings && settings[RISK_KEY]) || DEFAULT_RISK_FACTORS;
      rows = list.map((f) => ({ ...f }));
    } catch (err) {
      rows = [];
      toast(err.message, 'err');
    }
    base = json();
    paint();
  }
  load();
}

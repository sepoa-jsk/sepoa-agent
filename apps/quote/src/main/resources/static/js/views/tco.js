import { api } from '../api.js';
import { store } from '../app.js';
import { h, toast, clear, won, numInput, openModal } from '../ui.js';

// TCO 비교(시뮬레이션) — 2026-10-31. 구축형태별 총소유비용(TCO)을 같은 기간으로 나란히 본다.
// 저장하지 않는 계산 화면이다(새 표 없음). 값은 직접 넣거나 [견적 불러오기]로 저장된 견적의 금액을 그 구축형태 칸에 채운다.
//
// 칸마다 비용 = 일시불 + 월비용(계약기간 동안) × 개월 + 월비용(계약기간 뒤) × 남은 개월
//            (+ 고객사 부담을 포함하면 H/W·S/W 일시불 + 인프라관리비 월 × 전체 개월)
// 견적 불러오기 규칙 — 구축형 일시불: 일시불 = 견적 일시불, 계약기간 = 무상 유지보수 개월, 그 뒤 월비용 = 일시불 × 유지보수 요율 ÷ 12
//   (유지보수는 기준정보 > 마스터 관리 > 유지보수의 '솔루션 유지보수' 요율 · 무상개월. 원래는 솔루션 공급가 기준이라 근사값이다)
//   구축형 분납 · Private Cloud · SaaS: 일시불 = 견적 일시불, 월비용 = 견적 월 사용료(계약기간 동안 · 뒤 모두 같게)
// 부가세 별도, 단위 원.
const OPTIONS = [
  ['ONPREM_LUMP', '구축형 일시불'], ['ONPREM_INSTALL', '구축형 분납'], ['PCLOUD', 'Private Cloud'], ['SAAS', 'SaaS'],
];
const INPUTS = [
  ['lump', '일시불 (솔루션 + 인건비)'],
  ['m1', '월비용 — 계약기간 동안'],
  ['term', '계약기간 (개월)', true],
  ['m2', '월비용 — 계약기간 뒤'],
  ['hw', '고객사 부담 — H/W · S/W 일시불', false, 'cust'],
  ['infra', '고객사 부담 — 인프라관리비 (월)', false, 'cust'],
];

export async function renderTco(root) {
  const cols = OPTIONS.map(([dep, name]) => ({ dep, name, lump: null, m1: null, term: dep === 'ONPREM_LUMP' ? 12 : 60, m2: null, hw: null, infra: null, from: '' }));
  const opt = { years: 10, cust: true };
  let maint = null;
  try {
    const m = await store.getMaster();
    maint = (m.maintenance || []).find((x) => x.code === 'SOLUTION_MAINT' && x.active) || null;
  } catch { /* 유지보수 기준 없으면 견적 불러오기 때 0 */ }

  const yearsSel = h('select', { class: 'ss-select', 'aria-label': '비교 기간', onchange: (e) => { opt.years = Number(e.target.value); paint(); } },
    ...[3, 5, 7, 10].map((y) => h('option', { value: y, selected: y === opt.years }, `${y}년`)));
  const custChk = h('input', { type: 'checkbox', checked: opt.cust, onchange: (e) => { opt.cust = e.target.checked; paint(); } });
  root.appendChild(h('div', { class: 'ss-edithead' },
    h('div', { class: 'ss-edithead__fields', style: 'grid-template-columns:auto auto;gap:20px;align-items:center' },
      h('label', { class: 'ss-field', style: 'display:flex;align-items:center;gap:8px' }, h('span', {}, '비교 기간'), yearsSel),
      h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12.5px' }, custChk, '고객사 부담(H/W · 인프라관리비) 포함')),
    h('div', { class: 'ss-actions' },
      h('button', { class: 'ss-btn ss-btn--default', onclick: clearAll }, '비우기'),
      h('button', { class: 'ss-btn ss-btn--save', onclick: pickQuote }, '견적 불러오기'))));
  const body = h('div', {});
  root.appendChild(body);

  const n = (v) => Number(v) || 0;
  // 칸 c 의 y년차까지 누적 비용(0년차 = 일시불만)
  const cumulative = (c, y) => {
    const months = y * 12;
    const t = Math.max(0, n(c.term));
    let sum = n(c.lump) + n(c.m1) * Math.min(months, t) + n(c.m2) * Math.max(0, months - t);
    if (opt.cust) sum += n(c.hw) + n(c.infra) * months;
    return sum;
  };

  function paint() {
    clear(body);
    const w = [260, ...cols.map(() => 170)];
    const table = (head, rows) => h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' },
      h('table', { class: 'ss-grid ss-grid--sized', style: `width:${w.reduce((a, x) => a + x, 0)}px` },
        h('colgroup', {}, ...w.map((x) => h('col', { style: `width:${x}px` }))),
        h('thead', {}, h('tr', {}, ...head)), h('tbody', {}, ...rows)));
    const headCols = [h('th', {}, '구분'), ...cols.map((c) => h('th', {}, c.name, c.from ? h('div', { style: 'font-weight:400;font-size:11px;color:var(--ss-ink-3)' }, c.from) : null))];

    // 입력 표
    const inRows = INPUTS.filter(([, , , g]) => g !== 'cust' || opt.cust).map(([key, label, plain]) => h('tr', {},
      h('td', { style: 'text-align:left;font-weight:600' }, label),
      ...cols.map((c) => h('td', { class: 'ss-cell--input' }, numInput(c[key] ?? '', (v) => { c[key] = v === '' ? null : Number(v); paintResult(); },
        { class: 'ss-cellinput', style: 'text-align:right', 'aria-label': `${c.name} ${label}` }, !!plain)))));
    body.append(
      h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ 비용 입력'),
        h('div', { class: 'ss-detailbar__spacer' }),
        h('span', { class: 'ss-detailbar__note' }, '단위: 원, 부가세 별도. 저장하지 않는 계산 화면입니다.')),
      table(headCols, inRows));
    const result = h('div', {});
    body.appendChild(result);

    function paintResult() {
      clear(result);
      const years = opt.years;
      // 비용을 하나도 넣지 않은 칸은 '-' — 비교(가장 적은 금액)에서도 뺀다
      const filled = (c) => ['lump', 'm1', 'm2'].some((k) => c[k] != null && c[k] !== '');
      const val = (c, y) => (filled(c) ? cumulative(c, y) : null);
      const show = (v) => (v == null ? '-' : won(v));
      const mark = (vals) => {
        const xs = vals.filter((v) => v != null);
        const min = Math.min(...xs);
        return (v) => (v != null && xs.length > 1 && v === min && xs.filter((x) => x === min).length < xs.length ? 'color:var(--ss-primary);font-weight:700' : '');
      };
      const sumRow = (y) => {
        const vals = cols.map((c) => val(c, y));
        const st = mark(vals);
        return h('tr', { style: 'background:#F4F9E3;font-weight:600' }, h('td', { style: 'text-align:left' }, `${y}년간 TCO`),
          ...vals.map((v) => h('td', { style: `text-align:right;${st(v)}` }, show(v))));
      };
      const totals = [...new Set([5, years].filter((y) => y <= years))].map(sumRow);
      const yearly = Array.from({ length: years + 1 }, (_, y) => {
        const vals = cols.map((c) => val(c, y));
        return h('tr', {}, h('td', { style: 'text-align:center' }, y === 0 ? '시작(일시불)' : `${y}년차`),
          ...vals.map((v) => h('td', { style: 'text-align:right' }, show(v))));
      });
      result.append(
        h('div', { class: 'ss-detailbar', style: 'margin-top:16px' },
          h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ TCO 합계'),
          h('div', { class: 'ss-detailbar__spacer' }),
          h('span', { class: 'ss-detailbar__note' }, opt.cust ? '고객사 부담 포함 · 가장 적은 금액은 파란색' : '세포아소프트 청구액만 · 가장 적은 금액은 파란색')),
        table([h('th', {}, '구분'), ...cols.map((c) => h('th', {}, c.name))], totals),
        h('div', { class: 'ss-detailbar', style: 'margin-top:16px' },
          h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ 연차별 누적')),
        table([h('th', {}, '연차'), ...cols.map((c) => h('th', {}, c.name))], yearly),
        h('div', { class: 'ss-detailbar__note', style: 'margin-top:8px;line-height:1.7' },
          '계산: 일시불 + 월비용(계약기간 동안) × 개월 + 월비용(계약기간 뒤) × 남은 개월', opt.cust ? ' + 고객사 H/W · S/W + 인프라관리비 × 개월' : '', '. ',
          maint ? `견적 불러오기 때 구축형 일시불의 유지보수는 무상 ${maint.free_months || 0}개월 뒤 일시불의 ${Math.round(Number(maint.rate) * 1000) / 10}% ÷ 12 (근사값)로 채웁니다.` : ''));
    }
    paintResult();
  }

  function clearAll() {
    cols.forEach((c) => Object.assign(c, { lump: null, m1: null, m2: null, hw: null, infra: null, from: '', term: c.dep === 'ONPREM_LUMP' ? 12 : 60 }));
    paint();
  }

  async function pickQuote() {
    let list = [];
    try { list = (await api.listQuotes({ size: 100 })).quotes || []; } catch (err) { return toast(err.message, 'err'); }
    list = list.filter((q) => OPTIONS.some(([d]) => d === q.deployment));
    const search = h('input', { class: 'ss-input', placeholder: '수신처 · 견적번호', style: 'width:100%' });
    const box = h('div', { style: 'max-height:420px;overflow:auto;margin-top:8px' });
    const paintList = () => {
      const t = search.value.trim().toLowerCase();
      clear(box);
      const rows = list.filter((q) => !t || String(q.customer_name || '').toLowerCase().includes(t) || String(q.quote_no).toLowerCase().includes(t));
      if (!rows.length) box.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '견적이 없습니다.'));
      box.appendChild(h('table', { class: 'ss-grid', style: 'width:100%' },
        h('thead', {}, h('tr', {}, h('th', {}, '견적번호'), h('th', {}, '수신처'), h('th', {}, '구축형태'), h('th', {}, '일시불'), h('th', {}, '월 사용료'))),
        h('tbody', {}, ...rows.map((q) => h('tr', { style: 'cursor:pointer', onclick: () => { apply(q); m.close(); } },
          h('td', { class: 'ss-cell--link' }, q.quote_no), h('td', {}, q.customer_name || ''),
          h('td', { style: 'text-align:center' }, (OPTIONS.find(([d]) => d === q.deployment) || [])[1] || q.deployment),
          h('td', { style: 'text-align:right' }, won(q.onetime_total)), h('td', { style: 'text-align:right' }, won(q.monthly_total)))))));
    };
    search.addEventListener('input', paintList);
    const m = openModal({ title: '견적 불러오기 — 그 견적의 구축형태 칸에 채웁니다', body: h('div', { style: 'min-width:720px' }, search, box) });
    paintList();
  }

  function apply(q) {
    const c = cols.find((x) => x.dep === q.deployment);
    if (!c) return;
    const lump = n(q.onetime_total);
    const mon = n(q.monthly_total);
    if (c.dep === 'ONPREM_LUMP') {
      Object.assign(c, { lump, m1: 0, term: maint ? n(maint.free_months) : 12, m2: maint && maint.calc_type === 'RATE' ? Math.round(lump * n(maint.rate) / 12) : 0 });
    } else {
      Object.assign(c, { lump, m1: mon, m2: mon });
    }
    c.from = `${q.quote_no} · ${q.customer_name || ''}`;
    toast(`${c.name} 칸에 ${q.quote_no} 금액을 채웠습니다.`, 'ok');
    paint();
  }

  paint();
}

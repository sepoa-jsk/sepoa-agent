import { api } from '../api.js';
import { h, toast, clear, won, numInput, openModal } from '../ui.js';

// TCO 비교(시뮬레이션) — 2026-10-31. 저장하지 않는 계산 화면이다(새 표 없음).
// 1차: SaaS 만, 5년 · 10년. 값을 직접 넣거나 [견적 불러오기]로 저장된 SaaS 견적의 금액을 채운다.
//   TCO = 초기 구축비(일시불) + 월 사용료 × 개월
// 구축형 일시불 · 분납 · Private Cloud 는 다음 단계에서 붙인다. 부가세 별도, 단위 원.
const PERIODS = [5, 10];

export async function renderTco(root) {
  const v = { lump: null, monthly: null, from: '' };
  const n = (x) => Number(x) || 0;

  root.appendChild(h('div', { class: 'ss-edithead' },
    h('div', { class: 'ss-edithead__fields' }),
    h('div', { class: 'ss-actions' },
      h('button', { class: 'ss-btn ss-btn--default', onclick: clearAll }, '비우기'),
      h('button', { class: 'ss-btn ss-btn--save', onclick: pickQuote }, '견적 불러오기'))));
  const body = h('div', {});
  root.appendChild(body);

  function paint() {
    clear(body);
    const field = (label, key) => h('div', { class: 'ss-field' }, h('label', {}, label),
      numInput(v[key] ?? '', (t) => { v[key] = t === '' ? null : Number(t); paintResult(); },
        { class: 'ss-input', style: 'text-align:right', 'aria-label': label }));
    body.append(
      h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ SaaS 비용 입력'),
        v.from ? h('span', { style: 'font-size:12.5px;color:var(--ss-ink-2);margin-left:12px' }, `불러온 견적: ${v.from}`) : null,
        h('div', { class: 'ss-detailbar__spacer' }),
        h('span', { class: 'ss-detailbar__note' }, '단위: 원, 부가세 별도. 저장하지 않는 계산 화면입니다.')),
      h('div', { class: 'ss-form ss-form--cols4', style: 'max-width:none;margin:8px 0 0' },
        h('div', { class: 'ss-fields' }, field('초기 구축비 (일시불)', 'lump'), field('월 사용료', 'monthly'))));
    const result = h('div', {});
    body.appendChild(result);

    function paintResult() {
      clear(result);
      const empty = v.lump == null && v.monthly == null;
      const cell = (x) => h('td', { style: 'text-align:right' }, empty ? '-' : won(x));
      const rows = [
        ['초기 구축비', () => n(v.lump)],
        ['월 사용료 × 개월', (y) => n(v.monthly) * y * 12],
      ];
      const w = [260, ...PERIODS.map(() => 200)];
      result.append(
        h('div', { class: 'ss-detailbar', style: 'margin-top:16px' },
          h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ TCO 합계')),
        h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' },
          h('table', { class: 'ss-grid ss-grid--sized', style: `width:${w.reduce((a, x) => a + x, 0)}px` },
            h('colgroup', {}, ...w.map((x) => h('col', { style: `width:${x}px` }))),
            h('thead', {}, h('tr', {}, h('th', {}, '구분'), ...PERIODS.map((y) => h('th', {}, `${y}년 (${y * 12}개월)`)))),
            h('tbody', {},
              ...rows.map(([label, f]) => h('tr', {}, h('td', { style: 'text-align:left' }, label), ...PERIODS.map((y) => cell(f(y))))),
              h('tr', { style: 'background:#F4F9E3;font-weight:700' }, h('td', { style: 'text-align:left' }, 'TCO 합계'),
                ...PERIODS.map((y) => cell(rows.reduce((a, [, f]) => a + f(y), 0))))))),
        h('div', { class: 'ss-detailbar__note', style: 'margin-top:8px' }, '계산: 초기 구축비 + 월 사용료 × 개월'));
    }
    paintResult();
  }

  function clearAll() {
    Object.assign(v, { lump: null, monthly: null, from: '' });
    paint();
  }

  async function pickQuote() {
    let list = [];
    try { list = (await api.listQuotes({ size: 100 })).quotes || []; } catch (err) { return toast(err.message, 'err'); }
    list = list.filter((q) => q.deployment === 'SAAS');
    const search = h('input', { class: 'ss-input', placeholder: '수신처 · 견적번호', style: 'width:100%' });
    const box = h('div', { style: 'max-height:420px;overflow:auto;margin-top:8px' });
    const paintList = () => {
      const t = search.value.trim().toLowerCase();
      clear(box);
      const rows = list.filter((q) => !t || String(q.customer_name || '').toLowerCase().includes(t) || String(q.quote_no).toLowerCase().includes(t));
      if (!rows.length) box.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, 'SaaS 견적이 없습니다.'));
      box.appendChild(h('table', { class: 'ss-grid', style: 'width:100%' },
        h('thead', {}, h('tr', {}, h('th', {}, '견적번호'), h('th', {}, '수신처'), h('th', {}, '일시불'), h('th', {}, '월 사용료'))),
        h('tbody', {}, ...rows.map((q) => h('tr', { style: 'cursor:pointer', onclick: () => { apply(q); m.close(); } },
          h('td', { class: 'ss-cell--link' }, q.quote_no), h('td', {}, q.customer_name || ''),
          h('td', { style: 'text-align:right' }, won(q.onetime_total)), h('td', { style: 'text-align:right' }, won(q.monthly_total)))))));
    };
    search.addEventListener('input', paintList);
    const m = openModal({ title: '견적 불러오기 — SaaS 견적', body: h('div', { style: 'min-width:600px' }, search, box) });
    paintList();
  }

  function apply(q) {
    Object.assign(v, { lump: n(q.onetime_total), monthly: n(q.monthly_total), from: `${q.quote_no} · ${q.customer_name || ''}` });
    toast(`${q.quote_no} 금액을 채웠습니다.`, 'ok');
    paint();
  }

  paint();
}

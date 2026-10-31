import { api } from '../api.js';
import { h, clear, resizableColumns, statusBadge } from '../ui.js';

// 발송·열람 현황(견적관리) — 2026-10-31. 견적 메일 발송 이력(sq_quote_dispatch, V10) 조회.
// L1 조회형 — 머리(기간 · 검색) + 건수 줄 + 목록. 견적번호를 누르면 그 견적 상세로 간다.
// 열람(고객이 메일 · 견적서를 열었는지)은 아직 추적하지 않는다 — 링크 방식 추적을 붙이면 '열람' 칸이 생긴다.
const RESULT = { SENT: ['발송', 'var(--ss-date, #0AB169)'], FAILED: ['실패', 'var(--ss-danger, #FF5252)'], DRY_RUN: ['시험 발송', 'var(--ss-ink-3)'] };
const icon = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const when = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');

export async function renderDispatch(root) {
  const today = new Date();
  const from = h('input', { type: 'date', class: 'ss-input', value: ymd(new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())), 'aria-label': '시작일' });
  const to = h('input', { type: 'date', class: 'ss-input', value: ymd(today), 'aria-label': '종료일' });
  const q = h('input', { placeholder: '견적번호 · 수신처 · 받는 사람', 'aria-label': '검색', onkeydown: (e) => { if (e.key === 'Enter') load(); } });
  root.appendChild(h('div', { class: 'ss-edithead' },
    h('div', { class: 'ss-edithead__fields', style: 'grid-template-columns:140px 14px 140px 260px;align-items:center' },
      from, h('span', { style: 'text-align:center' }, '~'), to,
      h('div', { class: 'ss-search' }, q, h('button', { class: 'ss-search__btn', 'aria-label': '검색', html: icon.search, onclick: () => load() }))),
    h('div', { class: 'ss-actions' }, h('button', { class: 'ss-btn ss-btn--save', onclick: () => load() }, '조회'))));
  const summary = h('div', { class: 'ss-detailbar', style: 'margin-top:12px' });
  root.appendChild(summary);

  const COLS = [['발송일시', 130], ['견적번호', 140], ['수신처', 170], ['받는 사람', 230], ['참조', 180], ['제목', 300],
    ['첨부', 90], ['결과', 80], ['보낸 사람', 90], ['견적 상태', 80], ['실패 사유', 260]];
  const tbody = h('tbody');
  const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${COLS.reduce((a, [, w]) => a + w, 0)}px` },
    h('colgroup', {}, ...COLS.map(([, w]) => h('col', { style: `width:${w}px` }))),
    h('thead', {}, h('tr', {}, ...COLS.map(([t]) => h('th', {}, t)))),
    tbody);
  root.appendChild(h('div', { class: 'ss-gridwrap ss-gridwrap--fill', style: 'margin-top:8px' }, table));
  resizableColumns(table, 'quote2:dispatch-cols');
  const empty = (t) => clear(tbody).appendChild(h('tr', {}, h('td', { colspan: COLS.length, class: 'ss-cell--empty' }, t)));

  async function load() {
    empty('불러오는 중...');
    clear(summary);
    let rows;
    try {
      ({ rows } = await api.dispatch({ from: from.value, to: to.value, q: q.value.trim() }));
    } catch (err) { empty(err.message); return; }
    const count = (k) => rows.filter((r) => r.result === k).length;
    const quotes = new Set(rows.filter((r) => r.result === 'SENT').map((r) => r.quote_id)).size;
    summary.append(h('span', { style: 'font-size:12.5px;color:var(--ss-ink-2)' },
      `전체 ${rows.length}건 · 발송 ${count('SENT')}건(견적 ${quotes}개) · 실패 ${count('FAILED')}건 · 시험 발송 ${count('DRY_RUN')}건`),
    h('div', { class: 'ss-detailbar__spacer' }),
    h('span', { class: 'ss-detailbar__note' }, '열람 여부는 아직 추적하지 않습니다.'));
    if (!rows.length) { empty('기간 안에 발송한 견적이 없습니다.'); return; }
    clear(tbody);
    for (const r of rows) {
      const [label, color] = RESULT[r.result] || [r.result, ''];
      tbody.appendChild(h('tr', {},
        h('td', { style: 'text-align:center' }, when(r.sent_at)),
        h('td', { class: 'ss-cell--link', style: 'text-align:center;cursor:pointer', title: '견적 상세 열기',
          onclick: () => { if (r.quote_id) location.hash = `#/quotes/${r.quote_id}`; } }, r.quote_no || ''),
        h('td', {}, r.customer_name || ''),
        h('td', { title: r.to_addrs }, r.to_addrs || ''),
        h('td', { title: r.cc_addrs || '' }, r.cc_addrs || ''),
        h('td', { title: r.subject || '' }, r.subject || ''),
        h('td', { style: 'text-align:center' }, r.files || ''),
        h('td', { style: `text-align:center;color:${color};font-weight:600` }, label),
        h('td', { style: 'text-align:center' }, r.sent_by_name || ''),
        h('td', { style: 'text-align:center' }, r.quote_status ? statusBadge(r.quote_status) : ''),
        h('td', { title: r.error || '' }, r.error || '')));
    }
  }
  load();
}

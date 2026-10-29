import { api } from '../api.js';
import { store } from '../app.js';
import { h, won, fmtDate, toast, loading, clear, confirmModal, openModal } from '../ui.js';

// 견적 상세 — 2026-10-29 다시 만듦. L2 읽기 전용 변형.
// 우상단 액션(목록 · 수정 · 복사 · 견적서 보기 · 삭제) → 섹션 폼(기본 정보 / 견적 유형 / 금액) → 견적조건 → 견적 구성 그리드.
// 상태만 이 화면에서 바로 바꾼다(PATCH /status). 나머지 값은 수정(위저드)에서 고친다.
// 복사는 같은 내용으로 새 견적(새 번호 · 작성중 · 견적일 오늘)을 만들고 바로 수정 화면을 연다.
// 견적서 보기는 PDF 와 같은 렌더러로 그린 견적서를 띄우고, 인쇄로 PDF 를 저장할 수 있다.
// 구 섹션형 견적(블록 없음)은 수정만 예전 화면으로 가고, 복사 · 견적서 보기는 막는다.

const STATUS_FLOW = [['DRAFT', '작성중'], ['SENT', '발송'], ['WON', '수주'], ['LOST', '실주']];
const TYPE_LABEL = { BUILD: '구축·서비스', MAINT: '유지보수', ADDDEV: '추가개발' };
const DEP_LABEL = { ONPREM_LUMP: '구축형 일시불', ONPREM_INSTALL: '구축형 분납', SAAS: 'SaaS', PCLOUD: 'Private Cloud', ONPREM: '구축형' };
const num = (v) => Number(v) || 0;

export async function renderDetail(root, id) {
  root.appendChild(loading());
  let quote;
  try {
    ({ quote } = await api.getQuote(id));
  } catch (err) {
    clear(root).appendChild(h('div', { class: 'empty' }, err.message));
    return;
  }
  clear(root);
  const isBlock = (quote.blocks || []).length > 0;

  // 메모에 접어 둔 값 — [견적용도] … 형식
  const memoStr = String(quote.memo || '');
  const tag = (t) => { const m = memoStr.match(new RegExp('\\[' + t + '\\]\\s*(.+)')); return m ? m[1].trim() : ''; };

  // ── 우상단 액션 ──
  const btn = (label, onclick, attrs = {}) => h('button', { class: 'ss-btn ss-btn--save', onclick, ...attrs }, label);
  root.appendChild(h('div', { class: 'ss-formhead' }, h('div', { class: 'ss-actions' },
    btn('목록', () => { location.hash = '#/quotes'; }),
    btn('수정', () => { location.hash = `#/quotes/${id}/edit`; }),
    btn('복사', onCopy, isBlock ? {} : { disabled: true, title: '구 견적(섹션형)은 복사할 수 없습니다' }),
    btn('견적서 보기', onView, isBlock ? {} : { disabled: true, title: '구 견적(섹션형)은 지원하지 않습니다' }),
    h('button', { class: 'ss-btn ss-btn--delete', onclick: onDelete }, '삭제'))));

  // ── 섹션 폼 ──
  const ro = (v, amount) => h('input', { class: 'ss-input' + (amount ? ' ss-input--amount' : ''), value: v ?? '', disabled: true });
  const field = (label, ctrl, cls = '') => h('div', { class: 'ss-field ' + cls }, h('label', {}, label), ctrl);
  const section = (legend, ...fields) => h('fieldset', { class: 'ss-section' }, h('legend', {}, legend), h('div', { class: 'ss-fields' }, ...fields));

  const statusSel = h('select', { class: 'ss-select', onchange: async () => {
    try { await api.setStatus(id, statusSel.value); quote.status = statusSel.value; toast('상태가 변경되었습니다.', 'ok'); }
    catch (err) { toast(err.message, 'err'); statusSel.value = quote.status; }
  } }, ...STATUS_FLOW.map(([v, l]) => h('option', { value: v, selected: v === quote.status }, l)));

  const form = h('div', { class: 'ss-form ss-form--cols4' }); // 섹션 안 4칸 격자, 폼 블록은 가운데 944px
  form.appendChild(section('견적 기본 정보',
    field('견적번호', ro(quote.quote_no)),
    field('상태', statusSel),
    field('견적일자', ro(fmtDate(quote.quote_date))),
    field('견적유효일', ro(quote.valid_until ? fmtDate(quote.valid_until) : '견적일로부터 30일')),
    field('수신처 (고객사)', ro(quote.customer_name), 'ss-field--w2'),
    field('담당자', ro(quote.customer_contact)),
    field('작성자', ro(quote.created_by_name || '')),
    field('연락처', ro(tag('연락처'))),
    field('이메일', ro(tag('이메일'))),
    field('결제조건', ro(tag('결제조건'))),
    field('특별 DC', ro(tag('특별DC'))),
    field('견적용도', ro(tag('견적용도')), 'ss-field--full')));

  if (isBlock) {
    form.appendChild(section('견적 유형',
      field('유형', ro(TYPE_LABEL[quote.quote_type] || quote.quote_type)),
      field('구축형태', ro(DEP_LABEL[quote.deployment] || quote.deployment)),
      field('솔루션', ro(store.solutionName(quote.solution) || '')),
      field('템플릿', ro(quote.template_code)),
      field('브랜드', ro(quote.brand))));
  }

  // 금액 — 블록형은 일시불/월 분리(소계 → 특별DC → 절사 → 부가세), 구 견적은 공급가 · 할인 · 부가세 · 합계
  if (isBlock) {
    const oneSub = quote.blocks.filter((b) => !b.recurring).reduce((a, b) => a + num(b.subtotal), 0);
    const monSub = quote.blocks.filter((b) => b.recurring).reduce((a, b) => a + num(b.subtotal), 0);
    const one = num(quote.onetime_total), mon = num(quote.monthly_total);
    form.appendChild(section('금액 (원, 부가세 별도)',
      field('일시불 소계', ro(won(oneSub), true)),
      field('특별 DC · 절사', ro(oneSub - one ? '-' + won(oneSub - one) : '0', true)),
      field('최종견적금액', ro(one === 0 && oneSub ? '무상제공' : won(one), true)),
      field('부가세 (10%)', ro(won(quote.vat_amount), true)),
      ...(monSub ? [
        field('월 사용료 소계', ro(won(monSub), true)),
        field('월 특별 DC', ro(monSub - mon ? '-' + won(monSub - mon) : '0', true)),
        field('월 사용료', ro(won(mon), true)),
      ] : [])));
  } else {
    form.appendChild(section('금액 (원)',
      field('공급가액', ro(won(quote.supply_amount), true)),
      field('할인', ro(quote.discount_amount ? '-' + won(quote.discount_amount) : '0', true)),
      field('부가세 (10%)', ro(won(quote.vat_amount), true)),
      field('합계금액', ro(won(quote.total_amount), true))));
  }

  const conds = (Array.isArray(quote.conditions) ? quote.conditions : []).map((c) => (typeof c === 'string' ? c : c.text)).filter(Boolean);
  form.appendChild(h('fieldset', { class: 'ss-section' }, h('legend', {}, '견적조건'),
    h('div', { style: 'padding-top:8px;font-size:13px;line-height:1.8;color:var(--ss-ink-2)' },
      ...(conds.length ? conds.map((c) => h('div', {}, '-. ' + c)) : [h('div', { style: 'color:var(--ss-ink-3)' }, '저장된 견적조건이 없습니다. 견적서에는 템플릿의 견적조건이 들어갑니다.')]))));
  root.appendChild(form);

  // ── 견적 구성 그리드 ──
  const groups = isBlock
    ? quote.blocks.map((b) => ({
      title: b.title || b.block_code, recurring: b.recurring, subtotal: b.subtotal,
      rows: [
        ...(b.items || []).map((it) => ({ gubun: it.category || '', name: it.name, spec: it.spec, qty: it.qty, unit: it.unit,
          base: it.base_price, price: it.proposed_price ?? it.unit_price, amount: it.amount })),
        // 금액이 되는 인력은 개발인건비(LABOR) 블록뿐이다 — 다른 블록의 인력은 공수 배분(인력투입계획)용
        ...(b.block_code === 'LABOR' ? (b.labor || []).map((l) => ({
          gubun: '개발인건비', name: (l.role_label || l.role_name || l.role_code) + (l.grade ? ` (${l.grade})` : ''),
          spec: l.task, qty: l.mm, unit: 'MM', base: l.base_price, price: l.proposed_price, amount: l.amount })) : []),
      ],
    }))
    : (quote.sections || []).map((s) => ({
      title: `${store.solutionName(s.solution)} - ${store.deploymentName(s.deployment)}`, subtotal: s.subtotal,
      rows: (s.items || []).map((it) => ({ gubun: it.category || '', name: it.name, spec: it.spec, qty: it.qty, unit: it.unit,
        base: it.base_price, price: it.unit_price, amount: it.amount })),
    }));
  const rowCount = groups.reduce((a, g) => a + g.rows.length, 0);

  root.appendChild(h('div', { class: 'ss-detailbar' },
    h('span', { style: 'font-size:15px;font-weight:500;color:var(--ss-ink-2)' }, '견적 구성'),
    h('div', { class: 'ss-detailbar__spacer' }),
    h('span', { class: 'ss-detailbar__count' }, h('b', {}, String(rowCount)), ' 건')));

  const widths = [170, 120, 220, 360, 90, 130, 130, 140];
  const tbody = h('tbody');
  for (const g of groups) {
    g.rows.forEach((r, i) => tbody.appendChild(h('tr', {},
      h('td', { class: 'ss-cell--left', style: 'font-weight:500' }, i === 0 ? g.title + (g.recurring ? ' (월)' : '') : ''),
      h('td', { class: 'ss-cell--left' }, r.gubun),
      h('td', { class: 'ss-cell--left' }, r.name || ''),
      h('td', { class: 'ss-cell--left', title: r.spec || '' }, r.spec || ''),
      h('td', { style: 'text-align:right' }, `${num(r.qty)}${r.unit === 'MM' ? ' MM' : ''}`),
      h('td', { style: 'text-align:right' }, r.base != null && num(r.base) > 0 ? won(r.base) : ''),
      h('td', { style: 'text-align:right' }, won(r.price)),
      h('td', { class: 'ss-cell--amount' }, num(r.qty) === 0 ? '-' : won(r.amount)))));
    if (!g.rows.length) {
      tbody.appendChild(h('tr', {}, h('td', { class: 'ss-cell--left', style: 'font-weight:500' }, g.title),
        h('td', { colspan: 7, class: 'ss-cell--empty' }, '항목 없음')));
    }
    tbody.appendChild(h('tr', { style: 'background:#F8FAFC;font-weight:600' },
      h('td', { class: 'ss-cell--left' }, `소계${g.recurring ? ' (월)' : ''}`), h('td', { colspan: 6 }),
      h('td', { class: 'ss-cell--amount' }, won(g.subtotal))));
  }
  if (!groups.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 8, class: 'ss-cell--empty' }, '견적 구성이 없습니다.')));
  root.appendChild(h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;margin-bottom:24px' },
    h('table', { class: 'ss-grid ss-grid--sized', style: `width:${widths.reduce((a, w) => a + w, 0)}px` },
      h('colgroup', {}, ...widths.map((w) => h('col', { style: `width:${w}px` }))),
      h('thead', {}, h('tr', {}, ...['블록', '구분', '품목 · 역할', '세부내역', '수량', '기준단가 (원)', '제안단가 (원)', '금액 (원)'].map((t) => h('th', {}, t)))),
      tbody)));

  // ── 액션 ──
  async function onCopy() {
    const ok = await confirmModal({ title: '견적 복사', message: `${quote.quote_no} 견적을 같은 내용으로 새로 만듭니다. 새 견적번호가 붙고 견적일은 오늘이 됩니다. 만든 뒤 바로 수정 화면이 열립니다.`, okLabel: '복사' });
    if (!ok) return;
    try {
      const { quote: nq } = await api.copyQuote(id);
      toast(`${nq.quote_no} 견적을 만들었습니다.`, 'ok');
      location.hash = `#/quotes/${nq.id}/edit`;
    } catch (err) { toast(err.message, 'err'); }
  }

  async function onView() {
    const frame = h('iframe', { style: 'width:100%;height:72vh;border:1px solid #E7EAF0;background:#fff' });
    const printBtn = h('button', { class: 'btn', disabled: true, onclick: () => frame.contentWindow.print() }, '인쇄 · PDF 저장');
    const m = openModal({
      title: `견적서 — ${quote.quote_no}`,
      body: frame,
      footer: [printBtn, h('button', { class: 'btn btn-primary', onclick: () => m.close() }, '닫기')],
    });
    const box = m.back.querySelector('.modal');
    box.style.width = '880px';
    box.querySelector('.modal-body').style.padding = '12px';
    try {
      const r = await api.quoteHtml(id);
      frame.srcdoc = r.html;
      printBtn.disabled = false;
    } catch (err) {
      frame.replaceWith(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message));
    }
  }

  async function onDelete() {
    const ok = await confirmModal({ title: '견적 삭제', message: `${quote.quote_no} 견적을 삭제하시겠습니까? 되돌릴 수 없습니다.`, okLabel: '삭제', danger: true });
    if (!ok) return;
    try { await api.deleteQuote(id); toast('삭제되었습니다.', 'ok'); location.hash = '#/quotes'; }
    catch (err) { toast(err.message, 'err'); }
  }
}

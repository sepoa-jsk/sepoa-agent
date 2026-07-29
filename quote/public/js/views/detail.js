import { api } from '../api.js';
import { store } from '../app.js';
import { h, won, wonSuffix, fmtDate, statusBadge, toast, loading, clear, confirmModal } from '../ui.js';

const STATUS_FLOW = [['DRAFT', '작성중'], ['SENT', '발송'], ['WON', '수주'], ['LOST', '실주']];

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

  const statusSel = h('select', { class: 'select', onchange: async () => {
    try { await api.setStatus(id, statusSel.value); quote.status = statusSel.value; badgeSlot.replaceChildren(statusBadge(quote.status)); toast('상태가 변경되었습니다.', 'ok'); }
    catch (err) { toast(err.message, 'err'); statusSel.value = quote.status; }
  } }, ...STATUS_FLOW.map(([v, l]) => h('option', { value: v, selected: v === quote.status }, l)));

  const badgeSlot = h('span', {}, statusBadge(quote.status));

  root.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'page-title' }, h('span', {}, quote.quote_no), ' ', badgeSlot),
      h('div', { class: 'page-sub' }, `${quote.customer_name || '고객사 미지정'} · 견적일 ${fmtDate(quote.quote_date)}`)
    ),
    h('div', { class: 'page-actions' },
      statusSel,
      h('a', { class: 'btn', href: `#/quotes/${id}/edit` }, '수정'),
      h('a', { class: 'btn btn-navy', href: api.excelUrl(id), download: true }, 'Excel 다운로드'),
      h('button', { class: 'btn btn-danger', onclick: onDelete }, '삭제')
    )
  ));

  // 메타
  root.appendChild(h('div', { class: 'panel' },
    h('div', { class: 'panel-body' },
      h('div', { class: 'detail-meta' },
        meta('견적번호', quote.quote_no),
        meta('견적일', fmtDate(quote.quote_date)),
        meta('유효기간', quote.valid_until ? fmtDate(quote.valid_until) : '견적일로부터 30일'),
        meta('고객사', quote.customer_name || '-'),
        meta('담당자', quote.customer_contact || '-'),
        meta('작성자', quote.created_by_name || '-')
      )
    )
  ));

  // 섹션별 품목
  for (const sec of quote.sections) {
    const tbody = h('tbody');
    for (const it of sec.items) {
      tbody.appendChild(h('tr', {},
        h('td', {}, h('span', { class: 'tag' }, it.category || '-')),
        h('td', {}, h('div', {}, h('strong', {}, it.name)), it.spec ? h('div', { class: 'page-sub' }, it.spec) : null),
        h('td', { class: 'center nowrap' }, it.unit || '-'),
        h('td', { class: 'center' }, Number(it.qty)),
        h('td', { class: 'center' }, it.months > 1 ? `${it.months}개월` : '-'),
        h('td', { class: 'num' }, won(it.unit_price)),
        h('td', { class: 'num' }, h('strong', {}, won(it.amount))),
        h('td', {}, it.note ? h('span', { class: 'page-sub' }, it.note) : '')
      ));
    }
    root.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('span', {}, `[${store.solutionName(sec.solution)} - ${store.deploymentName(sec.deployment)}]`
          + (sec.company_class ? ` · ${sec.company_class}` : '')
          + (sec.contract_months > 1 ? ` · 계약 ${sec.contract_months}개월` : '')),
        h('span', { class: 'num' }, '소계 ', h('strong', {}, wonSuffix(sec.subtotal)))
      ),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'grid' },
          h('thead', {}, h('tr', {},
            h('th', {}, '구분'), h('th', {}, '품목 / 규격'), h('th', { class: 'center' }, '단위'),
            h('th', { class: 'center' }, '수량'), h('th', { class: 'center' }, '개월'),
            h('th', { class: 'num' }, '단가'), h('th', { class: 'num' }, '금액'), h('th', {}, '비고')
          )),
          tbody
        )
      )
    ));
  }

  // 합계
  root.appendChild(h('div', { class: 'panel' },
    h('div', { class: 'panel-body' },
      h('div', { style: 'max-width:340px;margin-left:auto' },
        sumRow('공급가액', won(quote.supply_amount)),
        sumRow('할인' + (quote.discount_type === 'RATE' ? ` (${quote.discount_value}%)` : ''), quote.discount_amount ? '-' + won(quote.discount_amount) : '0'),
        sumRow('부가세 (VAT 10%)', won(quote.vat_amount)),
        h('div', { class: 'summary-row total' }, h('span', {}, '합계금액'), h('span', {}, wonSuffix(quote.total_amount)))
      )
    )
  ));

  // 견적조건 (저장된 conditions)
  if (Array.isArray(quote.conditions) && quote.conditions.length) {
    root.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, '견적조건'),
      h('div', { class: 'panel-body' },
        h('div', { style: 'display:flex;flex-direction:column;gap:7px' },
          ...quote.conditions.map((c) => h('div', { style: 'color:var(--text-sub);font-size:13px;line-height:1.5' }, '-. ' + (c.text || '')))))
    ));
  }

  // 견적 정보 (memo 태그 파싱) — 태그 원문을 그대로 뿌리지 않고 라벨로 표시
  const memoStr = String(quote.memo || '');
  const tag = (t) => { const m = memoStr.match(new RegExp('\\[' + t + '\\]\\s*(.+)')); return m ? m[1].trim() : ''; };
  const MEMO_FIELDS = [
    ['견적용도', '견적용도'], ['결제조건', '결제조건'], ['부가세', '부가세'],
    ['상주', '상주여부'], ['특별DC', '특별 DC'], ['연락처', '연락처'], ['이메일', '이메일'],
  ];
  const infoRows = MEMO_FIELDS.map(([t, label]) => { const v = tag(t); return v ? meta(label, v) : null; }).filter(Boolean);
  if (infoRows.length) {
    root.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, '견적 정보'),
      h('div', { class: 'panel-body' }, h('div', { class: 'detail-meta' }, ...infoRows))
    ));
  }
  // 태그가 아닌 자유 비고 줄만 별도 표시
  const freeMemo = memoStr.split(/\r?\n/).filter((l) => l.trim() && !/^\s*\[[^\]]+\]/.test(l)).join('\n');
  if (freeMemo) {
    root.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, '비고'),
      h('div', { class: 'panel-body', style: 'white-space:pre-wrap;color:var(--text-sub)' }, freeMemo)
    ));
  }

  function meta(k, v) { return h('div', { class: 'meta-item' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }
  function sumRow(k, v) { return h('div', { class: 'summary-row' }, h('span', { class: 'lbl' }, k), h('span', {}, v)); }

  async function onDelete() {
    const ok = await confirmModal({ title: '견적 삭제', message: `${quote.quote_no} 견적을 삭제하시겠습니까? 되돌릴 수 없습니다.`, okLabel: '삭제', danger: true });
    if (!ok) return;
    try { await api.deleteQuote(id); toast('삭제되었습니다.', 'ok'); location.hash = '#/quotes'; }
    catch (err) { toast(err.message, 'err'); }
  }
}

// 기존 견적서 불러오기 창 — 템플릿 불러오기와 따로 둔다(2026-10-30 사용자 요청).
// 템플릿은 '틀'에서 시작하고, 이 창은 이미 작성한 견적서의 구성 · 단가 · 특별DC · 결제 방안 · 견적조건을 그대로 가져온다.
// 왼쪽: 저장된 견적 목록(고객사 · 견적번호 검색) / 오른쪽: 고른 견적의 견적서 미리보기(저장된 그대로).
// [미리보기] — 고른 견적서를 큰 창(견적서 보기와 같은 창)으로 띄운다(2026-10-31 사용자 요청).
// [불러오기] 를 누르면 onPick({ quote }) — quote 는 GET /api/quotes/{id} 응답. 상태 반영은 위저드(index.js)가 한다.
import { api as http } from '../../../api.js';
import { h, won, clear, openModal } from '../../../ui.js';
import { viewQuote } from '../quote-actions.js';

const DEP_LABEL = { ONPREM_LUMP: '구축형 일시불', ONPREM_INSTALL: '구축형 분납', SAAS: 'SaaS', PCLOUD: 'Private Cloud' };
const STATUS_LABEL = { DRAFT: '작성중', SUBMITTED: '제출', SENT: '발송', WON: '수주', LOST: '실주' };
const purposeOf = (memo) => (String(memo || '').match(/\[견적용도\]\s*(.+)/) || [])[1] || '';
const looksLikeQuoteNo = (s) => /^(qt|s)?\d/i.test(s);

export async function openQuotePicker({ currentId, onPick }) {
  let quotes = [];
  let picked = null;           // { quote }
  let seq = 0;                 // 늦게 온 응답이 새 선택을 덮지 않게

  const search = h('input', { class: 'ss-input', placeholder: '고객사 · 견적번호 검색 (Enter)', style: 'flex:1;min-width:0',
    onkeydown: (e) => { if (e.key === 'Enter') load(); } });
  const findBtn = h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => load() }, '조회');
  const list = h('div', { style: 'flex:1;overflow:auto;border-top:1px solid #E7EAF0' });
  const info = h('div', { style: 'font-size:12px;color:var(--ss-ink-3);min-height:18px' }, '왼쪽에서 견적서를 고르세요.');
  const frame = h('iframe', { style: 'flex:1;width:100%;border:1px solid #E7EAF0;background:#fff' });
  const okBtn = h('button', { class: 'btn btn-primary', disabled: true }, '불러오기');
  const previewBtn = h('button', { class: 'btn', disabled: true, onclick: () => { if (picked) viewQuote(picked.quote); } }, '미리보기');

  const body = h('div', { style: 'display:grid;grid-template-columns:360px 1fr;gap:12px;height:70vh' },
    h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-height:0' },
      h('div', { style: 'display:flex;gap:6px' }, search, findBtn), list),
    h('div', { style: 'display:flex;flex-direction:column;gap:6px;min-height:0' }, info, frame));

  const m = openModal({
    title: '기존 견적서 불러오기',
    body,
    footer: [h('span', { style: 'margin-right:auto;font-size:12px;color:var(--ss-ink-3)' },
      '구성 · 단가 · 특별DC · 결제 방안 · 견적조건을 가져옵니다. 지금 입력한 기본정보(수신처 등)는 그대로 둡니다.'),
    previewBtn, h('button', { class: 'btn', onclick: () => m.close() }, '취소'), okBtn],
  });
  const box = m.back.querySelector('.modal');
  box.style.width = '1180px';
  box.querySelector('.modal-body').style.padding = '12px';
  okBtn.onclick = () => { if (picked) { m.close(); onPick(picked); } };

  function paintList() {
    clear(list);
    const rows = quotes.filter((q) => q.id !== currentId); // 지금 고치는 견적 자신은 뺀다
    if (!rows.length) { list.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '견적서가 없습니다.')); return; }
    for (const q of rows) {
      const on = picked && picked.quote.id === q.id;
      list.appendChild(h('div', {
        style: `padding:8px 10px;border-bottom:1px solid #EEF1F5;cursor:pointer;${on ? 'background:#EEF4FF;box-shadow:inset 3px 0 0 var(--ss-primary)' : ''}`,
        onclick: () => select(q),
      },
      h('div', { style: 'display:flex;gap:8px;align-items:baseline' },
        h('span', { style: 'color:var(--ss-emphasis);font-size:12px;font-weight:500' }, q.quote_no),
        h('span', { style: 'font-size:11px;color:var(--ss-ink-3)' }, `${String(q.quote_date || '').slice(0, 10)} · ${STATUS_LABEL[q.status] || q.status || ''}`)),
      h('div', { style: 'font-size:13px;color:var(--ss-ink-2);margin-top:2px' }, q.customer_name || '(수신처 없음)'),
      h('div', { style: 'font-size:11px;color:var(--ss-ink-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' },
        `${DEP_LABEL[q.deployment] || q.deployment || ''} · ${won(q.total_amount)}원${purposeOf(q.memo) ? ' · ' + purposeOf(q.memo) : ''}`)));
    }
  }

  async function load() {
    const s = search.value.trim();
    clear(list).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '불러오는 중...'));
    try {
      const r = await http.listQuotes({ ...(s ? { [looksLikeQuoteNo(s) ? 'quote_no' : 'customer']: s } : {}), page: 1, size: 50 });
      quotes = r.quotes || [];
      paintList();
    } catch (err) {
      clear(list).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, err.message));
    }
  }

  async function select(q) {
    const my = ++seq;
    picked = null; okBtn.disabled = true; previewBtn.disabled = true;
    paintList();
    info.textContent = `${q.quote_no} — 그리는 중...`;
    try {
      const [detail, html] = await Promise.all([http.getQuote(q.id), http.quoteHtml(q.id)]);
      if (my !== seq) return;
      frame.srcdoc = html.html;
      const quote = detail.quote || detail;
      info.textContent = `${q.quote_no} · ${q.customer_name || ''} · 일시불 ${won(quote.onetime_total)}원${Number(quote.monthly_total) ? ` / 월 ${won(quote.monthly_total)}원` : ''}`;
      picked = { quote };
      okBtn.disabled = false;
      previewBtn.disabled = false;
      paintList();
    } catch (err) {
      if (my === seq) info.textContent = err.message;
    }
  }

  await load();
}

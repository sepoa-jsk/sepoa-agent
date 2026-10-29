// 저장된 견적 한 건에 대한 동작 — 상세(견적 작성 읽기 전용) · 구 상세 화면이 같이 쓴다.
//   복사      : 같은 내용으로 새 견적(새 번호 · 작성중 · 견적일 오늘)을 만들고 수정 화면을 연다
//   견적서 보기: PDF 와 같은 렌더러로 그린 견적서(표지 포함)를 띄우고 인쇄로 PDF 를 저장한다
//   삭제      : 확인 후 지우고 목록으로 간다
import { api } from '../../api.js';
import { h, toast, confirmModal, openModal } from '../../ui.js';

export async function copyQuote(quote) {
  const ok = await confirmModal({ title: '견적 복사', okLabel: '복사',
    message: `${quote.quote_no} 견적을 같은 내용으로 새로 만듭니다. 새 견적번호가 붙고 견적일은 오늘이 됩니다. 만든 뒤 바로 수정 화면이 열립니다.` });
  if (!ok) return;
  try {
    const { quote: nq } = await api.copyQuote(quote.id);
    toast(`${nq.quote_no} 견적을 만들었습니다.`, 'ok');
    location.hash = `#/quotes/${nq.id}/edit`;
  } catch (err) { toast(err.message, 'err'); }
}

export async function viewQuote(quote) {
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
    const r = await api.quoteHtml(quote.id);
    frame.srcdoc = r.html;
    printBtn.disabled = false;
  } catch (err) {
    frame.replaceWith(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message));
  }
}

export async function deleteQuote(quote) {
  const ok = await confirmModal({ title: '견적 삭제', danger: true, okLabel: '삭제',
    message: `${quote.quote_no} 견적을 삭제하시겠습니까? 되돌릴 수 없습니다.` });
  if (!ok) return;
  try { await api.deleteQuote(quote.id); toast('삭제되었습니다.', 'ok'); location.hash = '#/quotes'; }
  catch (err) { toast(err.message, 'err'); }
}

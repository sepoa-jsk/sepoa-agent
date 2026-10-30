// 저장된 견적 한 건에 대한 동작 — 상세(견적 작성 읽기 전용) · 구 상세 화면이 같이 쓴다.
//   복사      : 같은 내용으로 새 견적(새 번호 · 작성중 · 견적일 오늘)을 만들고 수정 화면을 연다
//   견적서 보기: PDF 와 같은 렌더러로 그린 견적서(표지 포함)를 띄우고 인쇄로 PDF 를 저장한다
//   삭제      : 확인 후 지우고 목록으로 간다
//   내려받기  : PDF(표지 포함) · Excel — 서버에 저장된 내용으로 만든다
import { api } from '../../api.js';
import { h, toast, confirmModal, openModal, previewControls } from '../../ui.js';

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
  box.querySelector('.modal-foot').prepend(previewControls(frame, box));
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

// 내려받기 — 오류(예: 서버에 Chrome 없음)는 화면에 알리려고 링크 대신 fetch 로 받는다
export async function downloadQuote(quote, kind, btn) {
  const label = kind === 'pdf' ? 'PDF' : 'Excel';
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = `${label} 만드는 중…`; }
  try {
    const url = kind === 'pdf' ? api.pdfUrl(quote.id) : api.excelUrl(quote.id);
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `${label} 내려받기 실패 (${res.status})`);
    }
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    const name = m ? decodeURIComponent(m[1]) : `${quote.quote_no}.${kind === 'pdf' ? 'pdf' : 'xlsx'}`;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}

// 메일 발송 창 — 받는 사람(견적의 이메일) · 참조 · 제목 · 본문을 채워 두고, 견적서 PDF(표지 포함)를 붙인다. Excel 은 고르면.
//   보낸 사람은 시스템 주소(MAIL_FROM), 답장은 로그인한 담당자에게 간다(서버 Reply-To).
//   시험 모드(MAIL_DRY_RUN)면 창 위에 알리고, 보내지 않고 결과만 보여 준다.
//   q: { id, quote_no, customer_name, email, purpose } · onSent(result) — 실제 발송 후 상태(발송)를 화면에 반영할 때
export async function mailQuote(q, onSent) {
  let cfg = { dry_run: true, allowlist: [] };
  try { cfg = await api.mailConfig(); } catch { /* 설정을 못 읽어도 창은 연다 — 보낼 때 서버가 다시 막는다 */ }
  const me = (await import('../../app.js')).store.user || {};
  const title = q.purpose || `${q.customer_name || ''} 견적`.trim();
  const inp = (value, ph) => h('input', { class: 'ss-input', style: 'width:100%', value: value || '', placeholder: ph || '' });
  const to = inp(q.email, '받는 사람 메일 (여러 명은 쉼표로)');
  const cc = inp('', '참조 (여러 명은 쉼표로)');
  const subject = inp(`[세포아소프트] ${title} 견적서 송부 (${q.quote_no})`);
  const body = h('textarea', { class: 'ss-input', style: 'width:100%;height:170px;padding:8px 10px;line-height:1.6;resize:vertical' });
  body.value = `안녕하십니까, 세포아소프트 ${me.name || ''}입니다.\n\n요청하신 ${title} 견적서를 첨부와 같이 보내드립니다.\n검토 후 문의 사항이 있으시면 회신 부탁드립니다.\n\n감사합니다.\n\n세포아소프트 ${me.name || ''}${me.email ? '\n' + me.email : ''}`;
  const pdf = h('input', { type: 'checkbox', checked: true });
  const xls = h('input', { type: 'checkbox' });
  const field = (label, ctrl, req) => h('div', { class: 'ss-field', style: 'margin-bottom:10px' },
    h('label', {}, label, req ? h('span', { class: 'req' }, ' *') : null), ctrl);
  const notice = cfg.dry_run || (cfg.allowlist || []).length
    ? h('div', { style: 'background:#FFF8E1;border:1px solid #F5D77A;border-radius:4px;padding:8px 10px;font-size:12px;margin-bottom:12px;line-height:1.6' },
      cfg.dry_run ? h('div', {}, h('b', {}, '시험 모드'), ' — 실제로 보내지 않고 결과만 보여 줍니다. 서버 설정 MAIL_DRY_RUN=false 로 바꾸면 발송됩니다.') : null,
      (cfg.allowlist || []).length ? h('div', {}, `발송 허용 주소: ${cfg.allowlist.join(', ')}`) : null)
    : null;
  const sendBtn = h('button', { class: 'btn btn-primary' }, cfg.dry_run ? '보내기 (시험)' : '보내기');
  const m = openModal({
    title: `메일 발송 — ${q.quote_no}`,
    body: h('div', {}, notice,
      field('받는 사람', to, true), field('참조', cc), field('제목', subject, true), field('본문', body),
      h('div', { class: 'ss-field' }, h('label', {}, '첨부'),
        h('div', { style: 'display:flex;gap:18px;font-size:13px' },
          h('label', { style: 'display:flex;gap:6px;align-items:center' }, pdf, '견적서 PDF (표지 포함)'),
          h('label', { style: 'display:flex;gap:6px;align-items:center' }, xls, '견적서 Excel')))),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'), sendBtn],
  });
  m.back.querySelector('.modal').style.width = '640px';
  sendBtn.onclick = async () => {
    sendBtn.disabled = true; sendBtn.textContent = '보내는 중…';
    try {
      const r = await api.mailQuote(q.id, { to: to.value, cc: cc.value, subject: subject.value, body: body.value,
        attach_pdf: pdf.checked, attach_excel: xls.checked });
      m.close();
      if (r.dry_run) toast(`시험 모드 — 보내지 않았습니다. (받는 사람 ${r.to.join(', ')} · 첨부 ${r.attachments.join(', ') || '없음'})`, 'ok');
      else { toast(`메일을 보냈습니다: ${r.to.join(', ')}`, 'ok'); onSent?.(r); }
    } catch (err) {
      sendBtn.disabled = false; sendBtn.textContent = cfg.dry_run ? '보내기 (시험)' : '보내기';
      toast(err.message, 'err');
    }
  };
  setTimeout(() => (to.value ? subject : to).focus(), 0);
}

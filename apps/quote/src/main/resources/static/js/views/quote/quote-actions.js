// 저장된 견적 한 건에 대한 동작 — 상세(견적 작성 읽기 전용) · 구 상세 화면이 같이 쓴다.
//   복사      : 같은 내용으로 새 견적(새 번호 · 작성중 · 견적일 오늘)을 만들고 수정 화면을 연다
//   차수 추가 : 네고 요청 — 같은 내용으로 다음 차수(1차 번호 + '-2' …)를 만들고 수정 화면을 연다(V11)
//   견적서 보기: PDF 와 같은 렌더러로 그린 견적서(표지 포함)를 띄우고 인쇄로 PDF 를 저장한다
//   삭제      : 확인 후 지우고 목록으로 간다
//   내려받기  : PDF(표지 포함) · Excel — 서버에 저장된 내용으로 만든다
import { api } from '../../api.js';
import { h, toast, confirmModal, openModal, previewControls } from '../../ui.js';

// 차수 추가 — 사유(필수, 500자)를 받는다. 사유는 새 차수의 기본정보에 읽기 전용으로 보인다(V13)
export function reviseQuote(quote) {
  const reason = h('textarea', { class: 'ss-input', rows: 4, maxLength: 500, placeholder: '예) 고객 네고 요청 — 월 사용료 10% 인하',
    style: 'width:100%;height:auto;resize:vertical;line-height:1.5;padding:6px 8px' });
  const okBtn = h('button', { class: 'btn btn-primary' }, '차수 추가');
  const m = openModal({
    title: '차수 추가',
    body: h('div', {},
      h('div', { style: 'font-size:13px;line-height:1.6;margin-bottom:10px' },
        `${quote.quote_no} 견적의 내용으로 다음 차수를 만듭니다. 번호는 1차 번호 뒤에 차수가 붙고(예: -2) 견적일은 오늘이 됩니다. 이 견적은 그대로 남습니다. 만든 뒤 바로 수정 화면이 열립니다.`),
      h('label', { style: 'display:block;font-size:12.5px;font-weight:600;margin-bottom:4px' }, '추가 사유', h('span', { style: 'color:var(--ss-red, #FF5252)' }, ' *')),
      reason),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'), okBtn],
  });
  setTimeout(() => reason.focus(), 0);
  okBtn.onclick = async () => {
    const text = reason.value.trim();
    if (!text) { toast('차수 추가 사유를 넣으세요.', 'err'); reason.focus(); return; }
    okBtn.disabled = true;
    try {
      const { quote: nq } = await api.reviseQuote(quote.id, text);
      m.close();
      toast(`${nq.quote_no} (${nq.revision}차) 견적을 만들었습니다.`, 'ok');
      location.hash = `#/quotes/${nq.id}/edit`;
    } catch (err) { okBtn.disabled = false; toast(err.message, 'err'); }
  };
}

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
  previewControls(frame, box, () => m.close());
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

// 인장시스템 연계 — 인장시스템 날인 신청 화면에 넣을 내용을 미리 만들어 보여 준다(2026-11-02 사용자 요청).
// 아직 보내지 않는다(연동 전). 칸은 모두 고칠 수 있다(2026-11-02 사용자 요청) — 고친 값은 이 창 안에서만 쓰고 저장하지 않는다.
// 칸은 인장시스템 신청 화면과 같은 순서:
//   신청명 · 상세설명 · 인감/증명 구분 · 전자/실물 구분 · 날인용도 · 제출처 · 날인대상서류(이 견적서 PDF) · 비고
export async function sealPreview(quote) {
  let q;
  try { q = (await api.getQuote(quote.id)).quote; } catch (err) { return toast(err.message, 'err'); }
  const tag = (t) => (String(q.memo || '').match(new RegExp(`\\[${t}\\]\\s*(.+)`)) || [])[1] || '';
  const purpose = tag('견적용도');
  const won = (n) => (Number(n) || 0).toLocaleString('ko-KR');
  const rev = q.revision > 1 ? ` (${q.revision}차)` : '';
  const customer = q.customer_name || '';
  const fileName = `견적서_${customer}_${q.quote_no}.pdf`;
  const ymd = (d) => String(d || '').slice(0, 10);
  // 상세설명 템플릿(2026-11-02 사용자 요청) — 1. 견적 요약 + 의견란(제목과 빈칸, 영업팀이 채운다) / 2. 원가(제목과 빈칸)
  function detailTemplate() {
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const li = (k, v) => `<li><b>${esc(k)}</b> ${esc(v)}</li>`;
    const blocks = (q.blocks || []).map((b) => `${b.title} ${won(b.subtotal)}원${b.recurring ? '/월' : ''}`).join(' · ');
    const dc = Number(q.discount_amount) ? ` (특별 DC -${won(q.discount_amount)}원 반영)` : '';
    return [
      '<p><b>1. 견적 요약</b></p>',
      '<ul>',
      li('견적번호', `${q.quote_no}${rev}`),
      li('수신처', `${customer}${q.customer_contact ? ' / 담당 ' + q.customer_contact : ''}`),
      purpose ? li('견적용도', purpose) : '',
      li('견적금액', `일시불 ${won(q.onetime_total)}원${Number(q.monthly_total) ? ` / 월 ${won(q.monthly_total)}원` : ''} (부가세 별도)${dc}`),
      blocks ? li('구성', blocks) : '',
      li('견적일', `${ymd(q.quote_date)}${q.valid_until ? ' / 유효일 ' + ymd(q.valid_until) : ''}`),
      q.revision > 1 && q.revision_reason ? li('차수 추가 사유', q.revision_reason) : '',
      '</ul>',
      '<p><b>의견란</b></p>',
      '<p><br></p><p><br></p><p><br></p>',
      '<p><b>2. 원가</b></p>',
      '<p><br></p><p><br></p><p><br></p>',
    ].join('');
  }
  const data = {
    // 견적용도에 고객사명이 이미 들어 있으면 한 번만
    title: `${purpose && customer && purpose.includes(customer) ? purpose : `${customer} ${purpose || '견적서'}`} 날인`.trim(),
    detail: detailTemplate(),
    sealKind: '사용인감', medium: '전자', use: '견적서', submitTo: customer,
    note: `세포아 견적 시스템 ${q.quote_no} 에서 연계`,
    docKind: '사용인감', docSeal: '사용인감', docName: fileName, docCount: 1,
  };
  // 고르는 칸은 목록에서 고르거나 직접 친다(datalist)
  const LISTS = { 'seal-kinds': ['사용인감', '법인인감', '서명인', '인감증명서'], 'seal-uses': ['견적서', '계약서', '제안서', '확인서'] };
  const lists = Object.entries(LISTS).map(([id, vs]) => h('datalist', { id: 'q2-' + id }, ...vs.map((v) => h('option', { value: v }))));
  const ed = (key, extra = {}) => h('input', { class: 'ss-input', value: data[key] ?? '', style: 'width:100%', ...extra,
    oninput: (e) => { data[key] = e.target.value; } });
  const field = (label, ctrl, req, span) => h('div', { class: 'ss-field', style: `margin-bottom:12px;${span ? 'grid-column:1/-1' : ''}` },
    h('label', {}, label, req ? h('span', { class: 'req' }, ' *') : null), ctrl);
  // 상세설명 에디터 — 인장시스템 상세설명처럼 서식 있는 글(굵게 등). 브라우저 기본 편집(contenteditable)
  const area = h('div', { class: 'q2-editor__area', contenteditable: 'true', html: data.detail,
    oninput: () => { data.detail = area.innerHTML; } });
  const tool = (label, cmd, title, style = '') => h('button', { type: 'button', class: 'q2-editor__btn', title, style,
    onmousedown: (e) => { e.preventDefault(); document.execCommand(cmd); data.detail = area.innerHTML; area.focus(); } }, label);
  const detail = h('div', { class: 'q2-editor' },
    h('div', { class: 'q2-editor__bar' },
      tool('B', 'bold', '굵게', 'font-weight:700'), tool('I', 'italic', '기울임', 'font-style:italic'), tool('U', 'underline', '밑줄', 'text-decoration:underline'),
      h('span', { class: 'q2-editor__sep' }),
      tool('• 목록', 'insertUnorderedList', '글머리 목록'), tool('1. 목록', 'insertOrderedList', '번호 목록')),
    area);
  const medium = h('select', { class: 'ss-select', style: 'width:100%', onchange: (e) => { data.medium = e.target.value; } },
    ...['전자', '실물'].map((v) => h('option', { value: v, selected: v === data.medium }, v)));
  const cellIn = (key, extra = {}) => h('input', { class: 'ss-cellinput', value: data[key] ?? '', ...extra, oninput: (e) => { data[key] = e.target.value; } });
  // 날인서류 — 내려받지 않고 견적서를 미리보기 창으로 연다(2026-11-02 사용자 요청). 이 창 위에 겹쳐 열린다
  const pdfLink = h('a', { href: '#', title: '이 견적서 미리보기', style: 'color:var(--ss-link);font-weight:600',
    onclick: (e) => { e.preventDefault(); viewQuote(q); } }, 'PDF');
  const docs = h('table', { class: 'ss-grid ss-grid--sized', style: 'width:100%' },
    h('colgroup', {}, ...[110, 100, 0, 80, 80, 90, 80].map((w) => h('col', { style: w ? `width:${w}px` : '' }))),
    h('thead', {}, h('tr', {}, ...['인감구분 *', '인감명 *', '서류명 *', '날인횟수', '날인서류', '실물 날인서류', '기타파일'].map((t) => h('th', {}, t)))),
    h('tbody', {}, h('tr', {},
      h('td', { class: 'ss-cell--input' }, cellIn('docKind', { list: 'q2-seal-kinds', style: 'text-align:center' })),
      h('td', { class: 'ss-cell--input' }, cellIn('docSeal', { style: 'text-align:center' })),
      h('td', { class: 'ss-cell--input' }, cellIn('docName', { style: 'text-align:left' })),
      h('td', { class: 'ss-cell--input' }, cellIn('docCount', { inputMode: 'numeric', style: 'text-align:right' })),
      h('td', {}, pdfLink), h('td', {}, '-'), h('td', {}, '-'))));
  const m = openModal({
    title: `인장시스템 연계 — ${q.quote_no}`,
    body: h('div', {},
      // 버튼은 위에 — 창이 길어 아래 버튼이 잘렸다(2026-11-02 사용자 요청)
      h('div', { style: 'display:flex;gap:12px;align-items:center;margin-bottom:14px' },
        h('div', { style: 'flex:1;background:#F0F5FF;border:1px solid #BFD3F2;border-radius:4px;padding:8px 10px;font-size:12px;line-height:1.6' },
          '인장시스템 날인 신청 화면에 들어갈 내용입니다. 칸은 모두 고칠 수 있습니다. 아직 연동 전이라 보내지 않으며, 고친 값은 창을 닫으면 처음 값으로 돌아갑니다.'),
        h('div', { style: 'display:flex;gap:4px;flex:none' },
          h('button', { class: 'ss-btn ss-btn--default', onclick: () => m.close() }, '닫기'),
          // 전송 — 자리만 둔다(2026-11-02 사용자 요청 "기능은 이후 추가"). 누르면 준비 중이라고 알린다
          h('button', { class: 'ss-btn ss-btn--save', onclick: () => toast('전송 기능은 준비 중입니다. 인장시스템 연동 후 사용할 수 있습니다.', 'err') }, '전송'))),
      ...lists,
      h('div', { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 12px' },
        field('신청명', ed('title'), true, true),
        field('상세설명', detail, false, true),
        field('인감/증명 구분', ed('sealKind', { list: 'q2-seal-kinds' }), true),
        field('전자/실물 구분', medium),
        field('날인용도', ed('use', { list: 'q2-seal-uses' })),
        field('제출처', ed('submitTo'), true, true)),
      h('div', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink);margin:4px 0 8px' }, '날인대상서류'),
      h('div', { class: 'ss-gridwrap', style: 'margin-bottom:12px' }, docs),
      field('비고', ed('note'), false, true)),
  });
  m.back.querySelector('.modal').style.width = '860px';
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

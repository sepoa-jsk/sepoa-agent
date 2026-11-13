// 결재요청 · 내려받기 버튼 묶음 — 마지막 단계(인력투입계획) 맨 위 액션 줄에 얹는다.
// 예전 5단계(검토·결재요청) 탭은 없앴다(2026-11-03 사용자 요청). 그 화면의 검사(localChecks)는 [결재요청]을 누를 때 한다.
// 새 견적은 POST /api/quotes, 이미 저장된 견적(임시저장·수정)은 PUT /api/quotes/:id. 저장 후 #/quotes/:id 로 이동.
import { api as http } from '../../../api.js';
import { h, toast } from '../../../ui.js';
import { recalcBlocks, toBlocksPayload, previewHeader, discountPayload, monthlyDiscountPayload, svcFeeMissing, configMissing, priceMissingRows, zeroBlocks, focusZero } from './step3-config.js';
import { downloadQuote, sealPreview } from '../quote-actions.js';
import { uploadPendingFiles } from './step1-basic.js';

const num = (v) => Number(v) || 0;

// 저장 페이로드 — 발행과 임시저장이 같은 모양을 쓴다
export function quotePayload(s) {
  return {
    ...previewHeader(s),
    blocks: toBlocksPayload(s),
    discount: discountPayload(s),
    monthly_discount: monthlyDiscountPayload(s),
    round_unit: num(s.round_unit ?? 100000),
    status: s.status || undefined,
    // 근거 메일(V14) — 둘 다 비면 {} (서버가 NULL 로 지운다)
    source_mail: s.basic.mail_url || s.basic.mail_text ? { url: s.basic.mail_url || '', text: s.basic.mail_text || '' } : {},
  };
}

// 결재요청 전 확인 — 서버측 강제는 작업 16 검증 엔진 소관이다. 경고(WARN)는 막지 않는다
function localChecks(state) {
  const out = [];
  const b = state.basic;
  if (!b.customer_name || !b.customer_name.trim()) out.push({ level: 'ERROR', msg: '수신처(고객사명)가 비어 있습니다.' });
  if (!state.type.template_code && !state.type.manual) out.push({ level: 'ERROR', msg: '템플릿을 고르거나 직접 작성을 선택하세요.' });
  if (!(state.applied && state.applied.solution)) out.push({ level: 'ERROR', msg: '솔루션이 정해지지 않았습니다.' });
  if (!state.blocks || !state.blocks.length) out.push({ level: 'ERROR', msg: '견적 구성이 비어 있습니다.' });
  const c = recalcBlocks(state);
  if (c.onetime === 0 && c.monthly === 0) out.push({ level: 'ERROR', msg: '금액이 0원입니다.' });
  for (const t of configMissing(state)) out.push({ level: 'ERROR', msg: t });
  for (const t of zeroBlocks(state)) out.push({ level: 'ERROR', msg: t });
  const noPrice = priceMissingRows(state);
  if (noPrice.length) out.push({ level: 'ERROR', msg: `수량이 있는 행의 제안단가가 비어 있습니다: ${noPrice.join(', ')}` });
  if (svcFeeMissing(state)) out.push({ level: 'ERROR', msg: 'SaaS 서비스 이용료 금액이 비어 있습니다(필수).' });
  for (const e of c.laborErrors) out.push({ level: 'WARN', msg: e });
  if (!b.purpose || !b.purpose.trim()) out.push({ level: 'WARN', msg: '견적용도가 비어 있습니다.' });
  return out;
}

export function reviewActions(state, wiz) {
  // 내려받기는 서버에 저장된 견적 기준이다 — 저장 전 견적은 끄고, 저장된 견적은 고친 내용을 저장해야 반영된다고 버튼 풍선말로 알린다
  const savedNote = state.quoteId ? 'PDF · Excel 은 서버에 저장된 내용으로 만듭니다. 고친 내용은 임시저장 · 결재요청 후 반영됩니다.' : '임시저장 · 결재요청 후 내려받을 수 있습니다.';
  // 맨 위 액션 줄과 같은 모양(ss-btn)으로 만든다
  // [결재요청] — 예전 [발행 (저장)](2026-11-03 사용자 요청). 검사를 통과하면 저장한 뒤 인장시스템 연계(날인 신청) 창을 연다
  const publishBtn = h('button', { class: 'ss-btn ss-btn--save' }, '결재요청');
  const saved = { id: state.quoteId, quote_no: state.quoteNo };
  // PDF · Excel 은 출력 묶음 — 상세 화면과 같은 파란 테두리(secondary). 메일 발송은 뺐다(2026-11-03 사용자 요청)
  const pdfBtn = h('button', { class: 'ss-btn ss-btn--secondary', disabled: !state.quoteId, title: savedNote, onclick: () => downloadQuote(saved, 'pdf', pdfBtn) }, 'PDF 다운로드');
  const xlsBtn = h('button', { class: 'ss-btn ss-btn--secondary', disabled: !state.quoteId, title: savedNote, onclick: () => downloadQuote(saved, 'excel', xlsBtn) }, 'Excel 다운로드');

  publishBtn.addEventListener('click', async () => {
    const s = wiz.get();
    // 오류가 있으면 알리고 고칠 칸으로 보낸다 — 수신처면 수신처 칸, 수량 · 공수가 전부 0 이면 3단계 그 칸
    const errs = localChecks(s).filter((c) => c.level === 'ERROR');
    if (errs.length) {
      toast(`결재요청할 수 없습니다 — ${errs.map((e) => e.msg).join(' / ')}`, 'err');
      // 임시저장과 같이 고칠 칸으로 커서를 옮긴다(2026-11-03 사용자 요청) — 템플릿 · 구성이 없으면 1단계,
      // 수신처가 비면 수신처 칸, 그 밖(수량 · 공수 전부 0, 제안단가 · 서비스 이용료 빈칸 등)은 3단계(구성)
      const noTpl = (!s.type.template_code && !s.type.manual) || !(s.blocks || []).length;
      if (noTpl) { if (s.step !== 1) wiz.go(1); return; }
      if (!s.basic.customer_name || !s.basic.customer_name.trim()) { wiz.focusCustomer(); return; }
      if (s.step !== 3) wiz.go(3);
      focusZero(wiz.get());
      return;
    }
    publishBtn.disabled = true; publishBtn.textContent = '저장 중…';
    try {
      const payload = quotePayload(s);
      const { quote } = s.quoteId
        ? await http.updateQuote(s.quoteId, payload)
        : await http.createQuote(payload);
      s.quoteId = quote.id;
      await uploadPendingFiles(s); // 저장 전에 담아 둔 파일(2026-11-03)
      wiz.finish(quote.id);
      toast(`견적 ${quote.quote_no} 을(를) 저장했습니다.`, 'ok');
      location.hash = `#/quotes/${quote.id}`;
      // 상세 화면이 그려진 뒤 날인 신청 창을 띄운다(저장된 내용으로 채운다)
      setTimeout(() => sealPreview(quote), 300);
    } catch (err) {
      publishBtn.disabled = false; publishBtn.textContent = '결재요청';
      toast(err.message, 'err');
    }
  });
  // 업무 버튼(결재요청)과 문서 보기 버튼(PDF · Excel)은 액션 줄에서 다른 묶음에 놓는다(index.js paintTitle)
  return { approve: publishBtn, docs: h('span', { style: 'display:contents' }, pdfBtn, xlsBtn) };
}

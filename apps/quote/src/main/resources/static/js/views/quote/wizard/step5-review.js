// STEP⑤ 검토·발행 — 검증 배너 자리 + 미리보기 + 발행.
// 새 견적은 POST /api/quotes, 이미 저장된 견적(임시저장·수정)은 PUT /api/quotes/:id. 저장 후 #/quotes/:id 로 이동.
import { api as http } from '../../../api.js';
import { h, won, toast } from '../../../ui.js';
import { recalcBlocks, toBlocksPayload, previewHeader, discountPayload, monthlyDiscountPayload } from './step3-config.js';
import { downloadQuote } from '../quote-actions.js';

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
  };
}

// 발행 전 확인 — 서버측 강제는 작업 16 검증 엔진 소관이다.
function localChecks(state) {
  const out = [];
  const b = state.basic;
  if (!b.customer_name || !b.customer_name.trim()) out.push({ level: 'ERROR', msg: '수신처(고객사명)가 비어 있습니다.' });
  if (!state.type.template_code && !state.type.manual) out.push({ level: 'ERROR', msg: '템플릿을 고르거나 직접 작성을 선택하세요.' });
  if (!(state.applied && state.applied.solution)) out.push({ level: 'ERROR', msg: '솔루션이 정해지지 않았습니다.' });
  if (!state.blocks || !state.blocks.length) out.push({ level: 'ERROR', msg: '견적 구성이 비어 있습니다.' });
  const c = recalcBlocks(state);
  if (c.onetime === 0 && c.monthly === 0) out.push({ level: 'ERROR', msg: '금액이 0원입니다.' });
  for (const e of c.laborErrors) out.push({ level: 'WARN', msg: e });
  if (!b.purpose || !b.purpose.trim()) out.push({ level: 'WARN', msg: '견적용도가 비어 있습니다.' });
  return out;
}

export function renderStep5(root, state, wiz) {
  root.replaceChildren();
  const checks = localChecks(state);
  const errs = checks.filter((c) => c.level === 'ERROR');
  const warns = checks.filter((c) => c.level === 'WARN');
  const calc = recalcBlocks(state);

  // ── 검증 배너 (규칙 엔진은 작업 16) ──
  // 수신처가 비면(템플릿 불러오기로 2단계(기본정보)를 건너뛴 경우) 화면 위 기본정보 줄의 수신처 칸으로 보낸다
  const noCustomer = !state.basic.customer_name || !state.basic.customer_name.trim();
  const customerBtn = noCustomer ? h('button', { class: 'btn btn-sm', style: 'margin-top:6px', onclick: () => wiz.focusCustomer() }, '수신처 입력') : null;
  const banner = errs.length
    ? h('div', { class: 'banner err' }, h('div', {},
        h('b', {}, `발행할 수 없습니다 — 오류 ${errs.length}건`),
        h('ul', {}, ...errs.map((e) => h('li', {}, e.msg))), customerBtn))
    : warns.length
      ? h('div', { class: 'banner wrn' }, h('div', {},
          h('b', {}, `확인 필요 ${warns.length}건 (발행은 가능)`),
          h('ul', {}, ...warns.map((e) => h('li', {}, e.msg)))))
      : h('div', { class: 'banner inf' }, h('div', {},
          h('b', {}, '기본 확인 통과'),
          '정합성 검증 규칙 R-01~R-16 은 작업 16 에서 서버 측으로 들어옵니다.'));
  if (!wiz.readOnly) root.appendChild(banner); // 상세(읽기 전용)에서는 발행 전 확인이 필요 없다

  // 전체 폭 — 견적서 미리보기는 위쪽 [미리보기] 버튼으로 연다
  const left = h('div', { style: 'min-width:0' });
  root.appendChild(left);

  // ── 좌: 요약 + 산출물 ──
  const row = (k, v, strong) => h('div', { style: 'display:flex;justify-content:space-between;padding:7px 0;font-size:12.5px' },
    h('span', { style: 'color:var(--text-2)' }, k),
    h('span', { class: 'num', style: strong ? 'font-weight:700' : '' }, v));

  left.appendChild(h('div', { class: 'card', style: 'margin-bottom:12px' },
    h('div', { class: 'card-h' }, h('h2', {}, '견적 요약')),
    h('div', { class: 'card-b' },
      row('수신처', state.basic.customer_name || '-'),
      row('견적용도', state.basic.purpose || '-'),
      row('유형 / 구축형태', `${state.type.quote_type} / ${state.type.deployment || '-'}`),
      row('템플릿', state.type.template_code || '-'),
      row('견적일 / 유효일', `${state.basic.quote_date} ~ ${state.basic.valid_until}`),
      h('hr', { style: 'border:0;border-top:1px solid var(--line-2);margin:8px 0' }),
      row('일시불 소계 (원)', won(calc.onetime)),
      row('특별 DC (원)', calc.dcAmt ? '-' + won(calc.dcAmt) : '0'),
      row('절사액 (원)', calc.trunc ? '-' + won(calc.trunc) : '0'),
      row('최종견적금액 (원)', won(calc.final), true),
      row('부가세 (원, 별도 10%)', won(calc.vat)),
      calc.monthly && calc.mdcAmt ? row('월 사용료 소계 (원)', won(calc.monthly)) : null,
      calc.monthly && calc.mdcAmt ? row('월 특별 DC (원)', '-' + won(calc.mdcAmt)) : null,
      calc.monthly ? row('월 사용료 (원)', won(calc.monthlyFinal), true) : null)));

  const outBox = h('div', { class: 'card-b', style: 'display:flex;gap:8px;flex-wrap:wrap' });
  // 내려받기는 서버에 저장된 견적 기준이다 — 저장 전 견적은 끄고, 저장된 견적은 고친 내용을 저장해야 반영된다고 알린다
  const savedNote = h('div', { class: 'sub', style: 'padding:0 14px 12px;color:var(--text-3)' },
    state.quoteId ? 'PDF · Excel 은 서버에 저장된 내용으로 만듭니다. 고친 내용은 발행(저장) 후 반영됩니다.' : '산출물은 발행(저장) 후 내려받을 수 있습니다.');
  // 상세(읽기 전용)에서는 발행 · 산출물 칸을 두지 않는다 — 견적서는 위쪽 [견적서 보기] 에서 본다
  if (!wiz.readOnly) left.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, '산출물')),
    outBox, savedNote));

  const publishBtn = h('button', { class: 'btn btn-primary' }, '발행 (저장)');
  publishBtn.disabled = errs.length > 0;
  const saved = { id: state.quoteId, quote_no: state.quoteNo };
  const pdfBtn = h('button', { class: 'btn', disabled: !state.quoteId, onclick: () => downloadQuote(saved, 'pdf', pdfBtn) }, 'PDF 다운로드');
  const xlsBtn = h('button', { class: 'btn', disabled: !state.quoteId, onclick: () => downloadQuote(saved, 'excel', xlsBtn) }, 'Excel 다운로드');
  const mailBtn = h('button', { class: 'btn', disabled: !state.quoteId, onclick: () => wiz.mail() }, '메일 발송');
  outBox.appendChild(publishBtn); outBox.appendChild(pdfBtn); outBox.appendChild(xlsBtn); outBox.appendChild(mailBtn);

  publishBtn.addEventListener('click', async () => {
    const s = wiz.get();
    publishBtn.disabled = true; publishBtn.textContent = '저장 중…';
    try {
      const payload = quotePayload(s);
      const { quote } = s.quoteId
        ? await http.updateQuote(s.quoteId, payload)
        : await http.createQuote(payload);
      wiz.finish(quote.id);
      toast(`견적 ${quote.quote_no} 을(를) 저장했습니다.`, 'ok');
      location.hash = `#/quotes/${quote.id}`;
    } catch (err) {
      publishBtn.disabled = false; publishBtn.textContent = '발행 (저장)';
      toast(err.message, 'err');
    }
  });

}

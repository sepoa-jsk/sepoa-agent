// STEP⑤ 검토·발행 — 검증 배너 자리 + 미리보기 + 발행.
// 저장은 기존 POST /api/quotes(블록 경로)를 그대로 쓴다. 저장 후 #/quotes/:id 로 이동.
import { api as http } from '../../../api.js';
import { h, won, toast } from '../../../ui.js';
import { recalcBlocks, toBlocksPayload, previewHeader, discountPayload, monthlyDiscountPayload, makePreview } from './step3-config.js';

const num = (v) => Number(v) || 0;

// 발행 전 확인 — 서버측 강제는 작업 16 검증 엔진 소관이다.
function localChecks(state) {
  const out = [];
  const b = state.basic;
  if (!b.customer_name || !b.customer_name.trim()) out.push({ level: 'ERROR', msg: '수신처(고객사명)가 비어 있습니다.' });
  if (!state.type.template_code) out.push({ level: 'ERROR', msg: '템플릿이 선택되지 않았습니다.' });
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
  const banner = errs.length
    ? h('div', { class: 'banner err' }, h('div', {},
        h('b', {}, `발행할 수 없습니다 — 오류 ${errs.length}건`),
        h('ul', {}, ...errs.map((e) => h('li', {}, e.msg)))))
    : warns.length
      ? h('div', { class: 'banner wrn' }, h('div', {},
          h('b', {}, `확인 필요 ${warns.length}건 (발행은 가능)`),
          h('ul', {}, ...warns.map((e) => h('li', {}, e.msg)))))
      : h('div', { class: 'banner inf' }, h('div', {},
          h('b', {}, '기본 확인 통과'),
          '정합성 검증 규칙 R-01~R-16 은 작업 16 에서 서버 측으로 들어옵니다.'));
  root.appendChild(banner);

  const layout = h('div', { style: 'display:grid;grid-template-columns:1fr 440px;gap:14px;align-items:start' });
  const left = h('div', { style: 'min-width:0' });
  const right = h('div', { style: 'position:sticky;top:0' });
  layout.appendChild(left); layout.appendChild(right);
  root.appendChild(layout);

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
      calc.monthly ? row('월 사용료 (원)', won(calc.monthly), true) : null)));

  const outBox = h('div', { class: 'card-b', style: 'display:flex;gap:8px;flex-wrap:wrap' });
  const savedNote = h('div', { class: 'sub', style: 'padding:0 14px 12px;color:var(--text-3)' },
    '산출물은 발행(저장) 후 내려받을 수 있습니다.');
  left.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, '산출물')),
    outBox, savedNote));

  const publishBtn = h('button', { class: 'btn btn-primary' }, '발행 (저장)');
  publishBtn.disabled = errs.length > 0;
  const pdfBtn = h('button', { class: 'btn', disabled: true }, 'PDF 다운로드');
  const xlsBtn = h('button', { class: 'btn', disabled: true }, 'Excel 다운로드');
  outBox.appendChild(publishBtn); outBox.appendChild(pdfBtn); outBox.appendChild(xlsBtn);

  publishBtn.addEventListener('click', async () => {
    const s = wiz.get();
    publishBtn.disabled = true; publishBtn.textContent = '저장 중…';
    try {
      const payload = {
        ...previewHeader(s),
        blocks: toBlocksPayload(s),
        discount: discountPayload(s),
        monthly_discount: monthlyDiscountPayload(s),
        round_unit: num(s.round_unit ?? 100000),
      };
      const { quote } = await http.createQuote(payload);
      wiz.reset();
      toast(`견적 ${quote.quote_no} 을(를) 저장했습니다.`, 'ok');
      location.hash = `#/quotes/${quote.id}`;
    } catch (err) {
      publishBtn.disabled = false; publishBtn.textContent = '발행 (저장)';
      toast(err.message, 'err');
    }
  });

  // ── 우: 미리보기 ──
  right.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, '미리보기'),
      h('span', { class: 'sub' }, 'PDF 와 같은 렌더러'), h('span', { class: 'sp' }),
      h('span', { class: 'badge badge-gray', id: 'pv5-state' }, '대기')),
    h('div', { class: 'card-b', style: 'padding:0' },
      h('iframe', { id: 'pv5-frame', style: 'width:100%;height:640px;border:0;background:#fff' }))));
  makePreview('pv5-frame', 'pv5-state').now(wiz);
}

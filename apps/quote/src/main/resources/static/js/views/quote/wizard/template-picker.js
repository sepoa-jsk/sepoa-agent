// 템플릿 미리보기 창 — 견적 작성 1단계 템플릿 카드의 [미리보기] 로 연다.
// 템플릿 고르기는 1단계 화면 목록 하나로 한다(2026-10-30 사용자 요청 — 예전 [템플릿 불러오기] 창은 없앴다).
// 미리보기는 지금 작성 중인 기본정보(수신처 · 견적용도 등)에 템플릿의 구성 · 인력 · 견적조건을 얹어 그린다.
// [이 템플릿으로 시작] 을 누르면 onStart() — 상태 반영은 1단계(step2-type.js)가 한다.
import { api as http } from '../../../api.js';
import { h, won, openModal, previewControls } from '../../../ui.js';
import { appliedPatch, toBlocksPayload, previewHeader, recalcBlocks } from './step3-config.js';

// 템플릿 종류(서버가 내용으로 정한다) — 구조만: 블록 틀만 있고 모듈 · 인력은 비어 있다 / 데이터 포함: 기본 모듈 · 인력까지 채워져 있다
export const KIND_LABEL = { STRUCT: '구조만', DATA: '데이터 포함' };
export const kindBadge = (kind) => h('span', { class: 'badge ' + (kind === 'STRUCT' ? 'badge-yellow' : 'badge-blue'), style: 'font-size:11px' }, KIND_LABEL[kind] || '');

const applyCache = {}; // code → apply-template 응답

export function openTemplatePreview({ state, tpl: t, onStart }) {
  const info = h('div', { style: 'font-size:12px;color:var(--ss-ink-3);min-height:18px' }, `${t.name} — 그리는 중...`);
  const frame = h('iframe', { style: 'flex:1;width:100%;border:1px solid #E7EAF0;background:#fff' });
  const m = openModal({
    title: `템플릿 미리보기 — ${t.name}`,
    body: h('div', { style: 'display:flex;flex-direction:column;gap:6px;height:70vh' }, info, frame),
    footer: [
      h('button', { class: 'btn', onclick: () => m.close() }, '닫기'),
      h('button', { class: 'btn btn-primary', onclick: () => { m.close(); onStart(); } }, '이 템플릿으로 시작'),
    ],
  });
  const box = m.back.querySelector('.modal');
  box.style.width = '900px';
  box.querySelector('.modal-body').style.padding = '12px';
  box.querySelector('.modal-foot').prepend(previewControls(frame, box));
  (async () => {
    try {
      const d = applyCache[t.code] || (applyCache[t.code] = await http.applyTemplate(t.code));
      // 지금 작성 중인 기본정보에 템플릿 내용을 얹은 모습 (특별DC 는 새로 시작하므로 넣지 않는다)
      const s = { ...state, ...appliedPatch(d), type: { quote_type: t.quote_type, deployment: t.deployment, template_code: t.code },
        discount: { mode: 'TARGET', value: null }, monthly_discount: { mode: 'TARGET', value: null } };
      recalcBlocks(s); // 행 금액(amount)을 채운다 — 서버는 보낸 금액을 그대로 합산한다
      const r = await http.previewQuote({
        blocks: toBlocksPayload(s),
        header: { ...previewHeader(s), quote_no: state.quoteNo || '' },
        round_unit: s.round_unit ?? 100000,
      });
      frame.srcdoc = r.html;
      const c = r.calc || {};
      const miss = (d.unregistered || []).length;
      info.textContent = `${KIND_LABEL[t.kind] || ''} · 기본값 기준 일시불 ${won(c.onetime_total)}원${c.monthly_total ? ` / 월 ${won(c.monthly_total)}원` : ''}`
        + (miss ? ` · 가격정책 미등록 ${miss}건(단가 빈칸)` : '');
    } catch (err) {
      info.textContent = err.message;
    }
  })();
}

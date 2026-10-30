// 템플릿 불러오기 창 — 견적 작성 1단계 [템플릿 불러오기] 로 연다. 견적서 불러오기 창(quote-picker.js)과 같은 구조(2026-10-30 사용자 요청).
// 왼쪽: 고른 솔루션 · 구축형태의 템플릿 목록(코드 · 이름 검색) / 오른쪽: 고른 템플릿의 견적서 미리보기.
// 미리보기는 지금 작성 중인 기본정보(수신처 · 견적용도 등)에 템플릿의 구성 · 인력 · 견적조건을 얹어 그린다.
// [이 템플릿으로 시작] 을 누르면 onStart(tpl) — 상태 반영은 1단계(step2-type.js)가 한다.
import { api as http } from '../../../api.js';
import { h, won, clear, openModal } from '../../../ui.js';
import { appliedPatch, toBlocksPayload, previewHeader, recalcBlocks } from './step3-config.js';

// 템플릿 종류(서버가 내용으로 정한다) — 구조만: 블록 틀만 있고 모듈 · 인력은 비어 있다 / 데이터 포함: 기본 모듈 · 인력까지 채워져 있다
export const KIND_LABEL = { STRUCT: '구조만', DATA: '데이터 포함' };
export const kindBadge = (kind) => h('span', { class: 'badge ' + (kind === 'STRUCT' ? 'badge-yellow' : 'badge-blue'), style: 'font-size:11px' }, KIND_LABEL[kind] || '');

const applyCache = {}; // code → apply-template 응답

export function openTemplatePicker({ state, list: all, currentCode, title, onStart }) {
  let picked = null;           // 고른 템플릿
  let seq = 0;                 // 늦게 온 응답이 새 선택을 덮지 않게

  const search = h('input', { class: 'ss-input', placeholder: '템플릿 코드 · 이름 검색', style: 'flex:1;min-width:0', oninput: () => paintList() });
  const list = h('div', { style: 'flex:1;overflow:auto;border-top:1px solid #E7EAF0' });
  const info = h('div', { style: 'font-size:12px;color:var(--ss-ink-3);min-height:18px' }, '왼쪽에서 템플릿을 고르세요.');
  const frame = h('iframe', { style: 'flex:1;width:100%;border:1px solid #E7EAF0;background:#fff' });
  const okBtn = h('button', { class: 'btn btn-primary', disabled: true }, '이 템플릿으로 시작');

  const body = h('div', { style: 'display:grid;grid-template-columns:360px 1fr;gap:12px;height:70vh' },
    h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-height:0' },
      h('div', { style: 'display:flex;gap:6px' }, search), list),
    h('div', { style: 'display:flex;flex-direction:column;gap:6px;min-height:0' }, info, frame));

  const m = openModal({
    title: title || '템플릿 불러오기',
    body,
    footer: [h('span', { style: 'margin-right:auto;font-size:12px;color:var(--ss-ink-3)' },
      '템플릿의 구성 · 기본 수량 · 인력 · 견적조건으로 시작합니다. 지금 입력한 기본정보(수신처 등)는 그대로 둡니다.'),
    h('button', { class: 'btn', onclick: () => m.close() }, '취소'), okBtn],
  });
  const box = m.back.querySelector('.modal');
  box.style.width = '1180px';
  box.querySelector('.modal-body').style.padding = '12px';
  okBtn.onclick = () => { if (picked) { m.close(); onStart(picked); } };

  function paintList() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const rows = all.filter((t) => !q || t.code.toLowerCase().includes(q) || String(t.name).toLowerCase().includes(q));
    if (!rows.length) { list.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '템플릿이 없습니다.')); return; }
    for (const t of rows) {
      const on = picked && picked.code === t.code;
      list.appendChild(h('div', {
        style: `padding:8px 10px;border-bottom:1px solid #EEF1F5;cursor:pointer;${on ? 'background:#EEF4FF;box-shadow:inset 3px 0 0 var(--ss-primary)' : ''}`,
        onclick: () => select(t),
      },
      h('div', { style: 'display:flex;gap:8px;align-items:baseline' },
        h('span', { style: 'color:var(--ss-emphasis);font-size:12px;font-weight:500' }, t.code),
        h('span', { style: 'font-size:11px;color:var(--ss-ink-3)' }, [KIND_LABEL[t.kind], t.code === currentCode ? '지금 적용 중' : ''].filter(Boolean).join(' · '))),
      h('div', { style: 'font-size:13px;color:var(--ss-ink-2);margin-top:2px' }, t.name),
      h('div', { style: 'font-size:11px;color:var(--ss-ink-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' },
        [(t.block_codes || []).join(' + ') || '블록 미정', t.brand, t.has_labor_plan ? '인력투입계획' : ''].filter(Boolean).join(' · '))));
    }
  }

  async function select(t) {
    const my = ++seq;
    picked = null; okBtn.disabled = true;
    paintList();
    info.textContent = `${t.name} — 그리는 중...`;
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
      if (my !== seq) return;
      frame.srcdoc = r.html;
      const c = r.calc || {};
      const miss = (d.unregistered || []).length;
      info.textContent = `${t.code} · ${KIND_LABEL[t.kind] || ''} · 기본값 기준 일시불 ${won(c.onetime_total)}원${c.monthly_total ? ` / 월 ${won(c.monthly_total)}원` : ''}`
        + (miss ? ` · 가격정책 미등록 ${miss}건(단가 빈칸)` : '');
      picked = t;
      okBtn.disabled = false;
      paintList();
    } catch (err) {
      if (my === seq) info.textContent = err.message;
    }
  }

  paintList();
  // 지금 적용 중인 템플릿(없으면 하나뿐일 때 그것)을 먼저 골라 미리보기를 띄운다
  const first = all.find((t) => t.code === currentCode) || (all.length === 1 ? all[0] : null);
  if (first) select(first);
}

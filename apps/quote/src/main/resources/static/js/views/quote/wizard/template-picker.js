// 템플릿 불러오기 창 — 견적 작성 어느 단계에서나 연다.
// 왼쪽: 사용 중인 템플릿 목록(검색 · 솔루션 필터) / 오른쪽: 고른 템플릿으로 채운 견적서 미리보기.
// 미리보기는 지금 작성 중인 기본정보(수신처 · 견적용도 등)에 템플릿의 구성 · 인력 · 견적조건을 얹어 그린다.
// [불러오기] 를 누르면 onPick({ tpl, d }) — d 는 apply-template 응답. 상태 반영은 위저드(index.js)가 한다.
import { api as http } from '../../../api.js';
import { store } from '../../../app.js';
import { h, won, clear, openModal } from '../../../ui.js';
import { appliedPatch, toBlocksPayload, previewHeader, recalcBlocks } from './step3-config.js';

const DEP_LABEL = { ONPREM_LUMP: '구축형 일시불', ONPREM_INSTALL: '구축형 분납', SAAS: 'SaaS', PCLOUD: 'Private Cloud' };

export async function openTemplatePicker({ state, onPick }) {
  const solutions = (await store.getMaster()).solutions || [];
  let templates = [];
  let picked = null;           // { tpl, d }
  const applyCache = {};       // code → apply-template 응답

  const search = h('input', { class: 'ss-input', placeholder: '코드 · 이름 검색', style: 'flex:1;min-width:0', oninput: () => paintList() });
  const solSel = h('select', { class: 'ss-select', style: 'width:120px', onchange: () => paintList() },
    h('option', { value: '' }, '전체 솔루션'), ...solutions.map((s) => h('option', { value: s.code }, s.name || s.code)));
  const list = h('div', { style: 'flex:1;overflow:auto;border-top:1px solid #E7EAF0' });
  const info = h('div', { style: 'font-size:12px;color:var(--ss-ink-3);min-height:18px' }, '왼쪽에서 템플릿을 고르세요.');
  const frame = h('iframe', { style: 'flex:1;width:100%;border:1px solid #E7EAF0;background:#fff' });
  const okBtn = h('button', { class: 'btn btn-primary', disabled: true }, '불러오기');

  const body = h('div', { style: 'display:grid;grid-template-columns:330px 1fr;gap:12px;height:70vh' },
    h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-height:0' },
      h('div', { style: 'display:flex;gap:6px' }, search, solSel), list),
    h('div', { style: 'display:flex;flex-direction:column;gap:6px;min-height:0' }, info, frame));

  const m = openModal({
    title: '템플릿 불러오기',
    body,
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'), okBtn],
  });
  const box = m.back.querySelector('.modal');
  box.style.width = '1180px';
  box.querySelector('.modal-body').style.padding = '12px';
  okBtn.onclick = () => { if (picked) { m.close(); onPick(picked); } };

  function paintList() {
    const q = search.value.trim().toLowerCase();
    const sol = solSel.value;
    clear(list);
    const rows = templates.filter((t) => (!sol || t.solution === sol)
      && (!q || t.code.toLowerCase().includes(q) || String(t.name).toLowerCase().includes(q)));
    if (!rows.length) { list.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '템플릿이 없습니다.')); return; }
    for (const t of rows) {
      const on = picked && picked.tpl.code === t.code;
      const cur = state.type.template_code === t.code;
      list.appendChild(h('div', {
        style: `padding:8px 10px;border-bottom:1px solid #EEF1F5;cursor:pointer;${on ? 'background:#EEF4FF;box-shadow:inset 3px 0 0 var(--ss-primary)' : ''}`,
        onclick: () => select(t),
      },
      h('div', { style: 'display:flex;gap:8px;align-items:baseline' },
        h('span', { style: 'color:var(--ss-emphasis);font-size:12px;font-weight:500' }, t.code),
        cur ? h('span', { style: 'font-size:11px;color:var(--ss-ink-3)' }, '지금 사용 중') : null),
      h('div', { style: 'font-size:13px;color:var(--ss-ink-2);margin-top:2px' }, t.name),
      h('div', { style: 'font-size:11px;color:var(--ss-ink-3);margin-top:2px' },
        `${store.solutionName(t.solution)} · ${DEP_LABEL[t.deployment] || t.deployment}${t.brand ? ' · ' + t.brand : ''}`)));
    }
  }

  async function select(t) {
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
      frame.srcdoc = r.html;
      const c = r.calc || {};
      const miss = (d.unregistered || []).length;
      info.textContent = `${t.name} · 기본값 기준 일시불 ${won(c.onetime_total)}원${c.monthly_total ? ` / 월 ${won(c.monthly_total)}원` : ''}`
        + (miss ? ` · 가격정책 미등록 ${miss}건(단가 빈칸)` : '');
      picked = { tpl: t, d };
      okBtn.disabled = false;
      paintList();
    } catch (err) {
      info.textContent = err.message;
    }
  }

  try {
    templates = (await http.templates({ active: 1 })).templates || [];
  } catch (err) { info.textContent = err.message; }
  // 지금 쓰는 솔루션부터 보여준다
  if (state.applied?.solution) solSel.value = state.applied.solution;
  paintList();
  const curTpl = templates.find((t) => t.code === state.type.template_code);
  if (curTpl) select(curTpl);
}

// STEP② 유형 선택 — quote_type × deployment 조합을 카드로 제시하고 템플릿을 붙인다.
// 조합은 임의로 만들지 않는다. sq_quote_templates 에 실제로 존재하는 것만 노출한다.
import { api as http } from '../../../api.js';
import { store } from '../../../app.js';
import { h } from '../../../ui.js';

const TYPE_LABEL = { BUILD: '구축·서비스', MAINT: '유지보수', ADDDEV: '추가개발' };
const DEP_LABEL = {
  ONPREM_LUMP: '온프레미스 일시불', ONPREM_INSTALL: '온프레미스 분납',
  SAAS: 'SaaS', PCLOUD: 'Private Cloud',
};
const DEP_DESC = {
  ONPREM_LUMP: '솔루션 + 개발인건비. 특별DC 후 일시납',
  ONPREM_INSTALL: '솔루션 무상 + 인건비 + 월사용료 분납',
  SAAS: '셋업 + 월 서비스료. 건수 밴드 적용',
  PCLOUD: '셋업 + 라이선스 + 월 서비스료',
};

// 견적 템플릿 화면에서 추가·수정·사용 중지한 내용이 바로 보이도록, 화면을 열 때(wizard 진입) 한 번 새로 받는다.
// 사용 중지한 템플릿은 고를 수 없다.
let tplCache = null;
export function resetTemplateCache() { tplCache = null; }
async function loadTemplates() {
  if (tplCache) return tplCache;
  try {
    const r = await http.templates({ active: 1 });
    tplCache = r.templates || [];
  } catch {
    tplCache = [];
  }
  return tplCache;
}

function comboCards(combos, state, root, wiz) {
  if (!combos.length) return [h('div', { class: 'empty' }, '등록된 템플릿이 없습니다.')];
  return combos.map((c) => {
    const on = state.type.quote_type === c.quote_type && state.type.deployment === c.deployment;
    const card = h('div', { class: 'factor' + (on ? ' on' : ''), style: 'display:block' },
      h('div', { class: 't' },
        h('b', {}, DEP_LABEL[c.deployment] || c.deployment),
        h('span', {}, DEP_DESC[c.deployment] || ''),
        h('span', { class: 'src' }, `${TYPE_LABEL[c.quote_type] || c.quote_type} · 템플릿 ${c.count}종`)));
    card.addEventListener('click', () => {
      if (wiz.readOnly) return; // 상세(읽기 전용)
      // 구축형태를 바꾸면 템플릿 선택이 무효가 되므로 블록도 함께 비운다.
      wiz.patch({ type: { quote_type: c.quote_type, deployment: c.deployment, template_code: null, manual: false },
        blocks: [], applied: null, conds: [], pay_plan: null });
      renderStep2(root, wiz.get(), wiz);
    });
    return card;
  });
}

function tplCards(list, state, root, wiz) {
  return list.map((tpl) => {
    const on = state.type.template_code === tpl.code;
    const card = h('div', { class: 'factor' + (on ? ' on' : '') },
      h('div', { class: 't' },
        h('b', {}, tpl.name),
        h('span', {}, (tpl.block_codes || []).join(' + ') || '블록 미정'),
        h('span', { class: 'src' }, `${tpl.code}${tpl.brand ? ' · ' + tpl.brand : ''}`)),
      tpl.has_labor_plan ? h('span', { class: 'badge badge-yellow' }, '인력투입계획') : null);
    card.addEventListener('click', () => {
      if (wiz.readOnly) return; // 상세(읽기 전용)
      // 템플릿을 바꾸면 STEP③ 이 다시 적용하도록 블록을 비운다.
      // STEP③ 은 `!state.blocks.length` 일 때만 apply-template 을 부르므로,
      // 비우지 않으면 옛 템플릿의 블록이 그대로 남는다.
      // (구 화면 quote-block.js 의 "템플릿 다시 적용" 버튼에 해당한다)
      const changed = state.type.template_code && state.type.template_code !== tpl.code;
      wiz.patch({ type: { template_code: tpl.code, manual: false },
        ...(changed ? { blocks: [], applied: null, conds: [], pay_plan: null } : {}) });
      renderStep2(root, wiz.get(), wiz);
    });
    return card;
  });
}

// 직접 작성 — 템플릿 없이 솔루션 · 구축형태만 정하고, 3단계에서 블록 · 품목 · 인력을 모두 직접 넣는다
function manualCard(state, root, wiz) {
  const sols = (store.master && store.master.solutions) || [];
  const on = !!state.type.manual;
  const solSel = h('select', { class: 'select', style: 'width:160px' },
    ...sols.map((s) => h('option', { value: s.code, selected: s.code === (state.applied && state.applied.solution) }, s.name || s.code)));
  const depSel = h('select', { class: 'select', style: 'width:170px' },
    ...Object.entries(DEP_LABEL).map(([v, l]) => h('option', { value: v, selected: v === state.type.deployment }, l)));
  const start = h('button', { class: 'btn btn-primary' }, on ? '직접 작성 중 — 다시 적용' : '직접 작성으로 시작');
  start.addEventListener('click', () => {
    const changed = !on || state.type.deployment !== depSel.value || (state.applied && state.applied.solution) !== solSel.value;
    wiz.patch({
      type: { quote_type: 'BUILD', deployment: depSel.value, template_code: null, manual: true },
      applied: { solution: solSel.value, brand: '', has_pay_plan: false },
      hasLaborPlan: false,
      ...(changed ? { blocks: [], conds: [] } : {}),
    });
    wiz.go(3);
  });
  return h('div', { class: 'card', style: 'margin-bottom:14px' + (on ? ';outline:2px solid var(--primary)' : '') },
    h('div', { class: 'card-h' }, h('h2', {}, '직접 작성'), h('span', { class: 'sub' }, '템플릿 없이 블록 · 품목 · 인력을 모두 직접 입력합니다')),
    h('div', { class: 'card-b', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
      h('span', { style: 'font-size:12.5px' }, '솔루션'), solSel, h('span', { style: 'font-size:12.5px' }, '구축형태'), depSel, start));
}

export async function renderStep2(root, state, wiz) {
  root.replaceChildren();
  const all = await loadTemplates();

  // 실제 존재하는 조합만 (템플릿 없는 조합은 선택 불가)
  const combos = [];
  for (const tpl of all) {
    const key = `${tpl.quote_type}|${tpl.deployment}`;
    let c = combos.find((x) => x.key === key);
    if (!c) {
      c = { key, quote_type: tpl.quote_type, deployment: tpl.deployment, count: 0 };
      combos.push(c);
    }
    c.count++;
  }

  const typeCard = h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' },
      h('h2', {}, '견적 유형'),
      h('span', { class: 'sub' }, '템플릿이 등록된 조합만 선택할 수 있습니다'),
      h('span', { class: 'sp' }),
      h('span', { class: 'badge badge-gray' }, '유지보수·추가개발은 Phase 6')),
    h('div', {
      class: 'card-b',
      style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px',
    }, ...comboCards(combos, state, root, wiz)));
  root.appendChild(typeCard);
  root.appendChild(manualCard(state, root, wiz));

  if (state.type.deployment) {
    const list = all.filter((x) => x.quote_type === state.type.quote_type && x.deployment === state.type.deployment);
    root.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' },
      h('div', { class: 'card-h' },
        h('h2', {}, '템플릿 선택'),
        h('span', { class: 'sub' }, `${DEP_LABEL[state.type.deployment] || state.type.deployment} · ${list.length}종`)),
      h('div', { class: 'card-b', style: 'display:flex;flex-direction:column;gap:7px' },
        ...tplCards(list, state, root, wiz))));
  }

  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-h' },
      h('h2', {}, '적용 정책 버전'),
      h('span', { class: 'sub' }, '작업 13 마스터 재편 이후 연동')),
    h('div', { class: 'card-b' },
      h('div', { class: 'banner inf' },
        h('div', {},
          h('b', {}, '정책 버전 마스터가 아직 없습니다'),
          '현재는 가격정책(sq_price_items)과 활성 임금단가 연도가 그대로 적용됩니다.')))));
}

// 다음 단계로 가기 전 확인
export function validateStep2(state) {
  if (!state.type.deployment) return '구축형태를 선택하세요.';
  if (!state.type.template_code && !state.type.manual) return '템플릿을 선택하거나 [직접 작성으로 시작] 을 누르세요.';
  if (state.type.manual && !(state.applied && state.applied.solution)) return '솔루션을 선택하세요.';
  return null;
}

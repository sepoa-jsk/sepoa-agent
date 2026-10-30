// STEP① 유형 선택 — 솔루션 → 구축형태 → (SaaS) 서비스 → 템플릿 순서로 고른다.
import { api as http } from '../../../api.js';
import { store } from '../../../app.js';
import { h } from '../../../ui.js';
import { kindBadge, openTemplatePicker } from './template-picker.js';
import { loadSaasCatalog, quoteService } from './step3-config.js';

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

// 구축형태 카드 — 이 솔루션의 템플릿 수를 함께 보인다. 템플릿이 없는 형태도 고를 수 있다(직접 작성)
function deploymentCards(all, state, root, wiz) {
  return Object.entries(DEP_LABEL).map(([dep, label]) => {
    const n = all.filter((t) => t.deployment === dep).length;
    const on = state.type.deployment === dep;
    const card = h('div', { class: 'factor' + (on ? ' on' : ''), style: 'display:block' },
      h('div', { class: 't' },
        h('b', {}, label),
        h('span', {}, DEP_DESC[dep] || ''),
        h('span', { class: 'src' }, n ? `템플릿 ${n}종` : '템플릿 없음 — 직접 작성')));
    card.addEventListener('click', () => {
      if (wiz.readOnly || on) return; // 상세(읽기 전용) · 이미 고른 것
      // 구축형태를 바꾸면 템플릿 선택이 무효가 되므로 블록도 함께 비운다.
      wiz.patch({ type: { quote_type: 'BUILD', deployment: dep, template_code: null, manual: false },
        blocks: [], applied: null, conds: [], pay_plan: null });
      renderStep2(root, wiz.get(), wiz);
    });
    return card;
  });
}

// 템플릿으로 시작 — 그 템플릿으로 2단계(기본정보)로 간다
function startTemplate(tpl, wiz) {
  if (wiz.readOnly) return; // 상세(읽기 전용)
  // 템플릿을 바꾸면 STEP③ 이 다시 적용하도록 블록을 비운다.
  // STEP③ 은 `!state.blocks.length` 일 때만 apply-template 을 부르므로,
  // 비우지 않으면 옛 템플릿의 블록이 그대로 남는다.
  const cur = wiz.get();
  const changed = cur.type.template_code && cur.type.template_code !== tpl.code;
  wiz.patch({ type: { quote_type: tpl.quote_type, deployment: tpl.deployment, template_code: tpl.code, manual: false, solution: tpl.solution },
    ...(changed || cur.type.manual ? { blocks: [], applied: null, conds: [], pay_plan: null } : {}) });
  wiz.go(2);
}

// 지금 적용한 템플릿 한 줄 — 목록은 [템플릿 불러오기] 창에서 본다(화면이 아래로 늘어나지 않게)
function currentTplLine(tpl) {
  return h('div', { class: 'factor on', style: 'cursor:default' },
    h('div', { class: 't' },
      h('b', {}, tpl.name),
      h('span', {}, (tpl.block_codes || []).join(' + ') || '블록 미정'),
      h('span', { class: 'src' }, `${tpl.code}${tpl.brand ? ' · ' + tpl.brand : ''}`)),
    kindBadge(tpl.kind),
    tpl.has_labor_plan ? h('span', { class: 'badge badge-gray' }, '인력투입계획') : null);
}

// 직접 작성 — 템플릿 없이 고른 솔루션 · 구축형태로 시작(→ 2단계 기본정보), 3단계에서 블록 · 품목 · 인력을 모두 직접 넣는다
function startManual(state, wiz, sol) {
  if (wiz.readOnly) return;
  const dep = state.type.deployment;
  const on = !!state.type.manual;
  const changed = !on || (state.applied && state.applied.solution) !== sol;
  wiz.patch({
    type: { quote_type: 'BUILD', deployment: dep, template_code: null, manual: true, solution: sol },
    applied: { solution: sol, brand: '', has_pay_plan: false },
    hasLaborPlan: false,
    ...(changed ? { blocks: [], conds: [] } : {}),
    conds_on: changed || !(state.conds || []).length ? false : state.conds_on, // 직접 작성은 견적조건 없이 시작 — 필요하면 블록 추가로 넣는다
  });
  wiz.go(2);
}

// 순서(2026-10-30 사용자 요청): 1. 솔루션 → 2. 구축형태(온프레미스 · SaaS …) → 3. SaaS 서비스(SaaS 일 때) → 템플릿.
// 앞 단계를 고르면 다음 단계가 그 값으로 걸러진다. 템플릿 칸에 [템플릿 불러오기] · [직접 작성으로 시작] · [견적서 불러오기] 가 있다.
export async function renderStep2(root, state, wiz) {
  const loaded = await loadTemplates();
  const sols = ((await store.getMaster()) || {}).solutions || [];
  // 고른 솔루션 — 저장값 → 적용된 템플릿 → 첫 솔루션. 템플릿 · 구축형태 카드는 이 솔루션 것만
  const sol = state.type.solution || (state.applied && state.applied.solution) || (sols[0] && sols[0].code) || null;
  const all = sol ? loaded.filter((t) => t.solution === sol) : loaded;
  const solName = (sols.find((x) => x.code === sol) || {}).name || sol || '';
  const dep = state.type.deployment;
  const svcCard = dep === 'SAAS' ? await serviceCard(state, root, wiz, sol) : null;
  root.replaceChildren();
  let no = 0;
  const card = (title, sub, body, extra = []) => h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' }, h('h2', {}, `${++no}. ${title}`), h('span', { class: 'sub' }, sub), h('span', { class: 'sp' }), ...extra), body);

  // 1. 솔루션 — 바꾸면 템플릿과 구성을 비운다
  root.appendChild(card('솔루션', '견적할 솔루션을 고르세요',
    h('div', { class: 'card-b', style: 'display:flex;gap:8px;flex-wrap:wrap' },
      ...sols.map((x) => h('button', { class: 'btn' + (x.code === sol ? ' btn-primary' : ''), style: 'min-width:120px',
        onclick: () => {
          if (wiz.readOnly || x.code === sol) return;
          wiz.patch({ type: { solution: x.code, template_code: null, manual: false, service: null }, blocks: [], applied: null, conds: [], pay_plan: null });
          renderStep2(root, wiz.get(), wiz);
        } }, x.name || x.code)))));

  // 2. 구축형태
  root.appendChild(card('구축형태', `${solName} — 템플릿이 없는 형태는 직접 작성으로 시작합니다`,
    h('div', { class: 'card-b', style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px' },
      ...deploymentCards(all, state, root, wiz)),
    [h('span', { class: 'badge badge-gray' }, '유지보수·추가개발은 Phase 6')]));

  // 3. SaaS 서비스 (SaaS 일 때)
  if (svcCard) { svcCard.querySelector('h2').textContent = `${++no}. SaaS 서비스`; root.appendChild(svcCard); }

  // 템플릿 — 고른 솔루션 · 구축형태 것만. [템플릿 불러오기] 창(왼쪽 목록 + 오른쪽 견적서 미리보기)에서 고른다.
  // 견적서 불러오기 창과 같은 구조(2026-10-30 사용자 요청). 직접 작성 · 견적서 불러오기도 여기서
  const list = dep ? all.filter((x) => x.deployment === dep) : [];
  const curTpl = list.find((x) => x.code === state.type.template_code);
  const pickTpl = () => openTemplatePicker({ state: wiz.get(), list, currentCode: state.type.template_code,
    title: `템플릿 불러오기 — ${solName} · ${DEP_LABEL[dep] || dep}`, onStart: (tpl) => startTemplate(tpl, wiz) });
  root.appendChild(card('템플릿 선택',
    dep ? `${solName} · ${DEP_LABEL[dep] || dep} · ${list.length}종` : '구축형태를 먼저 고르세요',
    h('div', { class: 'card-b', style: 'display:flex;flex-direction:column;gap:7px' },
      !dep ? h('div', { class: 'empty' }, '위에서 구축형태를 고르면 템플릿을 불러올 수 있습니다.')
        : !list.length ? h('div', { class: 'empty' }, '이 솔루션 · 구축형태로 등록된 템플릿이 없습니다. [직접 작성으로 시작] 을 쓰세요.')
          : curTpl ? currentTplLine(curTpl)
            : h('div', { class: 'empty' }, '[템플릿 불러오기] 를 눌러 템플릿을 고르세요. 견적서 모양을 보고 고를 수 있습니다.')),
    [h('button', { class: 'btn' + (state.type.manual ? '' : ' btn-primary'), disabled: !dep || !list.length || wiz.readOnly,
      onclick: pickTpl }, curTpl ? '템플릿 다시 불러오기' : '템플릿 불러오기'),
    h('button', { class: 'btn' + (state.type.manual ? ' btn-primary' : ''), disabled: !dep, title: '템플릿 없이 블록 · 품목 · 인력을 모두 직접 입력합니다',
      onclick: () => startManual(wiz.get(), wiz, sol) }, state.type.manual ? '직접 작성 중 — 다시 적용' : '직접 작성으로 시작'),
    h('button', { class: 'btn', onclick: () => wiz.pickQuote() }, '견적서 불러오기')]));

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

// SaaS 서비스(S2C · S2P · P2P · Sourcing) — 구축형태가 SaaS 일 때 템플릿 위에서 고른다(2026-10-30 사용자 요청 — 기본정보에서 옮김).
// 3단계(구성)에서 서비스 이용료 · (서비스) 품목을 고른 서비스로 맞추고 가격을 다시 채운다(step3-config.js syncService)
async function serviceCard(state, root, wiz, sol) {
  const { services } = await loadSaasCatalog(sol);
  if (!services.length) return null;
  const cur = quoteService(state, services);
  return h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' }, h('h2', {}, 'SaaS 서비스'),
      h('span', { class: 'sub' }, '고른 서비스로 구성(서비스 이용료 · 독립인프라 등)과 가격이 맞춰집니다')),
    h('div', { class: 'card-b', style: 'display:flex;gap:8px;flex-wrap:wrap' },
      ...services.map((x) => h('button', {
        class: 'btn' + (x.code === cur ? ' btn-primary' : ''), style: 'min-width:110px', title: String(x.item.spec || ''),
        onclick: () => { if (wiz.readOnly) return; wiz.patch({ type: { service: x.code } }); renderStep2(root, wiz.get(), wiz); },
      }, x.label)),
      cur ? null : h('span', { style: 'font-size:12px;color:var(--ss-red, #FF5252);align-self:center' }, '서비스를 고르세요')));
}

// 다음 단계로 가기 전 확인
export function validateStep2(state) {
  if (!state.type.deployment) return '구축형태를 선택하세요.';
  if (!state.type.template_code && !state.type.manual) return '템플릿을 선택하거나 [직접 작성으로 시작] 을 누르세요.';
  if (state.type.manual && !(state.applied && state.applied.solution)) return '솔루션을 선택하세요.';
  return null;
}

import { api } from '../api.js';
import { store } from '../app.js';
import { h, toast, clear, resizableColumns, numInput, won, openModal, previewControls } from '../ui.js';
import { BAND_KINDS, bandOf, bandLine, bandUnitOf, POLICY_GROUPS, policyGroup, payPlanDefault } from './quote/wizard/step3-config.js';

// 견적 템플릿 관리(ADMIN) — 2026-10-29 다시 만듦.
// M1 좌측 레일(d형: 코드 빨강 / 이름) + 본문(제목 줄 · 신규 · 복사 · 저장 → 기본정보 → 탭 상자[기본 모듈 | 인력]).
// 견적 작성 1단계(유형 선택)에서 템플릿을 고르면 여기서 정한 블록 · 기본 모듈(수량) · 인력(M/M)이 그대로 채워진다.
// 저장은 템플릿 한 건을 통째로(헤더 + 블록 + 모듈 + 인력) 보낸다 — PUT /api/templates/{id} 는 자식을 지우고 다시 넣는다.
// 지우기 API 는 없다 — 견적이 템플릿 코드를 참조하므로 '사용'을 끄면 견적 작성에서 고를 수 없게 된다.
// 미리보기 — 지금 화면의 값(저장 전 포함)으로 견적서 완성본을 그린다. 견적 작성·PDF 와 같은 렌더러(POST /api/quotes/preview)를 쓰고,
//   고객사·견적번호·견적일자처럼 템플릿에 없는 값은 비워 둔다(header.blank). 인쇄 버튼으로 PDF 저장도 된다.
const DEPLOYMENTS = [
  ['ONPREM_LUMP', '구축형 일시불'], ['ONPREM_INSTALL', '구축형 분납'], ['SAAS', 'SaaS'], ['PCLOUD', 'Private Cloud'],
];
const GRADES = [['초급', '초급'], ['중급', '중급'], ['고급', '고급'], ['특급', '특급']];
const LABOR_BLOCKS = ['LABOR', 'SETUP'];       // 인력을 넣을 수 있는 블록
const NO_ITEM_BLOCKS = ['LABOR', 'SUMMARY'];   // 모듈을 넣지 않는 블록
const depName = (c) => (DEPLOYMENTS.find(([k]) => k === c) || [])[1] || c || '';

const icon = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

export async function renderTemplates(root) {
  const master = await store.getMaster();
  const solutions = master.solutions || [];
  let templates = [];
  let blocksDef = [];      // sq_blocks
  let conditionSets = [];  // sq_condition_sets
  let roles = [];          // 사용 중인 연도 노임단가 직무 [{role_code, role_name, apply_price}]
  const priceCache = {};   // 솔루션별 가격정책 품목

  // 지금 편집 중인 템플릿
  let cur = null;          // { id, isNew, form, blocks:Set, items:[], labor:[] }
  let baseline = '';       // 불러온 때의 저장 값(JSON) — 변경 감지
  let tab = 'items';

  document.querySelector('.ss-app')?.classList.add('ss-app--railtitle');

  // ── 레일 ──
  const railSearch = h('input', { placeholder: 'Search', oninput: () => paintRail() });
  const railList = h('div');
  const rail = h('aside', { class: 'ss-rail ss-rail--code', style: '--ss-rail-w:320px' },
    h('div', { class: 'ss-rail__head ss-rail__head--title' }, '견적 템플릿'),
    h('div', { class: 'ss-rail__search' }, h('div', { class: 'ss-search' }, railSearch,
      h('button', { class: 'ss-search__btn', 'aria-label': '검색', html: icon.search }))),
    railList);
  const pane = h('div', { class: 'ss-railview__body', style: 'overflow:auto' });
  root.appendChild(h('div', { class: 'ss-railview' }, rail, pane));

  function paintRail() {
    const q = railSearch.value.trim().toLowerCase();
    clear(railList);
    const list = templates.filter((t) => !q || t.code.toLowerCase().includes(q) || String(t.name).toLowerCase().includes(q));
    if (!list.length) railList.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '템플릿이 없습니다.'));
    for (const t of list) {
      railList.appendChild(h('div', {
        class: 'ss-rail__code' + (cur && !cur.isNew && cur.id === t.id ? ' ss-rail__code--active' : ''),
        style: t.active ? null : 'opacity:.55',
        title: t.active ? null : '사용 중지 — 견적 작성에서 고를 수 없습니다',
        onclick: () => open(t.code),
      },
      h('span', { class: 'ss-rail__code-key' }, t.code),
      h('span', { class: 'ss-rail__code-name' }, t.name + (t.kind === 'STRUCT' ? ' [구조만]' : '') + (t.active ? '' : ' (중지)'))));
    }
  }

  async function loadList() {
    const r = await api.templates({ quote_type: 'BUILD' });
    templates = r.templates || [];
    paintRail();
  }

  // ── 불러오기 ──
  async function loadPrices(solution) {
    if (!solution) return [];
    if (!priceCache[solution]) {
      try { priceCache[solution] = (await api.pricing(solution)).items || []; } catch { priceCache[solution] = []; }
    }
    return priceCache[solution];
  }

  // 레일 항목을 누르면 무조건 오른쪽을 그 템플릿으로 다시 그린다 (저장 안 한 변경은 묻지 않고 버린다 — 마스터 관리와 같은 규칙)
  async function open(code) {
    clear(pane).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, '불러오는 중...'));
    try {
      const d = await api.templateDetail(code);
      const t = d.template;
      const items = Object.values(d.items || {}).flat()
        .sort((a, b) => order(a.block_code) - order(b.block_code) || a.sort - b.sort)
        .map((it) => ({ block_code: it.block_code, item_code: it.item_code, qty_default: num(it.qty_default, 1), band_key: it.band_key || null,
          band_qty: it.band_qty == null ? null : Number(it.band_qty), checked: false }));
      const labor = (d.labor || []).map((l) => ({
        block_code: l.block_code || 'LABOR', role_code: l.role_code, role_label: l.role_label, grade: l.grade,
        task: l.task, mm_default: num(l.mm_default, 0), checked: false,
      }));
      cur = {
        id: t.id, isNew: false,
        form: {
          code: t.code, name: t.name, solution: t.solution, deployment: t.deployment, brand: t.brand,
          condition_set: t.condition_set, has_labor_plan: t.has_labor_plan ? 1 : 0, has_pay_plan: t.has_pay_plan ? 1 : 0,
          active: t.active ? 1 : 0, sort: t.sort ?? 0,
          include_maintenance: t.include_maintenance ? 1 : 0, include_component: t.include_component ? 1 : 0,
          quote_type: t.quote_type || 'BUILD',
        },
        blocks: new Set((d.blocks || []).map((b) => b.block_code)),
        items, labor,
      };
      await loadPrices(t.solution);
      baseline = JSON.stringify(payload());
      tab = 'items';
      paint();
    } catch (err) {
      clear(pane).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message));
    }
  }

  function startNew() {
    const sol = solutions.find((s) => s.code === 'PROCURE')?.code || solutions[0]?.code || '';
    cur = {
      id: null, isNew: true,
      form: { code: '', name: '', solution: sol, deployment: 'ONPREM_LUMP', brand: '', condition_set: 'COND_ONPREM',
        has_labor_plan: 1, has_pay_plan: 0, active: 1, sort: templates.filter((t) => t.solution === sol).length + 1,
        include_maintenance: 0, include_component: 0, quote_type: 'BUILD' },
      blocks: new Set(['SOLUTION', 'LABOR', 'SUMMARY']),
      items: [], labor: [],
    };
    baseline = '';
    tab = 'items';
    loadPrices(sol).then(paint);
  }

  // 지금 연 템플릿을 새 템플릿으로 복사 — 코드 · 이름만 바꿔 저장하면 된다
  function copyCurrent() {
    if (!cur) return toast('복사할 템플릿을 왼쪽에서 고르세요.', 'err');
    cur = {
      id: null, isNew: true,
      form: { ...cur.form, code: `${cur.form.code}_COPY`, name: `${cur.form.name} (복사)`, active: 1 },
      blocks: new Set(cur.blocks),
      items: cur.items.map((x) => ({ ...x, checked: false })),
      labor: cur.labor.map((x) => ({ ...x, checked: false })),
    };
    baseline = '';
    paint();
    toast('복사본을 만들었습니다. 코드와 이름을 고친 뒤 저장하세요.', 'ok');
  }

  const order = (code) => { const i = blocksDef.findIndex((b) => b.code === code); return i < 0 ? 99 : i; };
  const num = (v, d) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

  // ── 본문 ──
  function paint() {
    clear(pane);
    paintRail();
    if (!cur) {
      pane.appendChild(h('div', { class: 'ss-subtitle' }, '견적 템플릿'));
      pane.appendChild(h('div', { class: 'ss-edithead', style: 'margin-top:16px' }, h('div', { class: 'ss-edithead__fields' }),
        h('div', { class: 'ss-actions' }, h('button', { class: 'ss-btn ss-btn--save', onclick: startNew }, '신규'))));
      pane.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, '왼쪽에서 템플릿을 고르거나 신규로 만드세요.'));
      return;
    }
    const f = cur.form;
    pane.appendChild(h('div', { class: 'ss-subtitle' }, cur.isNew ? '새 템플릿' : `${f.name}(${f.code})`));
    pane.appendChild(h('div', { class: 'ss-edithead', style: 'margin-top:16px' }, h('div', { class: 'ss-edithead__fields' }),
      h('div', { class: 'ss-actions' },
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: startNew }, '신규'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: copyCurrent, disabled: cur.isNew }, '복사'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: preview }, '미리보기'),
        h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));

    // 기본정보 — 4열 폼
    const saas = f.deployment === 'SAAS';
    const sel = (key, opts, onchange) => h('select', { class: 'ss-select', onchange: (e) => { f[key] = e.target.value || null; onchange?.(); } },
      ...opts.map(([v, t]) => h('option', { value: v, selected: v === (f[key] ?? '') }, t)));
    const inp = (key, attrs = {}) => h('input', { class: 'ss-input', value: f[key] ?? '', ...attrs, oninput: (e) => { f[key] = e.target.value; } });
    const chk = (key, text) => h('label', { style: 'display:flex;align-items:center;gap:6px;height:var(--ss-ctrl-h);font-size:13px' },
      h('input', { type: 'checkbox', checked: !!f[key], onchange: (e) => { f[key] = e.target.checked ? 1 : 0; } }), text);
    const field = (label, ctrl, cls = '', req = false) => h('div', { class: 'ss-field ' + cls },
      h('label', {}, label, req ? h('span', { class: 'req' }, ' *') : null), ctrl);

    // 블록 — 견적서에 찍히는 순서대로: 표 블록들 → 결제 방안 → 견적조건. 결제 방안 · 견적조건도 블록처럼 넣고 뺀다
    //   결제 방안 = has_pay_plan, 견적조건 = condition_set(빼면 null — 견적 작성에서 견적조건 없이 시작한다)
    const boxLabel = (checked, onchange, text) => h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:13px' },
      h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), text);
    const condSel = h('select', { class: 'ss-select', disabled: !f.condition_set, onchange: (e) => { f.condition_set = e.target.value; if (tab === '__COND') paintTabs(); } },
      ...conditionSets.map((c) => h('option', { value: c.code, selected: c.code === f.condition_set }, c.name)));
    const blockBoxes = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px 16px;min-height:var(--ss-ctrl-h);align-items:center' },
      ...blocksDef.filter((b) => b.code !== 'SUMMARY').map((b) => boxLabel(cur.blocks.has(b.code), (on) => {
        if (on) { cur.blocks.add(b.code); if (cur.form.deployment === 'SAAS' && !NO_ITEM_BLOCKS.includes(b.code)) tab = b.code; } else cur.blocks.delete(b.code); // SaaS 는 켠 블록 탭으로
        paintTabs(); // 고를 수 있는 블록이 바뀐다
      }, b.name)),
      boxLabel(!!f.has_pay_plan, (on) => { f.has_pay_plan = on ? 1 : 0; if (on) tab = '__PAY'; paintTabs(); }, '결제 방안'),
      boxLabel(!!f.condition_set, (on) => {
        f.condition_set = on ? (condSel.value || defaultCondSet(f.deployment)) : null;
        condSel.disabled = !on;
        if (on) { condSel.value = f.condition_set; tab = '__COND'; }
        paintTabs();
      }, '견적조건'));
    // 종류 — 기본 모듈 · 인력이 없으면 구조만(블록 틀만), 있으면 데이터 포함. 저장 값이 아니라 내용으로 정해진다
    const kindText = () => (cur.items.length || cur.labor.length ? '데이터 포함 — 기본 모듈 · 인력까지 채워져 있습니다' : '구조만 — 블록 틀과 견적조건 문구만 있고 모듈 · 인력은 견적 작성에서 넣습니다');
    kindEl = h('div', { style: 'display:flex;align-items:center;min-height:var(--ss-ctrl-h);font-size:13px;color:var(--ss-ink-2)' }, kindText());
    kindEl.refresh = () => { kindEl.textContent = kindText(); };

    pane.appendChild(h('div', { class: 'ss-form ss-form--cols4', style: 'max-width:none;margin:16px 0 0' },
      h('div', { class: 'ss-fields' },
        field('코드', inp('code', { style: 'font-family:inherit' }), '', true),
        field('템플릿명', inp('name'), 'ss-field--w2', true),
        field('사용', chk('active', '견적 작성에서 고를 수 있음')),
        field('솔루션', sel('solution', solutions.map((s) => [s.code, s.name || s.code]), async () => {
          await loadPrices(f.solution);
          paintTabs(); // 모듈 선택지가 솔루션별이다
        }), '', true),
        field('구축형태', sel('deployment', DEPLOYMENTS, () => paint()), '', true), // SaaS 는 칸 · 탭 모양이 다르다 — 전체를 다시 그린다
        field('브랜드', inp('brand', { placeholder: '견적서 표기명' })),
        // SaaS 는 견적조건 문구(→ 견적조건 탭에서 고른다) · 인력투입계획 · 종류 칸을 두지 않는다(2026-10-30 사용자 요청)
        saas ? null : field('견적조건 문구', condSel),
        field('정렬', numInput(f.sort, (v) => { f.sort = v; }, { class: 'ss-input', style: 'text-align:center' }, true)),
        saas ? null : field('인력투입계획', h('label', { style: 'display:flex;align-items:center;gap:6px;height:var(--ss-ctrl-h);font-size:13px' },
          h('input', { type: 'checkbox', checked: !!f.has_labor_plan, onchange: (e) => { f.has_labor_plan = e.target.checked ? 1 : 0; paintTabs(); } }),
          '월별 투입계획 표 사용')), // SaaS 는 켜면 인력 탭이 생긴다
        saas ? null : field('종류', kindEl, 'ss-field--w2'),
        field('블록 (견적서에 들어갈 순서)', blockBoxes, 'ss-field--full'))));

    // 탭 상자 — 기본 모듈 | 인력
    tabBox = h('div', { class: 'ss-tabbox', style: 'flex:1 0 320px' }); // 창이 작아도 그리드가 눌리지 않게 — 본문이 대신 스크롤된다
    pane.appendChild(tabBox);
    paintTabs();
  }

  let tabBox;
  let kindEl;
  const defaultCondSet = (dep) => ({ ONPREM_LUMP: 'COND_ONPREM', ONPREM_INSTALL: 'COND_INSTALL', SAAS: 'COND_SAAS', PCLOUD: 'COND_PCLOUD' }[dep])
    || conditionSets[0]?.code || null;
  function paintTabs() {
    if (!tabBox) return;
    kindEl?.refresh();
    clear(tabBox);
    const tabs = cur.form.deployment === 'SAAS' ? saasTabs()
      : [['items', `기본 모듈 (${cur.items.length})`], ['labor', `인력 (${cur.labor.length})`]];
    if (!tabs.some(([k]) => k === tab)) tab = tabs[0]?.[0] || 'items';
    tabBox.appendChild(h('div', { class: 'ss-tabs' }, ...tabs.map(([k, label]) => h('div', {
      class: 'ss-tabs__tab' + (k === tab ? ' ss-tabs__tab--active' : ''),
      onclick: () => { tab = k; paintTabs(); },
    }, label))));
    const body = h('div', { class: 'ss-tabbox__pane' });
    tabBox.appendChild(body);
    if (tab === 'labor') laborGrid(body);
    else if (tab === '__PAY') payPlanTab(body);
    else if (tab === '__COND') condTab(body);
    else if (cur.form.deployment === 'SAAS') saasItems(body, tab);
    else itemsGrid(body);
  }

  // SaaS — 위 '블록' 에서 켠 블록이 하나씩 탭이 된다(2026-10-30 사용자 요청). 탭 이름 = 블록명 (행 수).
  // 인력 탭은 인력이 있거나 인력투입계획을 쓸 때만. 꺼진 블록에 남은 행이 있으면 그 블록도 '(꺼짐)' 탭으로 보인다
  function saasTabs() {
    const on = blocksDef.filter((b) => cur.blocks.has(b.code) && !NO_ITEM_BLOCKS.includes(b.code));
    const off = [...new Set(cur.items.map((r) => r.block_code))].filter((c) => c && !on.some((b) => b.code === c));
    const cnt = (code) => cur.items.filter((r) => r.block_code === code).length;
    return [
      ...on.map((b) => [b.code, `${b.name} (${cnt(b.code)})`]),
      ...off.map((c) => [c, `${(blocksDef.find((b) => b.code === c) || {}).name || c} (꺼짐 · ${cnt(c)})`]),
      ...(cur.labor.length || cur.form.has_labor_plan ? [['labor', `인력 (${cur.labor.length})`]] : []),
      ...(cur.form.has_pay_plan ? [['__PAY', '결제 방안']] : []),
      ...(cur.form.condition_set ? [['__COND', '견적조건']] : []),
    ];
  }

  // 탭 안 머리: 안내 한 줄 + 행추가 · 행삭제
  function gridHead(body, note, onAdd, list) {
    body.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
      h('span', { class: 'ss-detailbar__note' }, note),
      h('span', { class: 'ss-detailbar__spacer' }),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: onAdd }, '행추가'),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
        if (!list().some((r) => r.checked)) return toast('삭제할 행을 선택하세요.', 'err');
        if (tab === 'items') cur.items = cur.items.filter((r) => !r.checked);
        else cur.labor = cur.labor.filter((r) => !r.checked);
        paintTabs();
      } }, '행삭제')));
  }

  function gridTable(body, cols, storeKey) {
    const widths = [60, ...cols.map((c) => c.w)];
    const tbody = h('tbody');
    const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${widths.reduce((s, w) => s + w, 0)}px` },
      h('colgroup', {}, ...widths.map((w) => h('col', { style: `width:${w}px` }))),
      h('thead', {}, h('tr', {}, h('th', { 'data-fixed': '' }, '선택'),
        ...cols.map((c) => h('th', { class: c.req ? 'req' : null }, c.label)))),
      tbody);
    body.appendChild(h('div', { class: 'ss-gridwrap ss-gridwrap--fill', style: 'margin-top:8px' }, table));
    resizableColumns(table, storeKey);
    return tbody;
  }

  const cellSelect = (label, opts, value, onchange) => h('td', { class: 'ss-cell--input' },
    h('select', { class: 'ss-cellinput', 'aria-label': label, onchange: (e) => onchange(e.target.value || null) },
      h('option', { value: '', selected: !value }, '선택'),
      ...opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t))));
  const cellText = (label, value, onchange, style) => h('td', { class: 'ss-cell--input' },
    h('input', { class: 'ss-cellinput', 'aria-label': label, value: value ?? '', style, oninput: (e) => onchange(e.target.value) }));
  const cellNum = (label, value, onchange) => h('td', { class: 'ss-cell--input' },
    numInput(value, (v) => onchange(v === '' ? null : Number(v)), { class: 'ss-cellinput', 'aria-label': label, style: 'text-align:right' }));
  const checkCell = (r) => h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } }));

  function itemsGrid(body) {
    if (cur.form.deployment === 'SAAS') return saasItems(body);
    const blockOpts = blocksDef.filter((b) => cur.blocks.has(b.code) && !NO_ITEM_BLOCKS.includes(b.code)).map((b) => [b.code, b.name]);
    const prices = priceCache[cur.form.solution] || [];
    gridHead(body, '견적 작성에서 이 모듈들이 기본으로 들어갑니다. 단가는 가격정책 품목의 기준단가를 씁니다.', () => {
      cur.items.push({ block_code: blockOpts[0]?.[0] || null, item_code: null, qty_default: 1, checked: false });
      paintTabs();
    }, () => cur.items);
    // SaaS 구간형 서비스(S2C · S2P …)는 인원·건수 칸에서 인원 / 건수를 고르고 숫자를 넣는다.
    // 기준단가는 그 구간의 월 금액, 수량(기본수량) · 단위는 따로다 — 견적 작성 3단계와 같은 구조
    const tbody = gridTable(body, [
      { label: '블록', w: 170, req: true }, { label: '품목코드', w: 160 }, { label: '품목', w: 260, req: true },
      { label: '구축형태', w: 120 }, { label: '인원·건수', w: 170 }, { label: '단위', w: 80 }, { label: '기본수량', w: 90 }, { label: '기준단가 (원)', w: 140 },
    ], 'quote2:tpl-items-cols3');
    if (!cur.items.length) { tbody.appendChild(h('tr', {}, h('td', { colspan: 9, class: 'ss-cell--empty' }, '기본 모듈이 없습니다. 행추가로 넣으세요.'))); return; }
    for (const r of cur.items) {
      const p = prices.find((x) => x.code === r.item_code);
      // 가격정책에 없는 코드도 그대로 보여준다 (미등록)
      const opts = prices.map((x) => [x.code, `${x.name}${x.deployment !== cur.form.deployment ? ` · ${depName(x.deployment)}` : ''}`]);
      if (r.item_code && !p) opts.unshift([r.item_code, `${r.item_code} (가격정책 미등록)`]);
      const variants = bandVariants(p);
      const priceTd = h('td', { style: 'text-align:right' });
      const paintPrice = () => {
        if (!variants) { priceTd.textContent = p ? won(p.base_price) : ''; priceTd.title = ''; return; }
        const v = bandOf(variants, r.band_key || 'USER', num(r.band_qty, 1));
        priceTd.textContent = v ? won(v.price) : '구간 없음';
        priceTd.title = v ? `${v.label} 구간 월 금액` : '가격정책에 맞는 구간이 없습니다';
        priceTd.style.color = v ? '' : 'var(--ss-red, #FF5252)';
      };
      // 인원·건수 — [인원 / 건수] + 숫자(비우면 1). 구간형이 아닌 품목은 빈칸
      const bandUnit = h('span', { style: 'font-size:12px;color:var(--ss-ink-3);width:14px' }, BAND_KINDS[r.band_key || 'USER'][1]);
      const bandTd = variants
        ? h('td', { class: 'ss-cell--input' }, h('div', { style: 'display:flex;gap:4px;align-items:center' },
          h('select', { class: 'ss-cellinput', 'aria-label': '인원·건수 구분', style: 'text-align:center;width:72px;flex:none',
            onchange: (e) => { r.band_key = e.target.value; bandUnit.textContent = BAND_KINDS[r.band_key][1]; paintPrice(); } },
          ...Object.entries(BAND_KINDS).filter(([k]) => variants.some((v) => bandKey(v) === k))
            .map(([k, [label]]) => h('option', { value: k, selected: (r.band_key || 'USER') === k }, label))),
          numInput(r.band_qty ?? 1, (v) => { r.band_qty = v === '' ? null : Number(v); paintPrice(); },
            { class: 'ss-cellinput', 'aria-label': '인원·건수', style: 'text-align:right;flex:1;min-width:0' }),
          bandUnit))
        : h('td', {});
      paintPrice();
      const tr = h('tr', {});
      tr.append(
        checkCell(r),
        cellSelect('블록', r.block_code && !blockOpts.some(([v]) => v === r.block_code) ? [[r.block_code, `${r.block_code} (블록 꺼짐)`], ...blockOpts] : blockOpts,
          r.block_code, (v) => { r.block_code = v; }),
        h('td', { class: 'ss-cell--link' }, r.item_code || ''),
        cellSelect('품목', opts, r.item_code, (v) => { r.item_code = v; r.band_key = null; r.band_qty = null; paintTabs(); }),
        h('td', {}, p ? depName(p.deployment) : ''),
        bandTd,
        h('td', { style: 'text-align:center' }, p ? p.unit || '' : ''),
        cellNum('기본수량', r.qty_default, (v) => { r.qty_default = v; }),
        priceTd);
      tbody.appendChild(tr);
    }
  }

  // SaaS — 견적 작성 3단계(구성)와 같은 모양(2026-10-30 사용자 요청): 블록마다 표 하나,
  // 칸은 구분(기본 · 부가 · 옵션) · 모듈 · 세부기능 · 인원·건수 · 수량 · 단위 · 기준단가 · 금액 · 품목코드, 끝에 소계.
  // 저장하는 값은 그대로(블록 · 품목코드 · 기본수량 · 인원·건수) — 구분은 품목에서 정해지고, 모듈 목록을 거르는 데만 쓴다.
  function saasItems(body, code) {
    const prices = (priceCache[cur.form.solution] || []).filter((x) => x.deployment === 'SAAS');
    const blocks = blocksDef.filter((b) => cur.blocks.has(b.code) && !NO_ITEM_BLOCKS.includes(b.code));
    if (!code || code === 'items') {
      body.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, '위 블록에서 견적서에 넣을 블록을 켜세요. 켠 블록이 여기 탭으로 나옵니다.'));
      return;
    }
    body.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
      h('span', { class: 'ss-detailbar__note' }, '견적 작성 3단계(구성)와 같은 모양입니다. 여기 넣은 모듈 · 수량 · 인원·건수가 견적 작성에서 기본으로 들어가고, 단가 · 금액은 견적 작성에서 가격정책으로 채워집니다.')));
    const at = blocks.findIndex((b) => b.code === code);
    const b = at >= 0 ? blocks[at] : { code, name: `${(blocksDef.find((x) => x.code === code) || {}).name || code} (블록 꺼짐 — 블록을 다시 켜거나 행을 지우세요)` };
    body.appendChild(saasBlockCard(b, at >= 0 ? at + 1 : '-', prices, at >= 0 ? null : cur.items.filter((r) => r.block_code === code)));
  }

  // 결제 방안 탭 — 템플릿은 넣을지(켜고 끔)만 정한다. 견적서에 들어갈 기본 표를 이 템플릿의 기본 금액으로 보여 준다.
  // 비율 · 문구는 견적 작성 3단계(구성)의 결제 방안에서 견적마다 고친다
  function payPlanTab(body) {
    // 템플릿에는 금액을 두지 않는다(2026-10-30 사용자 요청) — 기본 문구에서 금액 부분을 빼고 보인다
    const rows = payPlanDefault(1, 1, 50).map((r) => r.map((v) => v.replace(/\s*:\s*₩[\d,]+원/g, '')));
    body.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
      h('span', { class: 'ss-detailbar__note' }, '견적서에 들어갈 결제 방안 기본 문구입니다(계약체결 50% 기준). 금액은 견적 작성에서 채워지고, 비율과 문구는 견적 작성 3단계(구성)에서 견적마다 고칩니다.')));
    const cols = [['구분', 150], ['지급시점', 220], ['비용', 360], ['내역', 420]];
    body.appendChild(h('div', { class: 'card', style: 'margin-top:12px;padding:10px 12px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' }, h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ 결제 방안')),
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' },
        h('table', { class: 'ss-grid ss-grid--sized', style: `width:${cols.reduce((a, [, w]) => a + w, 0)}px;min-width:100%` },
          h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
          h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
          h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((v, i) => h('td', { style: `white-space:pre-line;text-align:${i ? 'left' : 'center'}` }, v)))))))));
  }

  // 견적조건 탭 — 고른 문구 세트(위 '견적조건 문구')의 문장 + SaaS 는 가격정책(SaaS) 현재 버전의 견적조건이 뒤에 붙는다(같은 문장은 한 번).
  // 견적 작성에서 템플릿을 고르면 이 순서 그대로 들어가고, 견적마다 고칠 수 있다
  const policyConds = {};
  async function condTab(body) {
    const f = cur.form;
    const set = conditionSets.find((c) => c.code === f.condition_set);
    const lines = (set && set.lines) || [];
    let extra = [];
    if (f.deployment === 'SAAS' && f.solution) {
      if (!policyConds[f.solution]) {
        try {
          const pv = await api.pricePolicy(f.solution, 'SAAS');
          policyConds[f.solution] = ((pv.current && pv.current.content && pv.current.content.conds) || []).map((x) => String(x || '').trim()).filter(Boolean);
        } catch { policyConds[f.solution] = []; }
      }
      extra = policyConds[f.solution].filter((t) => !lines.includes(t));
    }
    const sel = h('select', { class: 'ss-select', style: 'width:240px', onchange: (e) => { f.condition_set = e.target.value; paint(); } }, // 위 기본정보의 견적조건 문구도 같이 바뀌게 전체를 다시 그린다
      ...conditionSets.map((c) => h('option', { value: c.code, selected: c.code === f.condition_set }, c.name)));
    body.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
      h('span', { class: 'ss-detailbar__note' }, '견적 작성에서 이 템플릿을 고르면 아래 문장이 이 순서로 견적조건에 들어갑니다. 견적마다 고칠 수 있습니다.')));
    const tbody = h('tbody');
    const all = [...lines.map((t) => [t, set ? set.name : '']), ...extra.map((t) => [t, '가격정책 견적조건'])];
    all.forEach(([t, src], i) => tbody.appendChild(h('tr', {},
      h('td', { style: 'text-align:center' }, String(i + 1)),
      h('td', { style: 'text-align:left;white-space:pre-line' }, t),
      h('td', { style: 'text-align:center;color:var(--ss-ink-3)' }, src))));
    if (!all.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 3, class: 'ss-cell--empty', style: 'height:60px' }, '문구가 없습니다.')));
    const cols = [['No', 60], ['문구', 760], ['출처', 180]];
    body.appendChild(h('div', { class: 'card', style: 'margin-top:12px;padding:10px 12px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ 견적조건'),
        h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12.5px;margin-left:12px' }, '문구 세트', sel)),
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' },
        h('table', { class: 'ss-grid ss-grid--sized', style: `width:${cols.reduce((a, [, w]) => a + w, 0)}px;min-width:100%` },
          h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
          h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
          tbody))));
  }

  function saasBlockCard(b, no, prices, only) {
    const rows = only || cur.items.filter((r) => r.block_code === b.code);
    const hasBand = rows.some((r) => bandVariants(prices.find((x) => x.code === r.item_code)));
    const cols = [['선택', 44], ['구분', 90], ['모듈', 220], ['세부기능', 320], ...(hasBand ? [['인원·건수', 170]] : []),
      ['수량', 76], ['단위', 72], ['품목코드', 140]];
    // 템플릿에는 금액(기준단가 · 금액 · 소계)을 두지 않는다(2026-10-30 사용자 요청) — 단가 · 금액은 견적 작성에서 가격정책으로 채운다

    const head = h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
      h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, `▣ ${no}. ${b.name}`),
      b.recurring ? h('span', { class: 'badge badge-yellow' }, '월정액') : null,
      h('div', { class: 'ss-detailbar__spacer' }),
      only ? null : h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
        cur.items.push({ block_code: b.code, item_code: null, qty_default: 1, group: rows.length ? rows[rows.length - 1].group || null : null, checked: false });
        paintTabs();
      } }, '행추가'),
      h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => {
        if (!rows.some((r) => r.checked)) return toast('삭제할 행을 선택하세요.', 'err');
        cur.items = cur.items.filter((r) => !(rows.includes(r) && r.checked));
        paintTabs();
      } }, '행삭제'));

    const tbody = h('tbody');
    for (const r of rows) {
      const p = prices.find((x) => x.code === r.item_code) || (priceCache[cur.form.solution] || []).find((x) => x.code === r.item_code);
      if (p) r.group = policyGroup(p); // 구분은 품목에서 — 견적 작성과 같은 규칙
      const variants = bandVariants(p);
      // 모듈 — 고른 구분의 SaaS 품목. 목록에 없는 지금 값(미등록 코드 등)도 한 줄로 남긴다
      const inGroup = prices.filter((x) => !r.group || policyGroup(x) === r.group);
      // 서비스 이용료(S2C · S2P …)는 가격정책 용어대로 '서비스 이용료' 한 줄 — 어느 서비스인지는 견적 작성 1단계에서 고른다.
      // 이미 서비스 품목이 들어 있으면 그 코드, 새 행은 첫 서비스 품목 코드로 둔다
      const svcCode = variants ? r.item_code : (inGroup.find((x) => bandVariants(x)) || {}).code;
      const opts = [];
      for (const x of inGroup) {
        if (!bandVariants(x)) opts.push([x.code, x.name]);
        else if (x.code === svcCode) opts.push([x.code, SVC_TERM]);
      }
      if (r.item_code && !opts.some(([c]) => c === r.item_code)) opts.unshift([r.item_code, p ? (variants ? SVC_TERM : p.name) : `${r.item_code} (가격정책 미등록)`]);
      const bandUnit = h('span', { style: 'font-size:12px;color:var(--ss-ink-3);width:14px' }, BAND_KINDS[r.band_key || 'USER'][1]);
      // 단위 — 인원·건수가 있는 서비스 이용료 행은 인원이면 '명', 건수면 '건'(2026-10-30 사용자 요청). 나머지는 가격정책 품목 단위
      const unitTd = h('td', { style: 'text-align:center' }, variants ? BAND_KINDS[r.band_key || 'USER'][1] : (p ? p.unit || '' : ''));
      const bandTd = variants
        ? h('td', { class: 'ss-cell--input' }, h('div', { style: 'display:flex;gap:4px;align-items:center' },
          h('select', { class: 'ss-cellinput', 'aria-label': '인원·건수 구분', style: 'text-align:center;width:72px;flex:none',
            onchange: (e) => { r.band_key = e.target.value; bandUnit.textContent = BAND_KINDS[r.band_key][1]; unitTd.textContent = BAND_KINDS[r.band_key][1]; } },
          ...Object.entries(BAND_KINDS).filter(([k]) => variants.some((v) => bandKey(v) === k))
            .map(([k, [label]]) => h('option', { value: k, selected: (r.band_key || 'USER') === k }, label))),
          numInput(r.band_qty ?? 1, (v) => { r.band_qty = v === '' ? null : Number(v); },
            { class: 'ss-cellinput', 'aria-label': '인원·건수', style: 'text-align:right;flex:1;min-width:0' }),
          bandUnit))
        : h('td', {});
      const tr = h('tr', {});
      tr.append(
        checkCell(r),
        cellSelect('구분', POLICY_GROUPS.map((g) => [g, g]), r.group || null, (v) => {
          r.group = v;
          if (p && policyGroup(p) !== v) { r.item_code = null; r.band_key = null; r.band_qty = null; } // 다른 구분의 모듈은 비운다
          paintTabs();
        }),
        cellSelect('모듈', opts, r.item_code, (v) => { r.item_code = v; r.band_key = null; r.band_qty = null; paintTabs(); }),
        h('td', { style: 'text-align:left;white-space:pre-line;color:var(--ss-ink-2)' }, p ? p.spec || '' : ''),
        ...(hasBand ? [bandTd] : []),
        cellNum('수량', r.qty_default, (v) => { r.qty_default = v; }),
        unitTd,
        h('td', { class: 'ss-cell--link' }, r.item_code || ''));
      tbody.appendChild(tr);
    }
    if (!rows.length) tbody.appendChild(h('tr', {}, h('td', { colspan: cols.length, class: 'ss-cell--empty', style: 'height:60px' }, '[행추가] 로 모듈을 넣으세요.')));

    const width = cols.reduce((a, [, w]) => a + w, 0);
    const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${width}px;min-width:100%` },
      h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
      h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
      tbody);
    return h('div', { class: 'card', style: 'margin-top:12px;padding:10px 12px' }, head,
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' }, table));
  }

  const SVC_TERM = '서비스 이용료'; // 가격정책 기본정보의 세부 이름

  // 구간형 서비스(pricing_type BAND)의 구간 — 없으면 null. 예전 인원 구간은 key 가 비어 있다(COUNT 가 아니면 인원)
  const bandKey = (v) => (v.key === 'COUNT' ? 'COUNT' : 'USER');
  const bandVariants = (p) => (p && p.pricing_type === 'BAND' && (p.variants || []).length ? p.variants : null);

  function laborGrid(body) {
    const blockOpts = blocksDef.filter((b) => cur.blocks.has(b.code) && LABOR_BLOCKS.includes(b.code)).map((b) => [b.code, b.name]);
    gridHead(body, '견적 작성에서 이 인력이 기본으로 들어갑니다. 단가는 사용 중인 연도의 노임단가를 씁니다.', () => {
      if (!blockOpts.length) return toast('인력을 넣을 블록(개발인건비 · 셋업비용)을 먼저 켜세요.', 'err');
      cur.labor.push({ block_code: (blockOpts.find(([v]) => v === 'LABOR') || blockOpts[0])[0], role_code: null, role_label: '', grade: '중급', task: '', mm_default: 1, checked: false });
      paintTabs();
    }, () => cur.labor);
    const tbody = gridTable(body, [
      { label: '블록', w: 170, req: true }, { label: '직무코드', w: 110 }, { label: '직무 (노임단가)', w: 180, req: true },
      { label: '표시명', w: 130 }, { label: '등급', w: 90 }, { label: '업무', w: 320 }, { label: '기본 M/M', w: 90 },
    ], 'quote2:tpl-labor-cols');
    if (!cur.labor.length) { tbody.appendChild(h('tr', {}, h('td', { colspan: 8, class: 'ss-cell--empty' }, '인력이 없습니다. 행추가로 넣으세요.'))); return; }
    const roleOpts = roles.map((r) => [r.role_code, r.role_name]);
    for (const r of cur.labor) {
      const opts = r.role_code && !roles.some((x) => x.role_code === r.role_code) ? [[r.role_code, `${r.role_code} (노임단가 없음)`], ...roleOpts] : roleOpts;
      const tr = h('tr', {});
      tr.append(
        checkCell(r),
        cellSelect('블록', blockOpts.some(([v]) => v === r.block_code) ? blockOpts : [[r.block_code, `${r.block_code} (블록 꺼짐)`], ...blockOpts],
          r.block_code, (v) => { r.block_code = v; }),
        h('td', { class: 'ss-cell--link' }, r.role_code || ''),
        cellSelect('직무', opts, r.role_code, (v) => {
          r.role_code = v;
          if (!r.role_label) r.role_label = roles.find((x) => x.role_code === v)?.role_name || '';
          paintTabs();
        }),
        cellText('표시명', r.role_label, (v) => { r.role_label = v; }),
        cellSelect('등급', GRADES, r.grade, (v) => { r.grade = v; }),
        cellText('업무', r.task, (v) => { r.task = v; }),
        cellNum('기본 M/M', r.mm_default, (v) => { r.mm_default = v; }));
      tbody.appendChild(tr);
    }
  }

  // ── 미리보기 ──
  // 견적 작성 3단계가 템플릿을 적용한 직후와 같은 모양: 제안단가 = 기준단가, 수량·M/M = 기본값.
  // 인건비 단가는 개발인건비(LABOR) 블록에만 싣는다 — 셋업비용의 인력은 공수 배분용이라 금액이 아니다.
  function previewBlocks() {
    const prices = priceCache[cur.form.solution] || [];
    return blocksDef.filter((b) => cur.blocks.has(b.code) && b.code !== 'SUMMARY').map((b) => {
      const isLabor = b.code === 'LABOR';
      const items = cur.items.filter((r) => r.block_code === b.code && r.item_code).map((r) => {
        const p = prices.find((x) => x.code === r.item_code);
        const variants = bandVariants(p);
        if (variants) { // 구간 행 — 단가는 구간 월 금액, 금액 = 단가 × 수량. 세부기능 아래에 '(건수 40건 기준)'
          const band = { band: r.band_key || 'USER', band_qty: num(r.band_qty, 1) };
          const v = bandOf(variants, band.band, band.band_qty);
          const price = v ? Number(v.price) : null;
          return { item_code: r.item_code, category: p?.category || null, name: p?.name || r.item_code,
            spec: [p?.spec, bandLine(band)].filter(Boolean).join('\n'),
            unit: bandUnitOf(band.band), qty: num(r.qty_default, 1), base_price: price, proposed_price: price || 0 };
        }
        const base = p && p.base_price != null ? Number(p.base_price) : null;
        return { item_code: r.item_code, category: p?.category || null, name: p?.name || r.item_code, spec: p?.spec || null,
          unit: p?.unit || null, qty: num(r.qty_default, 1), base_price: base, proposed_price: base || 0 };
      });
      const labor = cur.labor.filter((r) => r.block_code === b.code && r.role_code).map((r) => {
        const rate = roles.find((x) => x.role_code === r.role_code);
        const base = rate && rate.apply_price != null ? Number(rate.apply_price) : null;
        const out = { role_code: r.role_code, role_name: rate?.role_name || null, role_label: r.role_label || null,
          grade: r.grade || null, task: r.task || null, mm: num(r.mm_default, 0) };
        return isLabor ? { ...out, base_price: base, proposed_price: base || 0 } : out;
      });
      // 빈 labor 배열을 함께 보내면 서버가 인건비 블록으로 본다 — 값이 있는 쪽만 싣는다(견적 작성과 같은 규칙)
      const out = { block_code: b.code, name: b.name, recurring: b.recurring ? 1 : 0 };
      if (items.length) out.items = items;
      if (labor.length) out.labor = labor;
      if (!items.length && !labor.length) out.items = [];
      return out;
    });
  }

  async function preview() {
    const f = cur.form;
    const frame = h('iframe', { style: 'width:100%;height:72vh;border:1px solid #E7EAF0;background:#fff' });
    const state = h('span', { style: 'font-size:12px;color:var(--text-3);margin-right:8px' }, '그리는 중...');
    const printBtn = h('button', { class: 'btn', disabled: true, onclick: () => frame.contentWindow.print() }, '인쇄 · PDF 저장');
    const m = openModal({
      title: `견적서 미리보기 — ${f.name || '새 템플릿'}${f.code ? ` (${f.code})` : ''}`,
      body: frame,
      footer: [state, printBtn, h('button', { class: 'btn btn-primary', onclick: () => m.close() }, '닫기')],
    });
    const box = m.back.querySelector('.modal');
    box.style.width = '880px';
    box.querySelector('.modal-body').style.padding = '12px';
    box.querySelector('.modal-foot').prepend(previewControls(frame, box));
    try {
      const r = await api.previewQuote({
        blocks: previewBlocks(),
        header: { blank: true, template_code: f.code || null, condition_set: f.condition_set || null, pay_plan: f.has_pay_plan ? 1 : 0,
          // 견적조건을 뺀 템플릿은 견적조건 칸 없이 그린다
          ...(f.condition_set ? {} : { conditions: [] }),
          solution: f.solution, brand: f.brand || null, deployment: f.deployment, quote_type: f.quote_type || 'BUILD' },
        round_unit: 100000,
      });
      frame.srcdoc = r.html;
      const c = r.calc || {};
      state.textContent = `기본값 기준 · 일시불 ${won(c.onetime_total)}원${c.monthly_total ? ` / 월 ${won(c.monthly_total)}원` : ''}${cur.isNew || JSON.stringify(payload()) !== baseline ? ' · 저장 전 내용' : ''}`;
      printBtn.disabled = false;
    } catch (err) {
      state.textContent = '';
      frame.replaceWith(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message));
    }
  }

  // ── 저장 ──
  function payload() {
    const f = cur.form;
    const trim = (v) => (v == null ? null : String(v).trim() || null);
    return {
      quote_type: f.quote_type || 'BUILD', solution: f.solution, code: trim(f.code), name: trim(f.name),
      deployment: f.deployment, brand: trim(f.brand), condition_set: f.condition_set || null,
      include_maintenance: f.include_maintenance ? 1 : 0, include_component: f.include_component ? 1 : 0,
      has_labor_plan: f.has_labor_plan ? 1 : 0, has_pay_plan: f.has_pay_plan ? 1 : 0, active: f.active ? 1 : 0, sort: Number(f.sort) || 0,
      blocks: blocksDef.filter((b) => cur.blocks.has(b.code) || b.code === 'SUMMARY').map((b) => b.code),
      items: cur.items.map((r) => ({ block_code: r.block_code, item_code: r.item_code, qty_default: r.qty_default ?? 1,
        // 구간형 서비스는 단위를 늘 싣는다(안 고르면 인원) — 서버는 단위가 있어야 인원·건수 숫자를 저장한다
        ...(bandVariants((priceCache[f.solution] || []).find((x) => x.code === r.item_code))
          ? { band_key: r.band_key || 'USER', band_qty: r.band_qty ?? null } : { band_key: null, band_qty: null }) })),
      labor: cur.labor.map((r) => ({ block_code: r.block_code, role_code: r.role_code, role_label: trim(r.role_label),
        grade: r.grade || null, task: trim(r.task), mm_default: r.mm_default ?? 0 })),
    };
  }

  async function save() {
    const p = payload();
    const f0 = cur.form;
    if (!cur.isNew && JSON.stringify(p) === baseline) return toast('변경된 내용이 없습니다.', 'ok');
    if (!p.code || !p.name || !p.solution || !p.deployment) return toast('필수 항목을 확인하세요: 코드 · 템플릿명 · 솔루션 · 구축형태', 'err');
    if (templates.some((t) => t.code === p.code && t.id !== cur.id)) return toast(`이미 있는 코드입니다: ${p.code}`, 'err');
    if (!p.blocks.some((b) => b !== 'SUMMARY')) return toast('블록을 하나 이상 고르세요.', 'err');
    const badItem = p.items.findIndex((r) => !r.block_code || !r.item_code || !p.blocks.includes(r.block_code));
    if (badItem >= 0) { tab = f0.deployment === 'SAAS' ? p.items[badItem].block_code : 'items'; paintTabs(); return toast(`기본 모듈 ${badItem + 1}번째 행: 블록과 품목을 확인하세요 (켜진 블록만 쓸 수 있습니다).`, 'err'); }
    const badLabor = p.labor.findIndex((r) => !r.block_code || !r.role_code || !p.blocks.includes(r.block_code));
    if (badLabor >= 0) { tab = 'labor'; paintTabs(); return toast(`인력 ${badLabor + 1}번째 행: 블록과 직무를 확인하세요 (켜진 블록만 쓸 수 있습니다).`, 'err'); }
    try {
      if (cur.isNew) await api.createTemplate(p);
      else await api.updateTemplate(cur.id, p);
      toast('저장되었습니다.', 'ok');
      await loadList();
      await open(p.code);
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  // ── 시작 ──
  try {
    const [b, c, l] = await Promise.all([api.blocks(), api.conditions(), api.laborRates().catch(() => ({ rates: [] }))]);
    blocksDef = (b.blocks || []).sort((x, y) => x.sort - y.sort);
    conditionSets = c.conditions || [];
    roles = l.rates || [];
    await loadList();
  } catch (err) {
    pane.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message));
    return;
  }
  paint();
  if (templates[0]) open(templates[0].code);
}

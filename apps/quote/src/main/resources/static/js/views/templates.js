import { api } from '../api.js';
import { store } from '../app.js';
import { h, toast, clear, resizableColumns, numInput, won, openModal } from '../ui.js';

// 견적 템플릿 관리(ADMIN) — 2026-10-29 다시 만듦.
// M1 좌측 레일(d형: 코드 빨강 / 이름) + 본문(제목 줄 · 신규 · 복사 · 저장 → 기본정보 → 탭 상자[기본 모듈 | 인력]).
// 견적 작성 2단계에서 템플릿을 고르면 여기서 정한 블록 · 기본 모듈(수량) · 인력(M/M)이 그대로 채워진다.
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
      h('span', { class: 'ss-rail__code-name' }, t.name + (t.active ? '' : ' (중지)'))));
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
        .map((it) => ({ block_code: it.block_code, item_code: it.item_code, qty_default: num(it.qty_default, 1), checked: false }));
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
    const sel = (key, opts, onchange) => h('select', { class: 'ss-select', onchange: (e) => { f[key] = e.target.value || null; onchange?.(); } },
      ...opts.map(([v, t]) => h('option', { value: v, selected: v === (f[key] ?? '') }, t)));
    const inp = (key, attrs = {}) => h('input', { class: 'ss-input', value: f[key] ?? '', ...attrs, oninput: (e) => { f[key] = e.target.value; } });
    const chk = (key, text) => h('label', { style: 'display:flex;align-items:center;gap:6px;height:var(--ss-ctrl-h);font-size:13px' },
      h('input', { type: 'checkbox', checked: !!f[key], onchange: (e) => { f[key] = e.target.checked ? 1 : 0; } }), text);
    const field = (label, ctrl, cls = '', req = false) => h('div', { class: 'ss-field ' + cls },
      h('label', {}, label, req ? h('span', { class: 'req' }, ' *') : null), ctrl);

    const blockBoxes = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px 16px;min-height:var(--ss-ctrl-h);align-items:center' },
      ...blocksDef.map((b) => h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:13px' },
        h('input', { type: 'checkbox', checked: cur.blocks.has(b.code), onchange: (e) => {
          if (e.target.checked) cur.blocks.add(b.code); else cur.blocks.delete(b.code);
          paintTabs(); // 고를 수 있는 블록이 바뀐다
        } }), b.name)));

    pane.appendChild(h('div', { class: 'ss-form ss-form--cols4', style: 'max-width:none;margin:16px 0 0' },
      h('div', { class: 'ss-fields' },
        field('코드', inp('code', { style: 'font-family:inherit' }), '', true),
        field('템플릿명', inp('name'), 'ss-field--w2', true),
        field('사용', chk('active', '견적 작성에서 고를 수 있음')),
        field('솔루션', sel('solution', solutions.map((s) => [s.code, s.name || s.code]), async () => {
          await loadPrices(f.solution);
          paintTabs(); // 모듈 선택지가 솔루션별이다
        }), '', true),
        field('구축형태', sel('deployment', DEPLOYMENTS), '', true),
        field('브랜드', inp('brand', { placeholder: '견적서 표기명' })),
        field('견적조건', sel('condition_set', [['', '없음'], ...conditionSets.map((c) => [c.code, c.name])])),
        field('정렬', numInput(f.sort, (v) => { f.sort = v; }, { class: 'ss-input', style: 'text-align:center' }, true)),
        field('인력투입계획', chk('has_labor_plan', '월별 투입계획 표 사용')),
        field('결제 방안', chk('has_pay_plan', '클라우드서비스 결제 방안 표 사용')),
        field('블록 (견적서에 들어갈 표)', blockBoxes, 'ss-field--w2'))));

    // 탭 상자 — 기본 모듈 | 인력
    tabBox = h('div', { class: 'ss-tabbox', style: 'flex:1 0 320px' }); // 창이 작아도 그리드가 눌리지 않게 — 본문이 대신 스크롤된다
    pane.appendChild(tabBox);
    paintTabs();
  }

  let tabBox;
  function paintTabs() {
    if (!tabBox) return;
    clear(tabBox);
    const tabs = [['items', `기본 모듈 (${cur.items.length})`], ['labor', `인력 (${cur.labor.length})`]];
    tabBox.appendChild(h('div', { class: 'ss-tabs' }, ...tabs.map(([k, label]) => h('div', {
      class: 'ss-tabs__tab' + (k === tab ? ' ss-tabs__tab--active' : ''),
      onclick: () => { tab = k; paintTabs(); },
    }, label))));
    const body = h('div', { class: 'ss-tabbox__pane' });
    tabBox.appendChild(body);
    if (tab === 'items') itemsGrid(body); else laborGrid(body);
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
    const blockOpts = blocksDef.filter((b) => cur.blocks.has(b.code) && !NO_ITEM_BLOCKS.includes(b.code)).map((b) => [b.code, b.name]);
    const prices = priceCache[cur.form.solution] || [];
    gridHead(body, '견적 작성에서 이 모듈들이 기본으로 들어갑니다. 단가는 가격정책 품목의 기준단가를 씁니다.', () => {
      cur.items.push({ block_code: blockOpts[0]?.[0] || null, item_code: null, qty_default: 1, checked: false });
      paintTabs();
    }, () => cur.items);
    const tbody = gridTable(body, [
      { label: '블록', w: 170, req: true }, { label: '품목코드', w: 160 }, { label: '품목', w: 260, req: true },
      { label: '구축형태', w: 120 }, { label: '기준단가 (원)', w: 140 }, { label: '기본수량', w: 90 },
    ], 'quote2:tpl-items-cols');
    if (!cur.items.length) { tbody.appendChild(h('tr', {}, h('td', { colspan: 7, class: 'ss-cell--empty' }, '기본 모듈이 없습니다. 행추가로 넣으세요.'))); return; }
    for (const r of cur.items) {
      const p = prices.find((x) => x.code === r.item_code);
      // 가격정책에 없는 코드도 그대로 보여준다 (미등록)
      const opts = prices.map((x) => [x.code, `${x.name}${x.deployment !== cur.form.deployment ? ` · ${depName(x.deployment)}` : ''}`]);
      if (r.item_code && !p) opts.unshift([r.item_code, `${r.item_code} (가격정책 미등록)`]);
      const tr = h('tr', {});
      tr.append(
        checkCell(r),
        cellSelect('블록', r.block_code && !blockOpts.some(([v]) => v === r.block_code) ? [[r.block_code, `${r.block_code} (블록 꺼짐)`], ...blockOpts] : blockOpts,
          r.block_code, (v) => { r.block_code = v; }),
        h('td', { class: 'ss-cell--link' }, r.item_code || ''),
        cellSelect('품목', opts, r.item_code, (v) => { r.item_code = v; paintTabs(); }),
        h('td', {}, p ? depName(p.deployment) : ''),
        h('td', { style: 'text-align:right' }, p ? won(p.base_price) : ''),
        cellNum('기본수량', r.qty_default, (v) => { r.qty_default = v; }));
      tbody.appendChild(tr);
    }
  }

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
    const state = h('span', { style: 'margin-right:auto;font-size:12px;color:var(--text-3)' }, '그리는 중...');
    const printBtn = h('button', { class: 'btn', disabled: true, onclick: () => frame.contentWindow.print() }, '인쇄 · PDF 저장');
    const m = openModal({
      title: `견적서 미리보기 — ${f.name || '새 템플릿'}${f.code ? ` (${f.code})` : ''}`,
      body: frame,
      footer: [state, printBtn, h('button', { class: 'btn btn-primary', onclick: () => m.close() }, '닫기')],
    });
    const box = m.back.querySelector('.modal');
    box.style.width = '880px';
    box.querySelector('.modal-body').style.padding = '12px';
    try {
      const r = await api.previewQuote({
        blocks: previewBlocks(),
        header: { blank: true, template_code: f.code || null, condition_set: f.condition_set || null, pay_plan: f.has_pay_plan ? 1 : 0,
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
      blocks: blocksDef.filter((b) => cur.blocks.has(b.code)).map((b) => b.code),
      items: cur.items.map((r) => ({ block_code: r.block_code, item_code: r.item_code, qty_default: r.qty_default ?? 1 })),
      labor: cur.labor.map((r) => ({ block_code: r.block_code, role_code: r.role_code, role_label: trim(r.role_label),
        grade: r.grade || null, task: trim(r.task), mm_default: r.mm_default ?? 0 })),
    };
  }

  async function save() {
    const p = payload();
    if (!cur.isNew && JSON.stringify(p) === baseline) return toast('변경된 내용이 없습니다.', 'ok');
    if (!p.code || !p.name || !p.solution || !p.deployment) return toast('필수 항목을 확인하세요: 코드 · 템플릿명 · 솔루션 · 구축형태', 'err');
    if (templates.some((t) => t.code === p.code && t.id !== cur.id)) return toast(`이미 있는 코드입니다: ${p.code}`, 'err');
    if (!p.blocks.length) return toast('블록을 하나 이상 고르세요.', 'err');
    const badItem = p.items.findIndex((r) => !r.block_code || !r.item_code || !p.blocks.includes(r.block_code));
    if (badItem >= 0) { tab = 'items'; paintTabs(); return toast(`기본 모듈 ${badItem + 1}번째 행: 블록과 품목을 확인하세요 (켜진 블록만 쓸 수 있습니다).`, 'err'); }
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

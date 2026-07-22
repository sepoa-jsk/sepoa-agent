import { api } from '../api.js';
import { store } from '../app.js';
import { h, won, toast, loading, clear, openModal, confirmModal } from '../ui.js';

// ── 마스터 정의 ────────────────────────────────────────────────
// 영업팀(실무자) 기준 목록/모달. 개발용 컬럼(코드·솔루션 등)은 숨기고,
// 저장 시 코드에서 자동 채워 보낸다.
//
// 마스터 플래그
//   scoped : 상단 솔루션 필터로 조회 (modules 만)
//   inject : 저장 시 항상 넣어줄 고정 컬럼 (UI 엔 안 보임)
// 필드 타입: text | number | money | checkbox | solution | preset
//   preset : 미리 정의된 [코드, 이름] 목록에서 드롭다운 선택. 선택 시
//            코드 컬럼(key)과 이름 컬럼(labelField)을 함께 세팅한다.
//   list  = 목록 테이블 표시 컬럼 / fields = 추가·수정 모달 입력 필드
const CLASS_PRESET = [
  ['ENT', '대기업'], ['PUBLIC', '공공기관'], ['FINANCE', '금융'],
  ['MID', '중견기업'], ['SMALL', '중소기업'],
];
const ONSITE_PRESET = [['ONSITE', '상주'], ['REMOTE', '비상주']];
const NEGO_TARGETS = [['MODULE', '모듈(솔루션)'], ['LABOR', '인력']];

// SW협회 노임단가 → 기준단가 (lib/labor-standard.js 와 동일 로직).
function calcStandardRate(std) {
  const avgRaw = Number(std.daily_rate) * Number(std.work_days || 20.5);
  const overhead = avgRaw * Number(std.overhead_rate || 1.1);
  const tech = (avgRaw + overhead) * Number(std.tech_rate || 0.2);
  return Math.round(avgRaw + overhead + tech);
}

// 협회직군(standard_role_code) 목록 — 인력구분 매핑 preset·표시에 공용.
const STD_ROLES = [
  ['IT_PM', 'IT PM'], ['DEV', '응용소프트웨어 개발자'], ['UIUX', 'UI/UX 개발자'],
  ['ARCHITECT', 'IT 아키텍트'], ['QAO', 'IT 품질관리자'],
  ['CONSULTANT', 'IT 컨설턴트'], ['OPERATOR', '정보시스템 운용자'],
];
const STD_ROLE_NAME = Object.fromEntries(STD_ROLES);

const MASTERS = [
  {
    type: 'solutions', label: '솔루션', pk: 'code', scoped: false,
    list: ['code', 'name'],
    fields: [
      { key: 'code', label: '코드', type: 'text', pk: true, mono: true },
      { key: 'name', label: '이름', type: 'text' },
    ],
  },
  {
    type: 'deployments', label: '구축형태', pk: 'code', scoped: false,
    list: ['name'],
    fields: [
      { key: 'code', label: '코드', type: 'text', pk: true, mono: true },
      { key: 'name', label: '이름', type: 'text' },
    ],
  },
  {
    // 기업구분: 5종 고정. 드롭다운으로 고르면 key/label 이 함께 정해진다.
    // solution/deployment 는 저장 시 PROCURE/ONPREM 자동 주입(화면 노출 안 함).
    type: 'company_classes', label: '기업구분', pk: 'id', scoped: false,
    inject: { solution: 'PROCURE', deployment: 'ONPREM' },
    list: ['label', 'revenue_cond', 'active'],
    fields: [
      { key: 'key', label: '기업구분', type: 'preset', labelField: 'label', required: true, unique: true, options: CLASS_PRESET },
      { key: 'revenue_cond', label: '매출조건', type: 'text', full: true },
      { key: 'active', label: '사용', type: 'checkbox' },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
  {
    // 상주여부: 2종 고정. 드롭다운으로 상주/비상주 선택 → code/name 세팅.
    type: 'onsite_types', label: '상주여부', pk: 'code', scoped: false,
    list: ['name', 'sort'],
    fields: [
      { key: 'code', label: '상주여부', type: 'preset', labelField: 'name', required: true, unique: true, options: ONSITE_PRESET },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
  {
    type: 'service_types', label: '서비스구분', pk: 'id', scoped: true,
    // 목록은 코드 | 이름 | 비고 | 사용 만. User단위·최소가격은 모달(fields)에서만 편집.
    list: ['code', 'name', 'note', 'active'],
    fields: [
      { key: 'solution', label: '솔루션', type: 'solution' },
      { key: 'code', label: '코드', type: 'text', mono: true },
      { key: 'name', label: '이름', type: 'text' },
      { key: 'user_unit', label: 'User단위', type: 'text' },
      { key: 'min_price', label: '최소가격', type: 'money' },
      { key: 'note', label: '비고', type: 'text', full: true },
      { key: 'active', label: '사용', type: 'checkbox' },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
  {
    type: 'modules', label: '모듈', pk: 'id', scoped: true,
    list: ['code', 'name', 'base_price', 'required', 'active'],
    fields: [
      { key: 'solution', label: '솔루션', type: 'solution' },
      { key: 'code', label: '코드', type: 'text', mono: true },
      { key: 'name', label: '이름', type: 'text' },
      { key: 'base_price', label: '기준단가', type: 'money' },
      { key: 'required', label: '필수', type: 'checkbox' },
      { key: 'note', label: '비고', type: 'text', full: true },
      { key: 'active', label: '사용', type: 'checkbox' },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
  {
    // 인력구분: "직군 정보"만. 표준단가(base_price)는 마스터에서 제외 →
    // fields/list 에 없으므로 payload 에도 안 들어감(수정 시 기존 단가 유지).
    // 단가는 가격정책 화면에서 관리.
    // 인력구분은 전 솔루션 공통 → 솔루션 필터/필드 없음. solution 컬럼은 NOT NULL
    // 이므로 신규 저장 시 'PROCURE' 자동 주입, 수정 시엔 기존 solution 값 유지.
    type: 'labor_roles', label: '인력구분', pk: 'id', scoped: false,
    injectOnCreate: { solution: 'PROCURE' },
    // 목록: 직무명 | 협회직군 | 필수 | 비고.
    list: ['name', ['standard_role_code', '협회직군', (v) => (STD_ROLE_NAME[v] || v || '-')], ['required', '필수'], 'note'],
    // 매핑된 협회직군의 최신연도 기준단가를 모달에 참고 표시.
    preview: (form, ctx) => {
      if (!form.standard_role_code) return '협회직군 미매핑 (기준단가 자동연동 없음)';
      const y = ctx && ctx.stdLatestYear;
      const std = y && ctx.stdIndex[y + ':' + form.standard_role_code];
      if (!std) return `${STD_ROLE_NAME[form.standard_role_code] || form.standard_role_code} · ${y || ''}년 협회단가 없음`;
      return `${y}년 기준단가: ${won(calcStandardRate(std))} (협회단가 ${won(std.daily_rate)}/M-D)`;
    },
    fields: [
      { key: 'code', label: '코드', type: 'text', mono: true },
      { key: 'name', label: '직군명', type: 'text' },
      { key: 'standard_role_code', label: '협회직군 (노임단가 연동)', type: 'preset', options: STD_ROLES },
      { key: 'std_mm', label: '표준 M/M', type: 'number' },
      { key: 'required', label: '필수여부', type: 'checkbox' },
      { key: 'note', label: '비고', type: 'text', full: true },
      { key: 'active', label: '사용', type: 'checkbox' },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
  {
    // 네고율: 전 솔루션 공통. 전용 매트릭스 렌더(custom='nego') — 솔루션 셀렉트 없음,
    // [상주]/[비상주] 서브탭 + target(행) × 기업구분(열) 매트릭스.
    type: 'nego_rates', label: '네고율', pk: 'id', scoped: false, custom: 'nego',
    list: [], fields: [],
  },
  {
    // 유지보수 설정: 계산방식(RATE/MM)에 따라 요율 또는 단가+공수를 관리.
    type: 'maintenance', label: '유지보수', pk: 'id', scoped: false,
    // 목록: 이름 | 계산방식 | 요율/단가 | 무상개월 | 사용
    list: [
      'name',
      ['calc_type', '계산방식', (v) => (v === 'RATE' ? '요율' : 'M/D 단가')],
      ['rate', '요율/단가', (v, row) => (row.calc_type === 'RATE'
        ? (Number(row.rate) * 100).toFixed(0) + '%'
        : `${won(row.md_price)} /M-D (1M/M=${row.md_per_mm}일)`)],
      ['free_months', '무상개월', (v) => (v != null ? v + '개월' : '-')],
      'active',
    ],
    // 계산방식(preset)에 따라 요율(RATE) / 단가+환산일(MD) 필드가 분기된다.
    fields: [
      { key: 'code', label: '코드', type: 'text', mono: true },
      { key: 'name', label: '이름', type: 'text' },
      { key: 'calc_type', label: '계산방식', type: 'preset', required: true, rerenders: true, options: [['RATE', '요율(공급가×율)'], ['MD', 'M/D 단가(공수×단가)']] },
      { key: 'rate', label: '요율 (%)', type: 'percent', step: '0.1', showIf: (fm) => fm.calc_type === 'RATE' },
      { key: 'md_price', label: 'M/D 단가 (원)', type: 'money', showIf: (fm) => fm.calc_type === 'MD' },
      { key: 'md_per_mm', label: 'M/M 환산일 (예: 20)', type: 'number', showIf: (fm) => fm.calc_type === 'MD' },
      { key: 'free_months', label: '무상개월', type: 'number' },
      { key: 'tco_years', label: 'TCO 년수', type: 'number' },
      { key: 'note', label: '비고', type: 'text', full: true },
      { key: 'active', label: '사용', type: 'checkbox' },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
  {
    // 협회노임단가: 연도별. 노임단가(M/D)만 넣으면 기준단가 자동 계산(읽기전용).
    type: 'labor_standards', label: '협회노임단가', pk: 'id', scoped: false, filterYear: true,
    preview: (form) => '기준단가 미리보기: ' + won(calcStandardRate(form)),
    list: [
      ['year', '연도', (v) => v + '년'],
      ['role_name', '직군'],
      ['daily_rate', '노임단가(M/D)', (v) => won(v)],
      ['daily_rate', '기준단가', (v, row) => won(calcStandardRate(row))],
      ['work_days', '근무일', (v) => v + '일'],
    ],
    fields: [
      { key: 'year', label: '연도', type: 'number' },
      { key: 'role_code', label: '직군코드', type: 'text', mono: true },
      { key: 'role_name', label: '직군명', type: 'text' },
      { key: 'daily_rate', label: '노임단가 (M/D, 원)', type: 'money' },
      { key: 'work_days', label: '근무일 (M/M 환산)', type: 'number', step: '0.1', default: 20.5 },
      { key: 'overhead_rate', label: '제경비율 (기본 1.1)', type: 'number', step: '0.001', default: 1.1 },
      { key: 'tech_rate', label: '기술료율 (기본 0.2)', type: 'number', step: '0.001', default: 0.2 },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
];

const S = {
  tabActive: 'padding:7px 16px;border-radius:999px;border:1px solid #0747A6;background:#0747A6;color:#fff;font-weight:600;font-size:13px;cursor:pointer',
  tabIdle: 'padding:7px 16px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--text-sub);font-weight:600;font-size:13px;cursor:pointer',
  ctxBar: 'display:flex;align-items:center;gap:10px;padding:12px 14px;margin-bottom:14px;background:var(--panel);border:0.5px solid var(--line);border-radius:var(--radius)',
  mono: 'font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--accent);font-weight:600',
  linkBtn: 'background:none;border:none;color:var(--accent);cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px',
  linkDanger: 'background:none;border:none;color:var(--red);cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px',
  thead: 'background:var(--bg)',
  check: 'color:#0747A6;font-weight:700',
  uncheck: 'color:#ccc',
};

export async function renderMaster(root) {
  const master = await store.getMaster();
  const solutions = master.solutions || [];
  const solName = (c) => solutions.find((s) => s.code === c)?.name || c || '-';

  const defaultSolution = solutions.find((s) => s.code === 'PROCURE')?.code || solutions[0]?.code || '';
  const state = { type: MASTERS[0].type, solution: defaultSolution, year: null };
  let currentRows = []; // 현재 탭에 로드된 행 (preset 중복 제외에 사용)

  // 협회노임단가 인덱스(인력구분 모달의 기준단가 미리보기용). 실패해도 무시.
  const previewCtx = { stdIndex: {}, stdLatestYear: null };
  try {
    const { rows } = await api.masterList('labor_standards');
    const years = [...new Set((rows || []).map((r) => Number(r.year)))].sort((a, b) => b - a);
    previewCtx.stdLatestYear = years[0] || null;
    (rows || []).forEach((r) => { previewCtx.stdIndex[r.year + ':' + r.role_code] = r; });
  } catch { /* labor_standards 라우트 미반영 등 → 미리보기 생략 */ }

  const current = () => MASTERS.find((m) => m.type === state.type);
  const numType = (f) => f.type === 'money' || f.type === 'number';
  const colClass = (f) => (numType(f) ? 'num' : f.type === 'checkbox' ? 'center' : '');
  // list 항목은 'key' | ['key','헤더'] | ['key','헤더', 포맷함수(v,row)] 를 허용한다.
  const listKey = (it) => (Array.isArray(it) ? it[0] : it);
  const listHeader = (it, fm) => (Array.isArray(it) ? it[1] : fm[listKey(it)].label);
  const listFmt = (it) => (Array.isArray(it) && typeof it[2] === 'function' ? it[2] : null);

  // 목록/헤더용 필드 맵. preset 의 labelField(이름 컬럼)도 표시용으로 등록한다.
  function fmap(m) {
    const map = Object.fromEntries(m.fields.map((f) => [f.key, f]));
    m.fields.forEach((f) => {
      if (f.type === 'preset' && f.labelField && !map[f.labelField]) {
        map[f.labelField] = { key: f.labelField, label: '이름', type: 'text' };
      }
    });
    return map;
  }

  // ── 헤더 (추가 버튼은 목록 하단) ──
  root.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'page-title' }, '마스터 관리'),
      h('div', { class: 'page-sub' }, '견적의 기준정보를 관리합니다. 단가는 가격정책 관리에서 설정합니다.')
    )
  ));

  // ── 탭 바 ──
  const tabbar = h('div', { style: 'display:flex;align-items:center;gap:8px;margin:4px 0 14px;flex-wrap:wrap' });
  tabbar.appendChild(h('span', { style: 'font-size:12px;color:var(--muted);font-weight:700;margin-right:2px' }, '기준정보'));
  MASTERS.forEach((m) => tabbar.appendChild(h('button', {
    dataset: { tab: m.type },
    style: m.type === state.type ? S.tabActive : S.tabIdle,
    onclick: () => { state.type = m.type; refresh(); },
  }, m.label)));
  root.appendChild(tabbar);

  // ── 컨텍스트 바 (모듈 탭에서만 솔루션 셀렉트) ──
  const ctxWrap = h('div', {});
  root.appendChild(ctxWrap);

  // ── 테이블 + 하단 추가 버튼 ──
  const thead = h('thead');
  const tbody = h('tbody');
  const tablePanel = h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
    h('table', { class: 'grid master-grid' }, thead, tbody)));
  const addBtn = h('button', { class: 'add-section', style: 'margin-top:12px', onclick: () => editRow(null) }, '＋ 새 항목 추가');
  const customWrap = h('div', { style: 'display:none' }); // 네고율 매트릭스 등 전용 렌더 영역
  root.appendChild(tablePanel);
  root.appendChild(addBtn);
  root.appendChild(customWrap);
  let negoOnsite = 'ONSITE'; // 네고율 서브탭 상태 (상주/비상주)

  function syncTabs() {
    tabbar.querySelectorAll('button').forEach((b) => {
      b.setAttribute('style', b.dataset.tab === state.type ? S.tabActive : S.tabIdle);
    });
  }

  function buildContextBar() {
    clear(ctxWrap);
    if (!current().scoped) return;
    const sel = h('select', { class: 'select', onchange: () => { state.solution = sel.value; load(); } },
      ...solutions.map((s) => h('option', { value: s.code, selected: s.code === state.solution }, s.name || s.code)));
    ctxWrap.appendChild(h('div', { style: S.ctxBar },
      h('span', { style: 'font-size:12.5px;color:var(--text-sub);font-weight:700' }, '솔루션'), sel));
  }

  // 연도 필터 셀렉트(협회노임단가 등 filterYear 마스터). 데이터에서 연도를 뽑아 구성.
  function buildYearFilter(years) {
    clear(ctxWrap);
    const sel = h('select', { class: 'select', onchange: () => { state.year = Number(sel.value); load(); } },
      ...years.map((y) => h('option', { value: y, selected: y === state.year }, y + '년')));
    ctxWrap.appendChild(h('div', { style: S.ctxBar },
      h('span', { style: 'font-size:12.5px;color:var(--text-sub);font-weight:700' }, '연도'), sel));
  }

  function buildHead() {
    const fm = fmap(current());
    clear(thead).appendChild(h('tr', { style: S.thead },
      ...current().list.map((it) => h('th', { class: colClass(fm[listKey(it)]) }, listHeader(it, fm))),
      h('th', { style: 'text-align:right' }, '관리')
    ));
  }

  function refresh() {
    syncTabs();
    const m = current();
    if (m.custom === 'nego') {
      // 전용 매트릭스: 솔루션 셀렉트·일반 테이블·추가 버튼 숨김.
      clear(ctxWrap);
      tablePanel.style.display = 'none';
      addBtn.style.display = 'none';
      customWrap.style.display = 'block';
      renderNegoMatrix();
      return;
    }
    tablePanel.style.display = '';
    addBtn.style.display = '';
    customWrap.style.display = 'none';
    buildContextBar(); buildHead(); load();
  }

  // ── 네고율 전용 매트릭스 (전 솔루션 공통) ──
  const targetLabel = (t) => (t === 'MODULE' ? '모듈(솔루션)' : '인력');
  const companyLabel = (k) => (CLASS_PRESET.find(([v]) => v === k) || [])[1] || k;
  const onsiteLabel = (k) => (k === 'ONSITE' ? '상주' : '비상주');

  async function renderNegoMatrix() {
    clear(customWrap).appendChild(loading());
    let rows;
    try { ({ rows } = await api.masterList('nego_rates')); } // solution 인자 없음
    catch (err) { clear(customWrap).appendChild(h('div', { class: 'empty' }, err.message)); return; }
    clear(customWrap);

    // 상주/비상주 서브탭
    const subtabs = h('div', { style: 'display:flex;gap:8px;margin:4px 0 10px' });
    ONSITE_PRESET.forEach(([code, label]) => subtabs.appendChild(h('button', {
      style: code === negoOnsite ? S.tabActive : S.tabIdle,
      onclick: () => { negoOnsite = code; renderNegoMatrix(); },
    }, label)));
    customWrap.appendChild(subtabs);
    customWrap.appendChild(h('div', { class: 'page-sub', style: 'margin-bottom:10px' },
      '셀을 클릭하면 네고율을 수정합니다. (솔루션과 무관하게 전 솔루션 공통 적용)'));

    const find = (target, ck) => rows.find((r) => r.target === target && r.company_key === ck && r.onsite_key === negoOnsite);
    const thead2 = h('thead', {}, h('tr', { style: S.thead },
      h('th', {}, '구분'),
      ...CLASS_PRESET.map(([, name]) => h('th', { class: 'num' }, name))
    ));
    const tbody2 = h('tbody');
    NEGO_TARGETS.forEach(([target, tlabel]) => {
      tbody2.appendChild(h('tr', {},
        h('td', { style: 'font-weight:600' }, tlabel),
        ...CLASS_PRESET.map(([ck]) => {
          const row = find(target, ck);
          const pct = row ? (Number(row.rate) * 100).toFixed(0) + '%' : '-';
          return h('td', {
            class: 'num',
            style: row ? 'cursor:pointer;color:var(--accent);font-weight:600' : 'color:#ccc',
            onclick: row ? () => editRate(row) : null,
          }, pct);
        })
      ));
    });
    customWrap.appendChild(h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
      h('table', { class: 'grid master-grid' }, thead2, tbody2))));
  }

  function editRate(row) {
    const inp = h('input', { class: 'input', type: 'number', step: '0.01', value: row.rate });
    const saveBtn = h('button', { class: 'btn btn-primary' }, '저장');
    const modal = openModal({
      title: `네고율 수정 — ${targetLabel(row.target)} / ${companyLabel(row.company_key)} / ${onsiteLabel(row.onsite_key)}`,
      body: h('div', {}, h('div', { class: 'field' },
        h('label', {}, '네고율 (예: 0.6 = 60%)'), inp)),
      footer: [h('button', { class: 'btn', onclick: () => modal.close() }, '취소'), saveBtn],
    });
    saveBtn.onclick = async () => {
      const rate = Number(inp.value);
      if (!(rate >= 0)) return toast('네고율을 입력하세요.', 'err');
      saveBtn.disabled = true;
      try {
        await api.masterUpdate('nego_rates', row.id, { rate }); // rate 만 수정
        toast('저장되었습니다.', 'ok');
        modal.close();
        renderNegoMatrix();
      } catch (err) { toast(err.message, 'err'); saveBtn.disabled = false; }
    };
  }

  function cellNode(f, v) {
    if (f.mono) return h('span', { style: S.mono }, v == null || v === '' ? '-' : String(v));
    if (f.type === 'money') return won(v);
    if (f.type === 'checkbox') return v ? h('span', { style: S.check }, '✓') : h('span', { style: S.uncheck }, '–');
    if (f.type === 'solution') return solName(v);
    return v == null || v === '' ? '-' : String(v);
  }

  async function load() {
    const m = current();
    const fm = fmap(m);
    const hasActive = m.fields.some((f) => f.key === 'active');
    const colspan = m.list.length + 1;
    clear(tbody).appendChild(h('tr', {}, h('td', { colspan }, loading())));
    try {
      const { rows } = await api.masterList(m.type, m.scoped ? state.solution : undefined);
      let list = rows || [];
      if (m.filterYear) {
        const years = [...new Set(list.map((r) => Number(r.year)))].sort((a, b) => b - a);
        if (state.year == null || !years.includes(state.year)) state.year = years[0] ?? null;
        buildYearFilter(years);
        list = list.filter((r) => Number(r.year) === state.year);
      }
      currentRows = list;
      clear(tbody);
      if (currentRows.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan }, h('div', { class: 'empty' }, '데이터가 없습니다.'))));
        return;
      }
      const delLabel = hasActive ? '중지' : '삭제'; // active 있으면 서버가 소프트 삭제
      for (const row of currentRows) {
        const dim = hasActive && !row.active;
        tbody.appendChild(h('tr', { style: dim ? 'opacity:.5' : null },
          ...m.list.map((it) => {
            const k = listKey(it); const fmt = listFmt(it);
            return h('td', { class: colClass(fm[k]) }, fmt ? fmt(row[k], row) : cellNode(fm[k], row[k]));
          }),
          h('td', { style: 'text-align:right' },
            h('button', { style: S.linkBtn, onclick: () => editRow(row) }, '수정'),
            h('button', { style: S.linkDanger, onclick: () => delRow(row) }, delLabel)
          )
        ));
      }
    } catch (err) {
      clear(tbody).appendChild(h('tr', {}, h('td', { colspan }, h('div', { class: 'empty' }, err.message))));
    }
  }

  async function delRow(row) {
    const m = current();
    const soft = m.fields.some((f) => f.key === 'active');
    const idVal = row[m.pk];
    const name = row.name || row.label || row['key'] || row.code || idVal;
    const ok = await confirmModal({
      title: soft ? '사용 중지' : '삭제',
      message: soft
        ? `'${name}' 항목을 사용 중지하시겠습니까? (목록엔 남고 '중지' 상태가 됩니다)`
        : `'${name}' 항목을 삭제하시겠습니까?`,
      okLabel: soft ? '중지' : '삭제', danger: true,
    });
    if (!ok) return;
    try {
      await api.masterDelete(m.type, idVal);
      toast(soft ? '사용 중지되었습니다.' : '삭제되었습니다.', 'ok');
      load();
    } catch (err) { toast(err.message, 'err'); }
  }

  // ── 추가/수정 모달 ──
  function defaultFor(f) {
    if (f.default != null) return f.default;
    if (numType(f)) return 0;
    if (f.type === 'checkbox') return f.key === 'active' ? 1 : 0;
    if (f.type === 'solution') return state.solution || solutions[0]?.code || '';
    return ''; // text / preset
  }

  function buildInput(f, form, isNew, onChange) {
    const fire = () => { if (onChange) onChange(); };
    const set = (v) => { form[f.key] = v; fire(); };
    if (f.type === 'preset') {
      // unique(정체성 코드)인 경우에만 신규 추가 시 이미 존재하는 값을 제외(중복 방지).
      const existing = f.unique ? new Set(currentRows.map((r) => r[f.key])) : null;
      const avail = f.options.filter(([val]) => (isNew && existing ? !existing.has(val) : true));
      const setPreset = (val) => {
        form[f.key] = val;
        if (f.labelField) {
          const opt = f.options.find(([v]) => v === val);
          form[f.labelField] = opt ? opt[1] : '';
        }
        fire();
      };
      return h('select', { class: 'select', onchange: (e) => setPreset(e.target.value) },
        isNew ? h('option', { value: '', selected: !form[f.key] }, '선택하세요') : null,
        ...avail.map(([val, txt]) => h('option', { value: val, selected: val === form[f.key] }, txt)));
    }
    if (f.type === 'solution') {
      return h('select', { class: 'select', onchange: (e) => set(e.target.value) },
        ...solutions.map((s) => h('option', { value: s.code, selected: s.code === form[f.key] }, `${s.name || s.code} (${s.code})`)));
    }
    if (f.type === 'checkbox') {
      const cb = h('input', { type: 'checkbox', checked: !!form[f.key], onchange: (e) => set(e.target.checked ? 1 : 0) });
      return h('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, cb,
        h('span', {}, f.key === 'active' ? '사용 (체크 해제 시 중지)' : '적용'));
    }
    if (f.type === 'percent') {
      // 화면엔 % 로 입력받고 저장은 소수(0.xx)로. 예: 15 입력 → 0.15 저장.
      const disp = (form[f.key] == null || form[f.key] === '') ? '' : Number(form[f.key]) * 100;
      return h('input', {
        class: 'input', type: 'number', step: f.step || '0.1', value: disp,
        oninput: (e) => { const t = e.target.value; form[f.key] = (t === '' ? null : Number(t) / 100); fire(); },
      });
    }
    const attrs = {
      class: 'input',
      type: numType(f) ? 'number' : 'text',
      value: form[f.key] ?? '',
      oninput: (e) => set(e.target.value),
    };
    if (numType(f)) attrs.step = f.step || 'any';
    if (f.pk && !isNew) attrs.disabled = true;
    return h('input', attrs);
  }

  function fld(f, input) {
    const hint = f.type === 'money' ? ' (원)' : f.pk ? ' (수정 불가)' : '';
    return h('div', { class: f.full ? 'field full' : 'field' },
      h('label', {}, f.label + hint), input);
  }

  function editRow(row) {
    const m = current();
    const isNew = !row;
    const form = {};
    m.fields.forEach((f) => {
      form[f.key] = row ? (f.type === 'checkbox' ? (row[f.key] ? 1 : 0) : row[f.key]) : defaultFor(f);
      if (f.type === 'preset' && f.labelField) form[f.labelField] = row ? row[f.labelField] : ''; // 이름 컬럼 동기화
    });
    if (isNew && m.scoped) {
      const sf = m.fields.find((f) => f.type === 'solution');
      if (sf) form[sf.key] = state.solution;
    }
    if (isNew && m.filterYear && state.year != null) form.year = state.year; // 현재 연도 필터값으로

    // 실시간 미리보기(예: 협회노임단가 → 기준단가)
    let previewEl = null;
    const refreshPreview = m.preview
      ? () => { previewEl.textContent = m.preview(form, previewCtx); }
      : null;
    if (m.preview) previewEl = h('div', { style: 'margin-top:12px;padding:10px 12px;background:var(--primary-weak);border-radius:8px;font-weight:700;color:var(--accent);text-align:right' });

    // showIf 로 조건부 노출. rerenders 필드(예: calc_type) 변경 시 폼을 다시 그린다.
    const gridEl = h('div', { class: 'form-grid' });
    function renderFields() {
      clear(gridEl);
      m.fields.filter((f) => !f.showIf || f.showIf(form)).forEach((f) => {
        const onChange = () => {
          if (refreshPreview) refreshPreview();
          if (f.rerenders) renderFields();
        };
        gridEl.appendChild(fld(f, buildInput(f, form, isNew, onChange)));
      });
    }
    renderFields();
    const body = h('div', {}, gridEl, previewEl);
    if (refreshPreview) refreshPreview();

    const saveBtn = h('button', { class: 'btn btn-primary' }, isNew ? '추가' : '저장');
    const modal = openModal({
      title: `${m.label} ${isNew ? '추가' : '수정'}`,
      body,
      footer: [h('button', { class: 'btn', onclick: () => modal.close() }, '취소'), saveBtn],
    });

    saveBtn.onclick = async () => {
      const payload = {};
      let missing = null;
      // 조건부(showIf) 로 숨겨진 필드는 저장하지 않는다(엉뚱한 기본값 방지).
      m.fields.filter((f) => !f.showIf || f.showIf(form)).forEach((f) => {
        if (f.type === 'preset') {
          const v = form[f.key];
          if (f.required && (v === '' || v == null)) missing = missing || f.label;
          payload[f.key] = v;                        // 코드(key/code/target 등)
          if (f.labelField) payload[f.labelField] = form[f.labelField]; // 이름 컬럼 동시 세팅
          return;
        }
        let v = form[f.key];
        if (numType(f)) v = (v === '' || v == null) ? null : Number(v);
        else if (f.type === 'checkbox') v = v ? 1 : 0;
        if (f.required && (v === '' || v == null)) missing = missing || f.label;
        payload[f.key] = v;
      });
      if (missing) return toast(`필수 항목을 확인하세요: ${missing}`, 'err');
      if (m.inject) Object.assign(payload, m.inject); // solution/deployment 자동 주입(항상)
      if (isNew && m.injectOnCreate) Object.assign(payload, m.injectOnCreate); // 신규 시에만(수정 땐 기존값 유지)

      saveBtn.disabled = true;
      try {
        if (isNew) await api.masterCreate(m.type, payload);
        else await api.masterUpdate(m.type, row[m.pk], payload);
        toast('저장되었습니다.', 'ok');
        modal.close();
        load();
      } catch (err) { toast(err.message, 'err'); saveBtn.disabled = false; }
    };
  }

  refresh();
}

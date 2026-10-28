import { api } from '../api.js';
import { store } from '../app.js';
import { h, won, toast, clear, confirmModal, resizableColumns } from '../ui.js';

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
const NEGO_TARGETS = [['MODULE', '솔루션'], ['LABOR', '인건비']]; // 네고율 상단 선택 상자

// 숫자 칸 — 보일 때는 정수부에 3자리 콤마, 누르면(포커스) 콤마 없는 값으로 고친다.
// 소수부는 입력·저장된 그대로 둔다(0.20 → 0.20). 숫자 · 점 · 빼기 외의 글자는 받지 않는다.
const comma = (v) => {
  if (v == null || v === '') return '';
  const m = String(v).match(/^(-?)(\d+)(.*)$/);
  return m ? m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + m[3] : String(v);
};
// plain 이면(연도 등) 콤마를 넣지 않는다
function numInput(raw, onRaw, attrs, plain = false) {
  let cur = raw == null ? '' : String(raw);
  const show = (v) => (plain ? v : comma(v));
  return h('input', {
    ...attrs, type: 'text', inputMode: 'decimal', value: show(cur),
    onfocus: (e) => { if (!e.target.readOnly) e.target.value = cur; },
    onblur: (e) => { e.target.value = show(cur); },
    oninput: (e) => {
      const t = e.target.value.replace(/[^\d.-]/g, '');
      if (t !== e.target.value) e.target.value = t;
      cur = t;
      onRaw(t);
    },
  });
}

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
    list: ['code', 'name', 'sort'],
    fields: [
      { key: 'code', label: '코드', type: 'text', pk: true, mono: true, required: true, unique: true },
      { key: 'name', label: '이름', type: 'text' },
      { key: 'sort', label: '정렬', type: 'number' }, // V2 에서 추가
    ],
  },
  {
    type: 'deployments', label: '구축형태', pk: 'code', scoped: false,
    list: ['code', 'name', 'sort'],
    fields: [
      { key: 'code', label: '코드', type: 'text', pk: true, mono: true, required: true, unique: true },
      { key: 'name', label: '이름', type: 'text' },
      { key: 'sort', label: '정렬', type: 'number' }, // V2 에서 추가
    ],
  },
  {
    // 기업구분: 코드 · 이름 · 조건 · 정렬을 직접 입력한다. 사용은 그리드에 보이지 않는다(hidden) —
    // 새 행은 사용=1, 정렬=끝 번호로 저장되고, 행삭제하면 사용 중지(숨김)된다.
    // 코드는 저장된 뒤에도 고칠 수 있다(사용자 지정). 단 네고율·견적은 옛 코드를 그대로 갖고 있어
    // 코드를 바꾸면 그쪽 연결은 따라오지 않는다.
    // solution/deployment 는 저장 시 PROCURE/ONPREM 자동 주입(화면 노출 안 함).
    type: 'company_classes', label: '기업구분', pk: 'id', scoped: false,
    inject: { solution: 'PROCURE', deployment: 'ONPREM' },
    hidden: ['active'],
    list: ['key', 'label', 'revenue_cond'],
    fields: [
      { key: 'key', label: '코드', type: 'text', mono: true, required: true, unique: true },
      { key: 'label', label: '이름', type: 'text', required: true },
      { key: 'revenue_cond', label: '조건', type: 'text', full: true },
      { key: 'active', label: '사용', type: 'checkbox' },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
  {
    // 상주여부: 다른 마스터처럼 코드 · 이름을 직접 입력한다 (코드는 PK — 바꾸면 서버가 PK 도 바꾼다. 네고율의 옛 코드는 따라오지 않는다).
    // 네고율 표의 상주/비상주 탭은 ONSITE_PRESET(ONSITE/REMOTE) 코드를 쓴다.
    type: 'onsite_types', label: '상주여부', pk: 'code', scoped: false,
    list: ['code', 'name', 'sort'],
    fields: [
      { key: 'code', label: '코드', type: 'text', pk: true, mono: true, required: true, unique: true },
      { key: 'name', label: '이름', type: 'text', required: true },
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
    // 표준 M/M 은 그리드에 보이지 않는다(사용자 지정) — 기존 값은 그대로 저장된다.
    // 기준단가(참고) 칸도 뺐다(사용자 지정).
    hidden: ['std_mm'],
    fields: [
      { key: 'code', label: '코드', type: 'text', mono: true },
      { key: 'name', label: '이름', type: 'text' },
      { key: 'standard_role_code', label: '협회직군 (노임단가 연동)', type: 'preset', options: STD_ROLES },
      { key: 'std_mm', label: '표준 M/M', type: 'number' },
      { key: 'required', label: '필수여부', type: 'checkbox' },
      { key: 'note', label: '비고', type: 'text', full: true },
      { key: 'active', label: '사용', type: 'checkbox' },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
  {
    // 네고율: 전 솔루션 공통. 상단 선택 상자로 솔루션(MODULE) / 인건비(LABOR) 를 고르고(filterTarget),
    // 한 줄 = 상주구분 · 기업구분 · 네고율 · 정렬 (사용자 지정). 새 행은 고른 구분으로 저장된다.
    // 고른 구분 안에서 상주구분 · 기업구분 조합은 겹칠 수 없다(uniqueCombo).
    // 기업구분 선택지는 기업구분 마스터의 사용 중인 행. 행삭제는 실제 삭제(사용 컬럼 없음).
    type: 'nego_rates', label: '네고율', pk: 'id', scoped: false,
    filterTarget: NEGO_TARGETS,
    uniqueCombo: ['onsite_key', 'company_key'],
    list: ['onsite_key', 'company_key', 'rate', 'sort'],
    fields: [
      // 코드 칸(codeview)은 옆 선택 칸에서 고른 코드를 글자로 보여주기만 한다 — 저장 대상 아님 (사용자 지정)
      { key: '_onsite_code', label: '상주코드', type: 'codeview', of: 'onsite_key' },
      { key: 'onsite_key', label: '상주구분', type: 'preset', required: true, options: ONSITE_PRESET, rerenders: true },
      { key: '_company_code', label: '기업구분코드', type: 'codeview', of: 'company_key' },
      { key: 'company_key', label: '기업구분', type: 'preset', required: true, options: 'company', rerenders: true },
      { key: 'rate', label: '네고율 (%)', type: 'percent', required: true },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
  {
    // 유지보수 설정: 계산방식(RATE/MM)에 따라 요율 또는 단가+공수를 관리.
    type: 'maintenance', label: '유지보수', pk: 'id', scoped: false,
    // M/M 환산일 · TCO 년수는 그리드에 보이지 않는다(사용자 지정) — 기존 값은 그대로 저장된다
    hidden: ['md_per_mm', 'tco_years'],
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
      // 코드 · 이름을 맨 앞에 (다른 마스터와 같게). 연도는 그 뒤 — 위 연도 선택값이 새 행에 들어간다
      { key: 'role_code', label: '코드', type: 'text', mono: true },
      { key: 'role_name', label: '이름', type: 'text' },
      { key: 'year', label: '연도', type: 'number', plain: true },
      { key: 'daily_rate', label: '노임단가 (M/D, 원)', type: 'money' },
      { key: 'work_days', label: '근무일 (M/M 환산)', type: 'number', step: '0.1', default: 20.5 },
      { key: 'overhead_rate', label: '제경비율 (기본 1.1)', type: 'number', step: '0.001', default: 1.1 },
      { key: 'tech_rate', label: '기술료율 (기본 0.2)', type: 'number', step: '0.001', default: 0.2 },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
];

// ── 화면 배치 — SingleSuite M1 d형(코드 목록 레일) + 편집 그리드 ──
//   레일: 머리 = 화면 제목 · 마스터 10종(이름 / 건수). 고른 항목은 회색 배경 + 오른쪽 빨간 막대
//   본문: 제목 줄(고른 마스터) → 머리 폼(솔루션·연도) | 행추가 · 행삭제 · 저장 → 편집 그리드 (건수 줄 없음)
//   등록·수정·삭제는 팝업 없이 그리드에서 하고, 저장 한 번에 서버로 보낸다
//   네고율만 탭 상자(상주/비상주) + 대상 × 기업구분 행렬, 칸에 바로 입력

const icon = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

export async function renderMaster(root) {
  const master = await store.getMaster();
  const solutions = master.solutions || [];

  const defaultSolution = solutions.find((s) => s.code === 'PROCURE')?.code || solutions[0]?.code || '';
  const state = { type: MASTERS[0].type, solution: defaultSolution, year: null, target: NEGO_TARGETS[0][0] };
  let rows = [];     // [{ orig, form, isNew, checked }] — 지금 그리드에 있는 행
  let deleted = [];  // 행삭제한 기존 행 (저장할 때 서버에서 지운다)
  let companyOpts = CLASS_PRESET; // 네고율의 기업구분 선택지 — 기업구분 마스터의 사용 중인 행으로 채운다
  const optionsOf = (f) => (f.options === 'company' ? companyOpts : f.options);

  const current = () => MASTERS.find((m) => m.type === state.type);
  const numType = (f) => f.type === 'money' || f.type === 'number' || f.type === 'percent';
  // 솔루션은 머리 폼에서 고르므로, hidden 은 마스터가 숨기기로 한 칸이므로 그리드에서 뺀다
  const gridFields = (m) => m.fields.filter((f) => f.type !== 'solution' && !(m.hidden || []).includes(f.key));
  const visible = (f, form) => !f.showIf || f.showIf(form);
  const hasActive = (m) => m.fields.some((f) => f.key === 'active');
  const isDirty = () => deleted.length > 0 || rows.some((r) => r.isNew || changed(r));

  // ── 셸: 화면 제목은 레일 머리가 맡는다 (셸 제목 바는 이 화면에서만 숨김) ──
  document.querySelector('.ss-app')?.classList.add('ss-app--railtitle');

  // ── 레일 ──
  const railSearch = h('input', { placeholder: 'Search', oninput: () => paintRail() });
  const railList = h('div');
  const rail = h('aside', { class: 'ss-rail ss-rail--code', style: '--ss-rail-w:280px' },
    h('div', { class: 'ss-rail__head ss-rail__head--title' }, '마스터 관리'),
    h('div', { class: 'ss-rail__search' }, h('div', { class: 'ss-search' }, railSearch,
      h('button', { class: 'ss-search__btn', 'aria-label': '검색', html: icon.search }))),
    railList);
  const counts = {};
  function paintRail() {
    const q = railSearch.value.trim();
    clear(railList);
    for (const m of MASTERS.filter((x) => !q || x.label.includes(q))) {
      railList.appendChild(h('div', {
        class: 'ss-rail__code' + (m.type === state.type ? ' ss-rail__code--active' : ''),
        onclick: () => go(m.type),
      },
      h('span', { class: 'ss-rail__code-key' }, m.label),
      h('span', { class: 'ss-rail__code-name' }, counts[m.type] == null ? '' : `${counts[m.type]} 건`)));
    }
  }
  async function loadCounts() {
    try {
      const all = await api.masterAll();
      MASTERS.forEach((m) => {
        if (!Array.isArray(all[m.type])) return;
        counts[m.type] = all[m.type].filter((r) => !hasActive(m) || r.active).length;
      });
    } catch { /* 건수는 참고용 */ }
    paintRail();
  }

  const pane = h('div', { class: 'ss-railview__body' });
  root.appendChild(h('div', { class: 'ss-railview' }, rail, pane));

  // 레일 항목을 누르면 무조건 오른쪽을 처음 상태로 다시 그린다 (사용자 지정) —
  // 같은 항목을 다시 눌러도, 저장 안 한 변경이 있어도 묻지 않고 버린다. 솔루션·연도·정렬도 처음 값으로
  function go(type) {
    state.type = type;
    state.solution = defaultSolution;
    state.year = null;
    state.target = NEGO_TARGETS[0][0];
    refresh();
  }

  function refresh() {
    rows = []; deleted = [];
    paintRail();
    clear(pane);
    const m = current();
    pane.appendChild(h('div', { class: 'ss-subtitle' }, `${m.label}`));
    renderTable();
  }

  // ── 일반 마스터: 머리 폼 + 편집 그리드 ──
  let tbody;
  let sort = { key: null, dir: null }; // 머리 칸 정렬 — 누를 때마다 오름 → 내림 → 원래 순서
  let seq = 0;                         // 원래 순서 번호 (불러온 순서, 새 행은 뒤로)
  let headCells = [];
  function renderTable() {
    const m = current();
    sort = { key: null, dir: null };
    const fields = h('div', { class: 'ss-edithead__fields' });
    // 솔루션 · 연도 모두 라벨 글자 없이 선택 상자만 (사용자 지정) — 화면 읽기용 이름은 aria-label 로
    if (m.scoped) {
      fields.appendChild(h('div', { class: 'ss-field' },
        h('select', { class: 'ss-select', 'aria-label': '솔루션', onchange: (e) => { if (!confirmLeave(e, state.solution)) return; state.solution = e.target.value; load(); } },
          ...solutions.map((s) => h('option', { value: s.code, selected: s.code === state.solution }, s.name || s.code)))));
    }
    if (m.filterTarget) {
      fields.appendChild(h('div', { class: 'ss-field' },
        h('select', { class: 'ss-select', 'aria-label': '구분', onchange: (e) => { if (!confirmLeave(e, state.target)) return; state.target = e.target.value; load(); } },
          ...m.filterTarget.map(([v, label]) => h('option', { value: v, selected: v === state.target }, label)))));
    }
    if (m.filterYear) {
      fields.appendChild(h('div', { class: 'ss-field' },
        h('select', { class: 'ss-select', id: 'master-year', 'aria-label': '연도', onchange: (e) => { state.year = Number(e.target.value); load(); } })));
    }
    // 행추가 · 행삭제는 저장 바로 왼쪽에 붙인다 (사용자 요청 — 캡처의 명세바 좌측 배치 대신)
    pane.appendChild(h('div', { class: 'ss-edithead' }, fields,
      h('div', { class: 'ss-actions' },
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: addRow }, '행추가'),
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: removeRows }, '행삭제'),
        h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));

    // 편집 그리드 위에는 건수 줄을 두지 않는다 (건수는 레일에 있다). 안내 문구가 있는 마스터만 한 줄
    if (m.type === 'modules') {
      pane.appendChild(h('div', { class: 'ss-detailbar' },
        h('span', { class: 'ss-detailbar__note' }, '단가는 가격정책에서 관리합니다.')));
    }

    const gf = gridFields(m);
    // 첫 칸은 '선택' — 60px 고정 (사용자 지정)
    // 표가 본문보다 좁으면 남는 폭은 비고(없으면 이름 → 고르는 칸) 칸이 받는다 — 다른 칸 폭은 그대로
    const flex = gf.find((f) => f.key === 'note')
      || gf.find((f) => ['name', 'role_name', 'revenue_cond'].includes(f.key))
      || gf.find((f) => f.type === 'preset') || gf[gf.length - 1];
    const cols = [h('col', { style: 'width:60px' }),
      ...gf.map((f) => h('col', { style: f === flex ? null : `width:${colWidth(f)}px` })),
      ...(m.preview ? [h('col', { style: 'width:220px' })] : [])];
    tbody = h('tbody');
    const table = h('table', { class: 'ss-grid', style: `min-width:${60 + gf.reduce((s, f) => s + colWidth(f), 0) + (m.preview ? 220 : 0)}px` },
      h('colgroup', {}, ...cols),
      h('thead', {}, h('tr', {},
        h('th', { 'data-fixed': '' }, '선택'),
        ...(headCells = gf.map((f) => h('th', {
          class: 'is-sortable' + (f.required || f.pk ? ' req' : ''),
          title: '눌러서 정렬',
          onclick: () => toggleSort(f),
        }, f.label, h('span', { class: 'ss-sortmark' })))),
        ...(m.preview ? [h('th', {}, '기준단가 (참고)')] : []))),
      tbody);
    pane.appendChild(h('div', { class: 'ss-gridwrap ss-gridwrap--fill' }, table));
    resizableColumns(table, `quote2:master-cols:${m.type}`); // 선택 칸(60px)은 고정
    load();
  }

  function colWidth(f) {
    if (f.type === 'checkbox') return 60;
    if (f.type === 'codeview') return 110;
    if (f.full || f.key === 'note' || f.key === 'revenue_cond') return 240;
    if (f.type === 'preset') return 170;
    if (f.key === 'name' || f.key === 'role_name') return 180;
    if (f.type === 'number' && f.key === 'sort') return 70;
    return 130;
  }

  // 머리 폼 솔루션을 바꿀 때 저장 안 한 변경이 있으면 되돌린다
  function confirmLeave(e, prev) {
    if (!isDirty()) return true;
    toast('저장하지 않은 변경이 있습니다. 먼저 저장하세요.', 'err');
    e.target.value = prev;
    return false;
  }

  const emptyRow = (text) => h('tr', {}, h('td', { colspan: gridFields(current()).length + 2, class: 'ss-cell--empty' }, text));

  // 서버 행 → 입력 상태
  function toForm(m, row) {
    const form = {};
    m.fields.forEach((f) => {
      form[f.key] = f.type === 'checkbox' ? (row[f.key] ? 1 : 0) : row[f.key];
      if (f.type === 'preset' && f.labelField) form[f.labelField] = row[f.labelField];
    });
    return form;
  }

  function defaultFor(f) {
    if (f.default != null) return f.default;
    if (f.type === 'checkbox') return f.key === 'active' ? 1 : 0;
    if (f.type === 'solution') return state.solution || solutions[0]?.code || '';
    if (f.type === 'number' && f.key === 'sort') return rows.length + 1;
    return null;
  }

  async function load() {
    const m = current();
    rows = []; deleted = [];
    clear(tbody).appendChild(emptyRow('불러오는 중...'));
    try {
      const { rows: list } = await api.masterList(m.type, m.scoped ? state.solution : undefined);
      let data = list || [];
      if (m.filterYear) {
        const years = [...new Set(data.map((r) => Number(r.year)))].sort((a, b) => b - a);
        if (state.year == null || !years.includes(state.year)) state.year = years[0] ?? null;
        const sel = document.getElementById('master-year');
        if (sel) clear(sel).append(...years.map((y) => h('option', { value: y, selected: y === state.year }, y + '년')));
        data = data.filter((r) => Number(r.year) === state.year);
      }
      // 사용 중지한 행은 보이지 않는다 (사용자 지정 — 되살리기는 DB 에서 active=1)
      if (hasActive(m)) data = data.filter((r) => r.active);
      if (m.fields.some((f) => f.options === 'company')) {
        // 네고율: 기업구분 선택지를 기업구분 마스터(사용 중, 정렬 순)에서 새로 받는다
        try {
          const { rows: cc } = await api.masterList('company_classes');
          const opts = (cc || []).filter((r) => r.active).sort((a, b) => a.sort - b.sort).map((r) => [r.key, r.label]);
          if (opts.length) companyOpts = opts;
        } catch { /* 못 받으면 기본 5종 */ }
      }
      // 네고율: 상단에서 고른 구분(솔루션/인건비)의 행만
      if (m.filterTarget) data = data.filter((r) => r.target === state.target);
      rows = data.map((r) => ({ orig: r, form: toForm(m, r), isNew: false, checked: false, seq: seq++ }));
      applySort();
      paintRows();
    } catch (err) {
      clear(tbody).appendChild(emptyRow(err.message));
    }
  }

  function addRow() {
    const m = current();
    const form = {};
    m.fields.forEach((f) => { form[f.key] = defaultFor(f); if (f.type === 'preset' && f.labelField) form[f.labelField] = ''; });
    if (m.filterYear && state.year != null) form.year = state.year;
    rows.push({ orig: null, form, isNew: true, checked: false, seq: seq++ }); // 정렬 중이어도 새 행은 맨 아래
    paintRows();
    tbody.lastElementChild?.querySelector('input:not([type=checkbox]), select')?.focus();
  }

  function removeRows() {
    const picked = rows.filter((r) => r.checked);
    if (!picked.length) return toast('삭제할 행을 선택하세요.', 'err');
    picked.forEach((r) => { if (!r.isNew) deleted.push(r.orig); });
    rows = rows.filter((r) => !r.checked);
    paintRows();
  }

  function toggleSort(f) {
    const next = sort.key !== f.key ? 'asc' : sort.dir === 'asc' ? 'desc' : null;
    sort = { key: next ? f.key : null, dir: next };
    headCells.forEach((th, i) => {
      const on = gridFields(current())[i].key === sort.key;
      th.querySelector('.ss-sortmark').textContent = on ? (sort.dir === 'asc' ? '▲' : '▼') : '';
      th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    applySort();
    paintRows();
  }

  // 지금 칸에 입력된 값 기준. 숫자·체크는 숫자로, 글자는 한글 순서로, 빈 값은 항상 뒤로
  function applySort() {
    const m = current();
    const f = sort.key && m.fields.find((x) => x.key === sort.key);
    if (!f) { rows.sort((a, b) => a.seq - b.seq); return; }
    const num = numType(f) || f.type === 'checkbox';
    const val = (r) => {
      const v = f.type === 'preset' ? ((optionsOf(f).find(([k]) => k === r.form[f.key]) || [])[1] ?? r.form[f.key])
        : f.type === 'codeview' ? r.form[f.of] : r.form[f.key];
      if (v == null || v === '') return null;
      return num ? Number(v) : String(v);
    };
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return x == null && y == null ? a.seq - b.seq : x == null ? 1 : -1;
      const c = num ? x - y : x.localeCompare(y, 'ko', { numeric: true });
      return c ? c * dir : a.seq - b.seq;
    });
  }

  function paintRows() {
    const m = current();
    const total = rows.length;
    clear(tbody);
    if (!total) { tbody.appendChild(emptyRow('데이터가 없습니다. 행추가로 등록하세요.')); return; }
    rows.forEach((r) => tbody.appendChild(rowEl(m, r)));
  }

  function rowEl(m, r) {
    const tr = h('tr', { class: r.isNew ? 'is-new' : null });
    tr.appendChild(h('td', {}, h('input', { type: 'checkbox', checked: r.checked, 'aria-label': '선택', onchange: (e) => { r.checked = e.target.checked; } })));
    const previewTd = m.preview ? h('td', { class: 'ss-cell--left' }, m.preview(r.form)) : null;
    const onChange = (f) => {
      if (previewTd) previewTd.textContent = m.preview(r.form);
      if (f.rerenders) tr.replaceWith(rowEl(m, r)); // 계산방식이 바뀌면 쓸 칸이 바뀐다
    };
    gridFields(m).forEach((f) => tr.appendChild(cellEl(m, f, r, onChange)));
    if (previewTd) tr.appendChild(previewTd);
    return tr;
  }

  function cellEl(m, f, r, onChange) {
    const form = r.form;
    const off = !visible(f, form);
    const fire = () => onChange(f);
    if (f.type === 'codeview') return h('td', { class: 'ss-cell--link' }, form[f.of] || '');
    if (f.type === 'checkbox') {
      return h('td', {}, h('input', { type: 'checkbox', checked: !!form[f.key], 'aria-label': f.label,
        onchange: (e) => { form[f.key] = e.target.checked ? 1 : 0; fire(); } }));
    }
    if (f.type === 'preset') {
      // unique(정체성 코드)면 다른 행이 이미 쓴 값은 고를 수 없다
      const taken = f.unique ? new Set(rows.filter((x) => x !== r).map((x) => x.form[f.key])) : new Set();
      const sel = h('select', { class: 'ss-cellinput', disabled: off, 'aria-label': f.label, onchange: (e) => {
        form[f.key] = e.target.value;
        if (f.labelField) form[f.labelField] = (optionsOf(f).find(([v]) => v === e.target.value) || [])[1] || '';
        fire();
      } },
      h('option', { value: '', selected: !form[f.key] }, '선택'),
      ...optionsOf(f).filter(([v]) => v === form[f.key] || !taken.has(v))
        .map(([v, txt]) => h('option', { value: v, selected: v === form[f.key] }, txt)));
      return h('td', { class: 'ss-cell--input' }, sel);
    }
    const isNum = numType(f);
    let value = form[f.key];
    if (f.type === 'percent') value = value == null || value === '' ? '' : +(Number(value) * 100).toFixed(4);
    const attrs = {
      class: 'ss-cellinput', disabled: off, readOnly: !!(f.lockOnEdit && !r.isNew), 'aria-label': f.label,
      // 숫자는 우측 정렬. 단, 정렬(sort) 순번은 가운데 (사용자 지정)
      style: f.key === 'sort' || f.mono ? 'text-align:center' : isNum ? 'text-align:right' : null,
    };
    const inp = isNum
      ? numInput(off ? '' : value, (t) => {
        form[f.key] = f.type === 'percent' ? (t === '' ? null : Number(t) / 100) : t;
        fire();
      }, attrs, !!f.plain)
      : h('input', { ...attrs, type: 'text', value: off ? '' : (value ?? ''),
        oninput: (e) => { form[f.key] = e.target.value; fire(); } });
    return h('td', { class: 'ss-cell--input' + (f.mono ? ' ss-cell--link' : '') }, inp);
  }

  // 입력 상태 → 저장할 값 (예전 모달과 같은 규칙: 숨은 칸은 보내지 않음, 고정 컬럼 주입)
  function payloadOf(m, form, isNew) {
    const payload = {};
    let missing = null;
    m.fields.filter((f) => visible(f, form) && f.type !== 'codeview').forEach((f) => {
      let v = form[f.key];
      if (f.type === 'preset') {
        if (f.required && (v === '' || v == null)) missing = missing || f.label;
        payload[f.key] = v;
        if (f.labelField) payload[f.labelField] = form[f.labelField];
        return;
      }
      if (numType(f)) v = (v === '' || v == null) ? null : Number(v);
      else if (f.type === 'checkbox') v = v ? 1 : 0;
      if ((f.required || (f.pk && isNew)) && (v === '' || v == null)) missing = missing || f.label;
      payload[f.key] = v;
    });
    if (m.inject) Object.assign(payload, m.inject);
    if (isNew && m.injectOnCreate) Object.assign(payload, m.injectOnCreate);
    if (isNew && m.scoped) payload.solution = state.solution;
    if (isNew && m.filterTarget) payload.target = state.target;
    return { payload, missing };
  }

  function changed(r) {
    if (r.isNew) return true;
    const m = current();
    const a = payloadOf(m, r.form, false).payload;
    const b = payloadOf(m, toForm(m, r.orig), false).payload;
    return JSON.stringify(a) !== JSON.stringify(b);
  }

  async function save() {
    const m = current();
    const creates = rows.filter((r) => r.isNew);
    const updates = rows.filter((r) => !r.isNew && changed(r));
    if (!creates.length && !updates.length && !deleted.length) return toast('변경된 내용이 없습니다.', 'ok');
    for (const r of [...creates, ...updates]) {
      const { missing } = payloadOf(m, r.form, r.isNew);
      if (missing) return toast(`필수 항목을 확인하세요: ${missing}`, 'err');
    }
    // unique 텍스트 칸(코드)은 보이는 행끼리 겹치면 안 된다
    for (const f of m.fields.filter((x) => x.unique && x.type !== 'preset')) {
      const vals = rows.map((r) => String(r.form[f.key] ?? '').trim()).filter(Boolean);
      const dup = vals.find((v, i) => vals.indexOf(v) !== i);
      if (dup) return toast(`${f.label}가 겹칩니다: ${dup}`, 'err');
    }
    // 여러 칸 조합이 겹치면 안 되는 마스터(네고율: 상주여부 · 구분 · 기업구분)
    if (m.uniqueCombo) {
      const keys = rows.map((r) => m.uniqueCombo.map((k) => r.form[k] ?? '').join('|'));
      const di = keys.findIndex((k, i) => keys.indexOf(k) !== i);
      if (di >= 0) {
        const r = rows[di];
        const label = m.uniqueCombo.map((k) => {
          const f = m.fields.find((x) => x.key === k);
          return (optionsOf(f).find(([v]) => v === r.form[k]) || [])[1] || r.form[k];
        }).join(' · ');
        return toast(`같은 조합이 두 번 있습니다: ${label}`, 'err');
      }
    }
    const soft = m.fields.some((f) => f.key === 'active');
    if (deleted.length && !(await confirmModal({
      title: soft ? '사용 중지' : '삭제',
      message: soft
        ? `행삭제한 ${deleted.length}건은 사용 중지됩니다(목록엔 '중지'로 남습니다). 저장하시겠습니까?`
        : `행삭제한 ${deleted.length}건을 삭제합니다. 저장하시겠습니까?`,
      okLabel: '저장', danger: true,
    }))) return;
    let done = 0;
    try {
      for (const o of deleted) { await api.masterDelete(m.type, o[m.pk]); done++; }
      for (const r of creates) { await api.masterCreate(m.type, payloadOf(m, r.form, true).payload); done++; }
      for (const r of updates) { await api.masterUpdate(m.type, r.orig[m.pk], payloadOf(m, r.form, false).payload); done++; }
      toast(`저장되었습니다. (${done}건)`, 'ok');
    } catch (err) {
      toast(`${done}건 저장 후 실패: ${err.message}`, 'err');
    }
    load();
    loadCounts();
  }

  refresh();
  loadCounts();
}

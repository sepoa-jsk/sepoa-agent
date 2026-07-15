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
      { key: 'key', label: '기업구분', type: 'preset', labelField: 'label', required: true, options: CLASS_PRESET },
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
      { key: 'code', label: '상주여부', type: 'preset', labelField: 'name', required: true, options: ONSITE_PRESET },
      { key: 'sort', label: '정렬', type: 'number' },
    ],
  },
  {
    type: 'service_types', label: '서비스구분', pk: 'id', scoped: false,
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
    type: 'labor_roles', label: '인력구분', pk: 'id', scoped: true,
    // 목록은 직군명 | 필수 | 비고. 표준 M/M 은 모달(fields)에서만 편집.
    list: ['name', ['required', '필수'], 'note'],
    fields: [
      { key: 'solution', label: '솔루션', type: 'solution' },
      { key: 'code', label: '코드', type: 'text', mono: true },
      { key: 'name', label: '직군명', type: 'text' },
      { key: 'std_mm', label: '표준 M/M', type: 'number' },
      { key: 'required', label: '필수여부', type: 'checkbox' },
      { key: 'note', label: '비고', type: 'text', full: true },
      { key: 'active', label: '사용', type: 'checkbox' },
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
  const state = { type: MASTERS[0].type, solution: defaultSolution };
  let currentRows = []; // 현재 탭에 로드된 행 (preset 중복 제외에 사용)

  const current = () => MASTERS.find((m) => m.type === state.type);
  const numType = (f) => f.type === 'money' || f.type === 'number';
  const colClass = (f) => (numType(f) ? 'num' : f.type === 'checkbox' ? 'center' : '');
  // list 항목은 'key' 또는 ['key','헤더라벨'] 형태 모두 허용한다.
  const listKey = (it) => (Array.isArray(it) ? it[0] : it);
  const listHeader = (it, fm) => (Array.isArray(it) ? it[1] : fm[listKey(it)].label);

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
  const addBtn = h('button', { class: 'add-section', style: 'margin-top:12px', onclick: () => editRow(null) }, '＋ 새 항목 추가');
  root.appendChild(h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
    h('table', { class: 'grid master-grid' }, thead, tbody))));
  root.appendChild(addBtn);

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

  function buildHead() {
    const fm = fmap(current());
    clear(thead).appendChild(h('tr', { style: S.thead },
      ...current().list.map((it) => h('th', { class: colClass(fm[listKey(it)]) }, listHeader(it, fm))),
      h('th', { style: 'text-align:right' }, '관리')
    ));
  }

  function refresh() { syncTabs(); buildContextBar(); buildHead(); load(); }

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
      currentRows = rows || [];
      clear(tbody);
      if (currentRows.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan }, h('div', { class: 'empty' }, '데이터가 없습니다.'))));
        return;
      }
      const delLabel = hasActive ? '중지' : '삭제'; // active 있으면 서버가 소프트 삭제
      for (const row of currentRows) {
        const dim = hasActive && !row.active;
        tbody.appendChild(h('tr', { style: dim ? 'opacity:.5' : null },
          ...m.list.map((it) => { const k = listKey(it); return h('td', { class: colClass(fm[k]) }, cellNode(fm[k], row[k])); }),
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
    if (numType(f)) return 0;
    if (f.type === 'checkbox') return f.key === 'active' ? 1 : 0;
    if (f.type === 'solution') return state.solution || solutions[0]?.code || '';
    return ''; // text / preset
  }

  function buildInput(f, form, isNew) {
    const set = (v) => { form[f.key] = v; };
    if (f.type === 'preset') {
      // 이미 존재하는 값은 신규 추가 시 드롭다운에서 제외(중복 방지).
      const existing = new Set(currentRows.map((r) => r[f.key]));
      const avail = f.options.filter(([val]) => (isNew ? !existing.has(val) : true));
      const setPreset = (val) => {
        form[f.key] = val;
        const opt = f.options.find(([v]) => v === val);
        form[f.labelField] = opt ? opt[1] : '';
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
    const attrs = {
      class: 'input',
      type: numType(f) ? 'number' : 'text',
      value: form[f.key] ?? '',
      oninput: (e) => set(e.target.value),
    };
    if (numType(f)) attrs.step = 'any';
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
      if (f.type === 'preset') form[f.labelField] = row ? row[f.labelField] : ''; // 이름 컬럼 동기화
    });
    if (isNew && m.scoped) {
      const sf = m.fields.find((f) => f.type === 'solution');
      if (sf) form[sf.key] = state.solution;
    }

    const body = h('div', {}, h('div', { class: 'form-grid' },
      ...m.fields.map((f) => fld(f, buildInput(f, form, isNew)))));

    const saveBtn = h('button', { class: 'btn btn-primary' }, isNew ? '추가' : '저장');
    const modal = openModal({
      title: `${m.label} ${isNew ? '추가' : '수정'}`,
      body,
      footer: [h('button', { class: 'btn', onclick: () => modal.close() }, '취소'), saveBtn],
    });

    saveBtn.onclick = async () => {
      const payload = {};
      let missing = null;
      m.fields.forEach((f) => {
        if (f.type === 'preset') {
          const v = form[f.key];
          if (f.required && (v === '' || v == null)) missing = missing || f.label;
          payload[f.key] = v;                     // 코드(key/code)
          payload[f.labelField] = form[f.labelField]; // 이름(label/name) 동시 세팅
          return;
        }
        let v = form[f.key];
        if (numType(f)) v = (v === '' || v == null) ? null : Number(v);
        else if (f.type === 'checkbox') v = v ? 1 : 0;
        payload[f.key] = v;
      });
      if (missing) return toast(`${missing}을(를) 선택하세요.`, 'err');
      if (m.inject) Object.assign(payload, m.inject); // solution/deployment 자동 주입

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

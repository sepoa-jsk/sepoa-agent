// SingleSuite 셸의 화면 제목 바 + 본문 우측 상단 액션 + GNB 사용자 표시.
//
// 화면 ↔ 셸 인터페이스 (예전 GNB 와 같다 — 화면 코드는 그대로 부른다)
//   setPage({ title, path, actions })
//     title   : 화면 제목. 제목 바(41px)에 글자만 들어간다 — 제목 바에는 버튼을 두지 않는다(SingleSuite 규칙)
//     path    : 예전 브레드크럼. 지금 셸에는 표시하지 않지만 화면들이 넘기므로 받아 둔다
//     actions : [{ label, onClick, primary?, id? }] — 본문 우측 상단(L2 자리)에 놓는다
//   라우팅 시 app.js 가 PAGE_META 로 먼저 부르고, 화면이 렌더 중 setPage({ actions }) 로 덮어쓴다.
//   L1 으로 바꾼 화면은 액션을 툴바 우측에 직접 그리므로 actions 를 넘기지 않는다.

let state = { title: '', path: '', actions: [] };

const el = (id) => document.getElementById(id);

export function setPage(patch = {}) {
  state = { ...state, ...patch };
  paint();
}

// GNB 우측 — 실화면 표기 "이름 ( ID )". ID 는 이메일 앞부분
export function setUser(user) {
  const nm = el('gnb-username');
  if (!nm) return;
  const id = (user?.email || '').split('@')[0];
  const name = user?.name || id;
  nm.textContent = id && id !== name ? `${name} ( ${id} )` : name;
}

function paint() {
  const t = el('page-title');
  if (t) t.textContent = state.title || '';
  const a = el('page-actions');
  if (!a) return;
  a.innerHTML = '';
  for (const act of state.actions || []) {
    if (act.node) { a.appendChild(act.node); continue; } // 화면이 직접 만든 버튼 묶음(예: 검토·발행의 발행 · 내려받기)
    const b = document.createElement('button');
    b.className = 'ss-btn ' + (act.primary ? 'ss-btn--save' : 'ss-btn--default');
    b.textContent = act.label;
    if (act.id) b.id = act.id;
    if (act.onClick) b.addEventListener('click', act.onClick);
    a.appendChild(b);
  }
  a.hidden = !(state.actions || []).length;
}

// 라우트별 제목. 하단 탭바도 이 제목을 쓴다.
export const PAGE_META = {
  quotes: { title: '견적 목록', path: '견적관리 / 견적 목록' },
  new: { title: '견적 작성', path: '견적관리 / 견적 작성' },
  detail: { title: '견적 상세', path: '견적관리 / 견적 목록 / 상세' },
  pricing: { title: '가격정책', path: '기준정보 / 가격정책' },
  master: { title: '마스터 관리', path: '기준정보 / 마스터 관리' },
  customer: { title: '고객사', path: '기준정보 / 고객사' },
  'labor-rates': { title: '노임단가', path: '기준정보 / 노임단가' },
  templates: { title: '견적 템플릿', path: '기준정보 / 견적 템플릿' },
  term: { title: '견적조건 문구', path: '기준정보 / 견적조건 문구' },
  risk: { title: '리스크 계수', path: '기준정보 / 리스크 계수' },
  tco: { title: 'TCO 비교', path: '시뮬레이션 / TCO 비교' },
  dispatch: { title: '발송·열람 현황', path: '견적관리 / 발송·열람 현황' },
  user: { title: '사용자', path: '시스템관리 / 사용자' },
  role: { title: '역할·권한', path: '시스템관리 / 역할·권한' },
  dept: { title: '조직', path: '시스템관리 / 조직' },
  settings: { title: '설정', path: '시스템관리 / 설정' },
};

// GNB (상단바) — 시안(docs/ui-mockup.html) header.gnb 구조. 높이 56px.
//
// 화면 ↔ GNB 인터페이스
//   setPage({ title, path, actions })
//     title   : 화면 제목 (필수)
//     path    : 브레드크럼 문자열. 예 '견적관리 / 견적 목록'
//     actions : GNB 우측에 놓을 버튼 배열. [{ label, onClick, primary?, id? }]
//   라우팅 시 app.js 가 라우트 테이블의 title/path 로 먼저 호출하고,
//   화면이 자기 액션 버튼을 올리려면 렌더 중에 setPage({ actions }) 를 다시 부른다.
//   (title/path 를 생략하면 직전 값을 유지한다)

let state = { title: '', path: '', actions: [] };

const el = (id) => document.getElementById(id);

export function setPage(patch = {}) {
  state = { ...state, ...patch };
  paint();
}

export function setUser(user) {
  const name = (user && (user.name || user.email)) || '';
  const initial = name ? name.trim().charAt(0).toUpperCase() : '?';
  const av = el('gnb-avatar');
  const nm = el('gnb-username');
  if (av) av.textContent = initial;
  if (nm) nm.textContent = name;
}

function paint() {
  const t = el('gnb-title');
  const p = el('gnb-path');
  const a = el('gnb-actions');
  if (t) t.textContent = state.title || '';
  if (p) p.textContent = state.path || '';
  if (!a) return;
  a.innerHTML = '';
  for (const act of state.actions || []) {
    const b = document.createElement('button');
    b.className = 'btn' + (act.primary ? ' btn-primary' : '');
    b.textContent = act.label;
    if (act.id) b.id = act.id;
    if (act.onClick) b.addEventListener('click', act.onClick);
    a.appendChild(b);
  }
}

// 라우트별 기본 제목·경로. 사이드바 그룹명을 브레드크럼 앞단으로 쓴다.
export const PAGE_META = {
  quotes: { title: '견적 목록', path: '견적관리 / 견적 목록' },
  new: { title: '견적 작성', path: '견적관리 / 견적 작성' },
  'new-template': { title: '템플릿 견적', path: '견적관리 / 템플릿 견적' },
  detail: { title: '견적 상세', path: '견적관리 / 견적 목록 / 상세' },
  pricing: { title: '가격정책', path: '기준정보 / 가격정책' },
  master: { title: '마스터 관리', path: '기준정보 / 마스터 관리' },
  'labor-rates': { title: '노임단가', path: '기준정보 / 노임단가' },
  templates: { title: '메일·문서 템플릿', path: '기준정보 / 메일·문서 템플릿' },
  settings: { title: '설정', path: '시스템관리 / 설정' },
};

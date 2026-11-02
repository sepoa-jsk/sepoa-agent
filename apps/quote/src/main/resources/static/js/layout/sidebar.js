// 전체 메뉴 — SingleSuite GNB 의 햄버거 버튼으로 여는 메뉴판.
// 예전 좌측 네이비 사이드바를 대신한다(SingleSuite 셸에는 좌측 사이드바가 없다).
// 파일 이름은 app.js 의 import 를 그대로 두려고 유지한다.
import { toast } from '../ui.js';

// href 가 없으면 미구현 — 클릭 시 "준비 중" 토스트만 띄운다.
// admin: 관리자(ADMIN)에게만 노출 — 단, 업무 역할(역할·권한 화면)에 그 메뉴 '조회' 가 있으면 일반 사용자에게도 보인다.
// system: 시스템관리 — 관리자 전용(역할 권한과 상관없이).
// 공통코드 메뉴는 없앴다(2026-10-31 — 기준 목록은 마스터 관리와 겹친다).
export const MENU = [
  { group: '견적관리', items: [
    { nav: 'quotes', label: '견적 목록', href: '#/quotes' },
    { nav: 'new', label: '견적 작성', href: '#/quotes/new' },
    { nav: 'approvals', label: '승인 요청함' },
    { nav: 'dispatch', label: '발송·열람 현황', href: '#/dispatch' },
  ] },
  { group: '시뮬레이션', items: [
    { nav: 'tco', label: 'TCO 비교', href: '#/tco' },
  ] },
  { group: '기준정보', items: [
    { nav: 'pricing', label: '가격정책', href: '#/pricing', admin: true },
    { nav: 'master', label: '마스터 관리', href: '#/master', admin: true },
    { nav: 'customer', label: '고객사관리', href: '#/customers', admin: true },
    { nav: 'risk', label: '리스크 계수', href: '#/risk', admin: true },
    { nav: 'labor-rates', label: '노임단가', href: '#/labor-rates', admin: true },
    { nav: 'term', label: '견적조건 문구', href: '#/conditions', admin: true },
    { nav: 'templates', label: '견적 템플릿', href: '#/templates', admin: true },
  ] },
  { group: '시스템관리', items: [
    { nav: 'user', label: '사용자관리', href: '#/users', admin: true, system: true },
    { nav: 'role', label: '역할·권한', href: '#/roles', admin: true, system: true },
    { nav: 'dept', label: '조직', href: '#/depts', admin: true, system: true },
    { nav: 'settings', label: '설정', href: '#/settings', admin: true, system: true },
  ] },
];

// 역할·권한 표에 나오는 메뉴 — [nav, 이름, 묶음]. 시스템관리 · 아직 없는 화면(승인 요청함)은 뺀다
export const ROLE_MENUS = MENU.flatMap(({ group, items }) => items.filter((it) => it.href && !it.system).map((it) => [it.nav, it.label, group]));

// 이 메뉴를 열 수 있는가 — 관리자는 모두. 업무 역할 권한(perms)이 있으면 '조회(R)' 가 있는 메뉴만, 없으면 예전처럼 관리자 메뉴만 숨긴다
export function canOpen(nav, { isAdmin, perms }) {
  if (isAdmin) return true;
  const it = MENU.flatMap((g) => g.items).find((x) => x.nav === nav);
  if (!it || it.system) return !it;
  if (perms) return String(perms[nav] || '').includes('R');
  return !it.admin;
}

let outsideBound = false;

export function renderSidebar(_root, { isAdmin, perms }) {
  const nav = document.getElementById('gnb-menu');
  const btn = document.getElementById('gnb-menu-btn');
  nav.innerHTML = MENU.map(({ group, items }) => {
    const links = items
      .filter((it) => canOpen(it.nav, { isAdmin, perms }))
      .map((it) => it.href
        ? `<a class="ss-menu__item" href="${it.href}" data-nav="${it.nav}">${it.label}</a>`
        : `<a class="ss-menu__item ss-menu__item--soon" href="#" data-nav="${it.nav}" data-soon="1">${it.label}</a>`)
      .join('');
    return links ? `<div class="ss-menu__group"><div class="ss-menu__title">${group}</div>${links}</div>` : '';
  }).join('');

  const close = () => { nav.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.onclick = (e) => {
    e.stopPropagation();
    nav.hidden = !nav.hidden;
    btn.setAttribute('aria-expanded', String(!nav.hidden));
  };
  // 메뉴판 바깥을 누르면 닫는다. 다시 로그인해도 한 번만 건다
  if (!outsideBound) {
    document.addEventListener('click', (e) => { if (!nav.contains(e.target)) close(); });
    outsideBound = true;
  }
  nav.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', (e) => {
      close();
      if (!a.dataset.soon) return;
      // 미구현 메뉴 — 라우팅하지 않고 안내만
      e.preventDefault();
      toast(`${a.textContent.trim()} 화면은 준비 중입니다.`, 'ok');
    });
  });
}

// 현재 라우트에 해당하는 항목을 활성 표시
export function setActiveNav(nav) {
  document.querySelectorAll('#gnb-menu a').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.nav === nav);
  });
}

// 메뉴 이름 — 하단 탭바가 쓴다
export function menuLabel(nav) {
  for (const g of MENU) for (const it of g.items) if (it.nav === nav) return it.label;
  return null;
}

// 전체 메뉴 — SingleSuite GNB 의 햄버거 버튼으로 여는 메뉴판.
// 예전 좌측 네이비 사이드바를 대신한다(SingleSuite 셸에는 좌측 사이드바가 없다).
// 파일 이름은 app.js 의 import 를 그대로 두려고 유지한다.
import { toast } from '../ui.js';

// href 가 없으면 미구현 — 클릭 시 "준비 중" 토스트만 띄운다.
// admin: ADMIN 역할에게만 노출.
export const MENU = [
  { group: '견적관리', items: [
    { nav: 'quotes', label: '견적 목록', href: '#/quotes' },
    { nav: 'new', label: '견적 작성', href: '#/quotes/new' },
    { nav: 'approvals', label: '승인 요청함' },
    { nav: 'dispatch', label: '발송·열람 현황' },
  ] },
  { group: '시뮬레이션', items: [
    { nav: 'tco', label: 'TCO 비교' },
  ] },
  { group: '기준정보', items: [
    { nav: 'pricing', label: '가격정책', href: '#/pricing', admin: true },
    { nav: 'master', label: '마스터 관리', href: '#/master', admin: true },
    { nav: 'customer', label: '고객사', href: '#/customers', admin: true },
    { nav: 'risk', label: '리스크 계수' },
    { nav: 'labor-rates', label: '노임단가', href: '#/labor-rates', admin: true },
    { nav: 'code', label: '공통코드' },
    { nav: 'term', label: '견적조건 문구' },
    { nav: 'templates', label: '메일·문서 템플릿', href: '#/templates', admin: true },
  ] },
  { group: '시스템관리', items: [
    { nav: 'user', label: '사용자' },
    { nav: 'role', label: '역할·권한' },
    { nav: 'dept', label: '조직' },
    { nav: 'settings', label: '설정', href: '#/settings', admin: true },
  ] },
];

let outsideBound = false;

export function renderSidebar(_root, { isAdmin }) {
  const nav = document.getElementById('gnb-menu');
  const btn = document.getElementById('gnb-menu-btn');
  nav.innerHTML = MENU.map(({ group, items }) => {
    const links = items
      .filter((it) => !it.admin || isAdmin)
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

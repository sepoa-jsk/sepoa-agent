// 사이드바 — 시안(docs/ui-mockup.html) aside.side 구조.
// 아이콘은 Lucide 16px 인라인 SVG. 이모지 사용 금지(CLAUDE.md §5).
import { toast } from '../ui.js';

// Lucide path 조각 (viewBox 0 0 24 24, stroke=currentColor)
const I = {
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  layout: '<path d="M4 4h16v16H4z"/><path d="M4 9h16M9 9v11"/>',
  inbox: '<path d="M4 4h16v12H5.2L4 18z"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  box: '<path d="M12 2l9 4.5v11L12 22l-9-4.5v-11z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 8h5M17 12h5"/>',
  sliders: '<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6H7a2 2 0 0 1 0-4"/><circle cx="17" cy="14" r="1"/>',
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  quote: '<path d="M4 5h16M4 10h16M4 15h10"/>',
  mail: '<path d="M4 5h16v14H4z"/><path d="m4 6 8 6 8-6"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  shield: '<path d="M12 3l8 3.5V12c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6.5z"/>',
  building: '<path d="M5 21V4h9v17M14 9h5v12"/><path d="M8 8h2M8 12h2M8 16h2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.65.73.85.32.2.7.3 1.08.3H21a2 2 0 1 1 0 4h-.09c-.38 0-.76.1-1.08.3z"/>',
};
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${d}</svg>`;

// href 가 없으면 미구현 — 클릭 시 "준비 중" 토스트만 띄운다.
// admin: ADMIN 역할에게만 노출.
export const MENU = [
  { group: '견적관리', items: [
    { nav: 'quotes', label: '견적 목록', href: '#/quotes', icon: I.fileText },
    { nav: 'new', label: '견적 작성', href: '#/quotes/new', icon: I.plus },
    { nav: 'new-template', label: '템플릿 견적', href: '#/quotes/new-template', icon: I.layout },
    { nav: 'approvals', label: '승인 요청함', icon: I.inbox },
    { nav: 'dispatch', label: '발송·열람 현황', icon: I.send },
  ] },
  { group: '시뮬레이션', items: [
    { nav: 'tco', label: 'TCO 비교', icon: I.chart },
  ] },
  { group: '기준정보', items: [
    { nav: 'pricing', label: '가격정책', href: '#/pricing', icon: I.box, admin: true },
    { nav: 'master', label: '마스터 관리', href: '#/master', icon: I.grid, admin: true },
    { nav: 'customer', label: '고객사', icon: I.users },
    { nav: 'risk', label: '리스크 계수', icon: I.sliders },
    { nav: 'labor-rates', label: '노임단가', href: '#/labor-rates', icon: I.wallet, admin: true },
    { nav: 'code', label: '공통코드', icon: I.hash },
    { nav: 'term', label: '견적조건 문구', icon: I.quote },
    { nav: 'templates', label: '메일·문서 템플릿', href: '#/templates', icon: I.mail, admin: true },
  ] },
  { group: '시스템관리', items: [
    { nav: 'user', label: '사용자', icon: I.user },
    { nav: 'role', label: '역할·권한', icon: I.shield },
    { nav: 'dept', label: '조직', icon: I.building },
    { nav: 'settings', label: '설정', href: '#/settings', icon: I.settings, admin: true },
  ] },
];

export function renderSidebar(root, { isAdmin }) {
  const nav = root.querySelector('nav');
  nav.innerHTML = MENU.map(({ group, items }) => {
    const links = items
      .filter((it) => !it.admin || isAdmin)
      .map((it) => `<a href="${it.href || '#'}" data-nav="${it.nav}"${it.href ? '' : ' data-soon="1"'}>${svg(it.icon)}${it.label}</a>`)
      .join('');
    return links ? `<div class="grp">${group}</div>${links}` : '';
  }).join('');

  // 미구현 메뉴 — 라우팅하지 않고 안내만
  nav.querySelectorAll('a[data-soon]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      toast(`${a.textContent.trim()} 화면은 준비 중입니다.`, 'ok');
    });
  });
}

// 현재 라우트에 해당하는 항목을 활성 표시
export function setActiveNav(nav) {
  document.querySelectorAll('.side nav a').forEach((a) => {
    a.classList.toggle('on', a.dataset.nav === nav);
  });
}

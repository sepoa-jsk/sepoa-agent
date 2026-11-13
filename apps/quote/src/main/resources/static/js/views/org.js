import { h, clear } from '../ui.js';
import { renderCompany } from './company.js';
import { renderDepts } from './depts.js';

// 조직관리(시스템관리) — 2026-11-03 사용자 요청: "조직을 회사정보, 부서정보 입력하는 화면을 구성" → 왼쪽 목록형을 써 본 뒤 "탭을 상단으로 원복".
// 위쪽 탭 두 칸 — 회사정보(견적서 공급자 정보, company.js) | 부서정보(부서 그리드, depts.js). 각 탭은 자기 [저장] 을 가진다.
// 고른 탭은 이 브라우저 창에서 기억한다(다시 열면 그 탭부터)
const TABS = [['company', '회사정보', renderCompany], ['dept', '부서정보', renderDepts]];
const TAB_KEY = 'quote2:org-tab';

export function renderOrg(root) {
  let cur = sessionStorage.getItem(TAB_KEY) || 'company';
  if (!TABS.some(([k]) => k === cur)) cur = 'company';
  const tabs = h('div', { class: 'ss-tabs' });
  const pane = h('div', { class: 'ss-tabbox__pane', style: 'padding-top:12px' });
  root.appendChild(h('div', { class: 'ss-tabbox', style: 'flex:1 0 360px' }, tabs, pane));

  function open(key) {
    cur = key;
    sessionStorage.setItem(TAB_KEY, key);
    clear(tabs).append(...TABS.map(([k, label]) => h('button', {
      class: 'ss-tabs__tab' + (k === cur ? ' ss-tabs__tab--active' : ''), onclick: () => { if (k !== cur) open(k); } }, label)));
    clear(pane);
    TABS.find(([k]) => k === cur)[2](pane);
  }
  open(cur);
}

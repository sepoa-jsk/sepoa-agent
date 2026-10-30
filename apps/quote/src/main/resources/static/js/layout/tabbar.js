// 하단 화면 탭바 — SingleSuite 셸 공통. SUMMARY 는 고정, 그 뒤로 열어 본 화면이 쌓인다.
// 탭을 누르면 그 화면으로, × 를 누르면 탭을 닫는다(활성 탭을 닫으면 바로 앞 탭으로 간다).
// 화면 상태를 보존하지는 않는다 — 탭은 "최근 연 화면" 바로가기다.
import { toast } from '../ui.js';

const MAX_TABS = 10;
let tabs = []; // [{ key, title, hash }]
let activeKey = null;

const root = () => document.getElementById('tabbar');

// 라우터가 화면을 열 때마다 부른다
export function openTab({ key, title, hash }) {
  const found = tabs.find((t) => t.key === key);
  if (found) { found.title = title; found.hash = hash; }
  else {
    tabs.push({ key, title, hash });
    if (tabs.length > MAX_TABS) tabs.shift();
  }
  activeKey = key;
  paint();
}

export function resetTabs() {
  tabs = [];
  activeKey = null;
  paint();
}

function closeTab(key) {
  const idx = tabs.findIndex((t) => t.key === key);
  if (idx < 0) return;
  tabs.splice(idx, 1);
  window.dispatchEvent(new CustomEvent('ss:tabclose', { detail: key })); // 화면이 붙들고 있던 작성 내용을 놓는다(견적 작성)
  if (key === activeKey) {
    const next = tabs[idx - 1] || tabs[idx] || null;
    activeKey = null;
    location.hash = next ? next.hash : '#/quotes';
  }
  paint();
}

function paint() {
  const r = root();
  if (!r) return;
  r.innerHTML = '';
  const summary = document.createElement('div');
  summary.className = 'ss-tabbar__tab';
  summary.textContent = 'SUMMARY';
  summary.onclick = () => toast('SUMMARY 화면은 준비 중입니다.', 'ok');
  r.appendChild(summary);
  for (const t of tabs) {
    const tab = document.createElement('div');
    tab.className = 'ss-tabbar__tab' + (t.key === activeKey ? ' ss-tabbar__tab--active' : '');
    tab.append(t.title);
    const x = document.createElement('span');
    x.className = 'ss-tabbar__close';
    x.innerHTML = '&times;';
    x.title = '닫기';
    x.onclick = (e) => { e.stopPropagation(); closeTab(t.key); };
    tab.appendChild(x);
    tab.onclick = () => { if (location.hash !== t.hash) location.hash = t.hash; };
    r.appendChild(tab);
  }
}

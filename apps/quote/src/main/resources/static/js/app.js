const API_BASE = '/quote/api';

import { api } from './api.js';
import { toast, clear } from './ui.js';
import { renderList } from './views/list.js';
import { renderEditor } from './views/editor.js';
import { renderDetail } from './views/detail.js';
import { renderPricing } from './views/pricing.js';
import { renderSettings } from './views/settings.js';
import { renderMaster } from './views/master.js';
import { renderLaborRates } from './views/labor-rates.js';
import { renderTemplates } from './views/templates.js';
import { renderWizard } from './views/quote/wizard/index.js';
import { renderSidebar, setActiveNav } from './layout/sidebar.js';
import { setPage, setUser, PAGE_META } from './layout/gnb.js';
import { openTab, resetTabs } from './layout/tabbar.js';

export const store = {
  user: null,
  // 새 라우트: { solutions, deployments, company_classes, service_types,
  //   modules, labor_roles, labor_rates, thirdparty }. 예전 pricing.js 라우트는
  //   companyClasses(캐멀)을 줬으므로, 기존 화면 호환을 위해 별칭을 채운다.
  master: null,
  async getMaster() {
    if (!this.master) {
      const data = await api.master();
      // 하위호환: 새 API 는 company_classes(스네이크)만 준다. 기존 화면이
      // master.companyClasses(캐멀)을 참조해도 깨지지 않게 별칭을 채운다.
      if (data && data.company_classes && !data.companyClasses) {
        data.companyClasses = data.company_classes;
      }
      this.master = data;
    }
    return this.master;
  },
  companyClasses(solution, deployment) {
    const list = this.master?.company_classes || this.master?.companyClasses || [];
    return list.filter(
      (c) => c.solution === solution && c.deployment === deployment
    );
  },
  solutionName(code) { return this.master?.solutions.find((s) => s.code === code)?.name || code; },
  deploymentName(code) { return this.master?.deployments.find((d) => d.code === code)?.name || code; },
};

const viewEl = () => document.getElementById('view');

const routes = [
  // 견적 작성 경로는 위저드 하나다. 템플릿 견적 화면(quote-block.js)은 작업 10 에서 폐기했다.
  { re: /^#\/quotes\/new$/, view: () => renderWizard(viewEl()) },
  // 편집은 아직 위저드로 넘기지 못했다. editor.js 는 섹션형 전용이므로 블록형은 가드로 막는다.
  { re: /^#\/quotes\/(\d+)\/edit$/, view: (m) => openEdit(viewEl(), Number(m[1])) },
  { re: /^#\/quotes\/(\d+)$/, view: (m) => renderDetail(viewEl(), Number(m[1])) },
  { re: /^#\/quotes$/, view: () => renderList(viewEl()) },
  { re: /^#\/master$/, admin: true, view: () => renderMaster(viewEl()) },
  { re: /^#\/pricing$/, admin: true, view: () => renderPricing(viewEl()) },
  { re: /^#\/labor-rates$/, admin: true, view: () => renderLaborRates(viewEl()) },
  { re: /^#\/templates$/, admin: true, view: () => renderTemplates(viewEl()) },
  { re: /^#\/settings$/, admin: true, view: () => renderSettings(viewEl()) },
];

// 편집 진입 가드.
//   editor.js 는 섹션형(sq_quote_sections) 에디터이고 위저드는 블록형(sq_quote_blocks)이다.
//   블록형 견적을 editor.js 로 열어 저장하면 섹션을 지우고 다시 넣으므로 블록에 달린
//   품목·인건비가 유실된다. 그래서 블록이 있는 견적은 editor.js 로 보내지 않는다.
//   (현재 editor.js 는 deployment !== 'ONPREM' 이면 본문도 저장버튼도 렌더하지 않아
//    실제로는 도달 전에 막히지만, 그 방어에 기대지 않고 여기서 명시적으로 막는다)
//   위저드 편집 모드가 생기면 이 함수가 위저드로 넘기는 자리가 된다.
async function openEdit(el, id) {
  let quote = null;
  try { ({ quote } = await api.getQuote(id)); }
  catch (err) { toast(err.message, 'err'); location.hash = '#/quotes'; return; }
  if (!quote) { toast('견적을 찾을 수 없습니다.', 'err'); location.hash = '#/quotes'; return; }
  if ((quote.blocks || []).length) {
    toast('이 견적은 편집 준비 중입니다. 블록형 견적 편집은 위저드 편집 모드에서 지원합니다.', 'err');
    location.hash = `#/quotes/${id}`;
    return;
  }
  return renderEditor(el, { mode: 'edit', id });
}

async function router() {
  const hash = location.hash || '#/quotes';
  const nav = hash.startsWith('#/quotes/new') ? 'new'
    : hash.startsWith('#/quotes') ? 'quotes'
    : hash.startsWith('#/master') ? 'master'
    : hash.startsWith('#/pricing') ? 'pricing'
    : hash.startsWith('#/labor-rates') ? 'labor-rates'
    : hash.startsWith('#/templates') ? 'templates'
    : hash.startsWith('#/settings') ? 'settings' : 'quotes';
  setActiveNav(nav);
  // 상세는 별도 메타. 화면이 액션 버튼을 올리면 렌더 중 setPage({actions}) 로 덮어쓴다.
  const metaKey = /^#\/quotes\/\d+$/.test(hash) ? 'detail' : nav;
  const meta = PAGE_META[metaKey] || PAGE_META.quotes;
  setPage({ title: meta.title, path: meta.path, actions: [] });
  // 하단 탭바 — 견적 상세는 견적마다 탭이 따로 생긴다
  const detailId = hash.match(/^#\/quotes\/(\d+)/)?.[1];
  openTab({ key: detailId ? `quote:${detailId}` : nav, title: meta.title, hash });

  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) {
      if (r.admin && store.user.role !== 'ADMIN') {
        toast('관리자 권한이 필요합니다.', 'err');
        location.hash = '#/quotes';
        return;
      }
      try {
        clear(viewEl());
        await r.view(m);
      } catch (err) {
        if (err.status === 401) return showLogin();
        viewEl().innerHTML = `<div class="empty">오류: ${err.message}</div>`;
        toast(err.message, 'err');
      }
      return;
    }
  }
  location.hash = '#/quotes';
}

// ── 로그인 ──
function showLogin(errorMsg) {
  document.getElementById('app-shell').classList.add('hidden');
  const gate = document.getElementById('login-gate');
  gate.classList.remove('hidden');
  const errBox = document.getElementById('login-error');
  if (errorMsg) { errBox.textContent = errorMsg; errBox.classList.remove('hidden'); }
  else errBox.classList.add('hidden');
}

function showApp() {
  document.getElementById('login-gate').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  const u = store.user;
  renderSidebar(null, { isAdmin: u.role === 'ADMIN' });
  setUser(u);
}

async function bootstrap() {
  // 로그아웃
  document.getElementById('logout-btn').onclick = async () => {
    await api.logout();
    store.user = null; store.master = null;
    resetTabs();
    location.hash = '';
    showLogin();
  };

  // GNB 로고·홈 → 견적 목록
  for (const id of ['gnb-home', 'gnb-home-logo']) {
    document.getElementById(id).onclick = () => { location.hash = '#/quotes'; };
  }

  // dev 로그인
  const devForm = document.getElementById('login-dev');
  devForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const email = document.getElementById('dev-email').value.trim();
      const { user } = await api.devLogin(email);
      store.user = user;
      await afterLogin();
    } catch (err) { showLogin(err.message); }
  };

  try {
    const { user, authMode } = await api.me();
    store.user = user;
    await afterLogin(authMode);
  } catch {
    // 미인증 → 로그인 게이트. authMode 확인 위해 health 호출
    try {
      const info = await api.get('/api/health');
      setupLoginMode(info.authMode);
    } catch { setupLoginMode('dev'); }
    showLogin();
  }
}

function setupLoginMode(authMode) {
  if (authMode === 'dev') {
    document.getElementById('login-dev').classList.remove('hidden');
  } else {
    document.getElementById('login-google').classList.remove('hidden');
    document.getElementById('google-btn').innerHTML =
      '<p class="login-hint">Google 로그인 버튼은 Client ID 설정 후 활성화됩니다.</p>';
  }
}

async function afterLogin() {
  showApp();
  await store.getMaster();
  if (!location.hash || location.hash === '#/') location.hash = '#/quotes';
  else router();
  toast(`${store.user.name || store.user.email}님 환영합니다.`, 'ok');
}

window.addEventListener('hashchange', router);
bootstrap();

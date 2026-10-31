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
import { renderCustomers } from './views/customers.js';
import { renderConditions } from './views/conditions.js';
import { renderRisk } from './views/risk.js';
import { renderTco } from './views/tco.js';
import { renderDispatch } from './views/dispatch.js';
import { renderUsers } from './views/users.js';
import { renderDepts } from './views/depts.js';
import { renderRoles } from './views/roles.js';
import { renderWizard } from './views/quote/wizard/index.js';
import { renderSidebar, setActiveNav, canOpen } from './layout/sidebar.js';
import { setPage, setUser, PAGE_META } from './layout/gnb.js';
import { openTab, resetTabs } from './layout/tabbar.js';

export const store = {
  user: null,
  perms: null, // 업무 역할의 메뉴 권한 {nav: 'RCUD'} — 없으면 null(예전처럼 관리자 메뉴만 숨김)
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
  // 편집 — 블록형 견적은 위저드 수정 모드, 섹션형(구 견적)은 editor.js.
  { re: /^#\/quotes\/(\d+)\/edit$/, view: (m) => openEdit(viewEl(), Number(m[1])) },
  { re: /^#\/quotes\/(\d+)$/, view: (m) => openDetail(viewEl(), Number(m[1])) },
  { re: /^#\/quotes$/, view: () => renderList(viewEl()) },
  { re: /^#\/master$/, admin: true, view: () => renderMaster(viewEl()) },
  { re: /^#\/pricing$/, admin: true, view: () => renderPricing(viewEl()) },
  { re: /^#\/customers$/, admin: true, view: () => renderCustomers(viewEl()) },
  { re: /^#\/labor-rates$/, admin: true, view: () => renderLaborRates(viewEl()) },
  { re: /^#\/templates$/, admin: true, view: () => renderTemplates(viewEl()) },
  { re: /^#\/conditions$/, admin: true, view: () => renderConditions(viewEl()) },
  { re: /^#\/risk$/, admin: true, view: () => renderRisk(viewEl()) },
  { re: /^#\/tco$/, view: () => renderTco(viewEl()) },
  { re: /^#\/dispatch$/, view: () => renderDispatch(viewEl()) },
  { re: /^#\/users$/, admin: true, view: () => renderUsers(viewEl()) },
  { re: /^#\/depts$/, admin: true, view: () => renderDepts(viewEl()) },
  { re: /^#\/roles$/, admin: true, view: () => renderRoles(viewEl()) },
  { re: /^#\/settings$/, admin: true, view: () => renderSettings(viewEl()) },
];

// 편집 진입 가드.
//   editor.js 는 섹션형(sq_quote_sections) 에디터이고 위저드는 블록형(sq_quote_blocks)이다.
//   블록형 견적을 editor.js 로 열어 저장하면 섹션을 지우고 다시 넣으므로 블록에 달린
//   품목·인건비가 유실된다. 그래서 블록이 있는 견적은 editor.js 로 보내지 않는다.
//   (현재 editor.js 는 deployment !== 'ONPREM' 이면 본문도 저장버튼도 렌더하지 않아
//    실제로는 도달 전에 막히지만, 그 방어에 기대지 않고 여기서 명시적으로 막는다)
//   블록형은 위저드 수정 모드(renderWizard(el, { quote }))로 연다.
async function openEdit(el, id) {
  let quote = null;
  try { ({ quote } = await api.getQuote(id)); }
  catch (err) { toast(err.message, 'err'); location.hash = '#/quotes'; return; }
  if (!quote) { toast('견적을 찾을 수 없습니다.', 'err'); location.hash = '#/quotes'; return; }
  if ((quote.blocks || []).length) return renderWizard(el, { quote });
  return renderEditor(el, { mode: 'edit', id });
}

// 상세 — 블록형 견적은 견적 작성 화면을 읽기 전용으로 연다(작성 · 수정 · 상세가 같은 단계 화면).
//   구 섹션형 견적(블록 없음)은 위저드로 그릴 수 없어 예전 상세 화면(detail.js)을 쓴다.
async function openDetail(el, id) {
  let quote = null;
  try { ({ quote } = await api.getQuote(id)); }
  catch (err) { toast(err.message, 'err'); location.hash = '#/quotes'; return; }
  if (!quote) { toast('견적을 찾을 수 없습니다.', 'err'); location.hash = '#/quotes'; return; }
  if ((quote.blocks || []).length) return renderWizard(el, { quote, readOnly: true });
  return renderDetail(el, id);
}

async function router() {
  const hash = location.hash || '#/quotes';
  const nav = hash.startsWith('#/quotes/new') || /^#\/quotes\/\d+\/edit$/.test(hash) ? 'new'
    : hash.startsWith('#/quotes') ? 'quotes'
    : hash.startsWith('#/master') ? 'master'
    : hash.startsWith('#/pricing') ? 'pricing'
    : hash.startsWith('#/customers') ? 'customer'
    : hash.startsWith('#/labor-rates') ? 'labor-rates'
    : hash.startsWith('#/templates') ? 'templates'
    : hash.startsWith('#/conditions') ? 'term'
    : hash.startsWith('#/risk') ? 'risk'
    : hash.startsWith('#/tco') ? 'tco'
    : hash.startsWith('#/dispatch') ? 'dispatch'
    : hash.startsWith('#/users') ? 'user'
    : hash.startsWith('#/depts') ? 'dept'
    : hash.startsWith('#/roles') ? 'role'
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
      // 관리자는 모두 연다. 그 밖에는 업무 역할의 '조회' 권한(없으면 예전처럼 관리자 화면만 막는다)
      const ctx = { isAdmin: store.user.role === 'ADMIN', perms: store.perms };
      if (!canOpen(nav, ctx) || (r.admin && !ctx.isAdmin && !store.perms)) {
        toast(r.admin && !store.perms ? '관리자 권한이 필요합니다.' : '이 메뉴를 열 권한이 없습니다.', 'err');
        if (hash !== '#/quotes' && canOpen('quotes', ctx)) location.hash = '#/quotes';
        else clear(viewEl());
        return;
      }
      try {
        clear(viewEl());
        // 레일 머리가 화면 제목을 맡는 화면(마스터 관리)이 숨긴 셸 제목 바를 되돌린다
        document.querySelector('.ss-app')?.classList.remove('ss-app--railtitle');
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
  renderSidebar(null, { isAdmin: u.role === 'ADMIN', perms: store.perms });
  setUser(u);
}

async function bootstrap() {
  // 로그아웃
  document.getElementById('logout-btn').onclick = async () => {
    await api.logout();
    store.user = null; store.master = null; store.perms = null;
    resetTabs();
    location.hash = '';
    showLogin();
  };

  // GNB 로고·홈 → 견적 목록
  document.getElementById('gnb-home-logo').onclick = () => { location.hash = '#/quotes'; };
  document.getElementById('gnb-help').onclick = () => toast('도움말은 준비 중입니다.', 'ok');

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
  try { store.perms = (await api.myMenus()).perms || null; } catch { store.perms = null; }
  showApp();
  await store.getMaster();
  if (!location.hash || location.hash === '#/') location.hash = '#/quotes';
  else router();
  toast(`${store.user.name || store.user.email}님 환영합니다.`, 'ok');
}

window.addEventListener('hashchange', router);
bootstrap();

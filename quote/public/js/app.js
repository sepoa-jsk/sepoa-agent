const API_BASE = '/quote/api';

import { api } from './api.js';
import { toast, clear } from './ui.js';
import { renderList } from './views/list.js';
import { renderEditor } from './views/editor.js';
import { renderDetail } from './views/detail.js';
import { renderPricing } from './views/pricing.js';
import { renderSettings } from './views/settings.js';
import { renderMaster } from './views/master.js';

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
  { re: /^#\/quotes\/new$/, view: () => renderEditor(viewEl(), { mode: 'new' }) },
  { re: /^#\/quotes\/(\d+)\/edit$/, view: (m) => renderEditor(viewEl(), { mode: 'edit', id: Number(m[1]) }) },
  { re: /^#\/quotes\/(\d+)$/, view: (m) => renderDetail(viewEl(), Number(m[1])) },
  { re: /^#\/quotes$/, view: () => renderList(viewEl()) },
  { re: /^#\/master$/, admin: true, view: () => renderMaster(viewEl()) },
  { re: /^#\/pricing$/, admin: true, view: () => renderPricing(viewEl()) },
  { re: /^#\/settings$/, admin: true, view: () => renderSettings(viewEl()) },
];

async function router() {
  const hash = location.hash || '#/quotes';
  const nav = hash.startsWith('#/quotes/new') ? 'new'
    : hash.startsWith('#/quotes') ? 'quotes'
    : hash.startsWith('#/master') ? 'master'
    : hash.startsWith('#/pricing') ? 'pricing'
    : hash.startsWith('#/settings') ? 'settings' : 'quotes';
  document.querySelectorAll('.sidebar-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === nav);
  });

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
  document.getElementById('user-name').textContent = u.name || u.email;
  document.getElementById('user-role').textContent = u.role === 'ADMIN' ? '관리자' : '사용자';
  document.getElementById('user-avatar').textContent = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
  document.querySelectorAll('[data-admin]').forEach((el) => {
    el.classList.toggle('hidden', u.role !== 'ADMIN');
  });
}

async function bootstrap() {
  // 로그아웃
  document.getElementById('logout-btn').onclick = async () => {
    await api.logout();
    store.user = null; store.master = null;
    location.hash = '';
    showLogin();
  };

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

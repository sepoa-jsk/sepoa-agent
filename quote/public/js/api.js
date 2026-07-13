// API 래퍼 — 세션 쿠키 기반. 오류 시 {status, error, message} throw.

// 게이트웨이가 /quote/ 경로 아래로 라우팅하므로 모든 요청에 prefix를 붙인다.
const BASE = '/quote';

async function req(method, path, body) {
  const url = BASE + path;
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);

  // 세션 만료 시 로그인으로. 단, 인증 관련 호출은 예외(무한 리다이렉트 방지).
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    location.href = `${BASE}/`;
    return null;
  }

  if (res.status === 204) return null;

  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.message) || `요청 실패 (${res.status})`);
    err.status = res.status;
    err.code = data && data.error;
    throw err;
  }
  return data;
}

// undefined/null 값을 제거한 쿼리스트링 생성
function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b),
  put: (u, b) => req('PUT', u, b),
  patch: (u, b) => req('PATCH', u, b),
  del: (u) => req('DELETE', u),

  // 인증
  me: () => req('GET', '/api/auth/me'),
  devLogin: (email) => req('POST', '/api/auth/dev-login', { email }),
  googleLogin: (credential) => req('POST', '/api/auth/google', { credential }),
  logout: () => req('POST', '/api/auth/logout'),

  // 마스터/가격
  master: () => req('GET', '/api/master'),
  pricing: (solution, deployment, all) =>
    req('GET', `/api/pricing${qs({ solution, deployment, all: all ? '1' : undefined })}`),

  // 견적
  calculate: (payload) => req('POST', '/api/quotes/calculate', payload),
  createQuote: (payload) => req('POST', '/api/quotes', payload),
  listQuotes: (params) => req('GET', `/api/quotes${qs(params)}`),
  getQuote: (id) => req('GET', `/api/quotes/${id}`),
  updateQuote: (id, payload) => req('PUT', `/api/quotes/${id}`, payload),
  setStatus: (id, status) => req('PATCH', `/api/quotes/${id}/status`, { status }),
  deleteQuote: (id) => req('DELETE', `/api/quotes/${id}`),
  excelUrl: (id) => `${BASE}/api/quotes/${id}/excel`,

  // 설정
  getSettings: () => req('GET', '/api/settings'),
  putSettings: (settings) => req('PUT', '/api/settings', { settings }),
};
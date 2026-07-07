// API 래퍼 — 세션 쿠키 기반. 오류 시 {status, error, message} throw.
async function req(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
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
  pricing: (solution, deployment, all) => {
    const q = new URLSearchParams();
    if (solution) q.set('solution', solution);
    if (deployment) q.set('deployment', deployment);
    if (all) q.set('all', '1');
    return req('GET', `/api/pricing?${q}`);
  },

  // 견적
  calculate: (payload) => req('POST', '/api/quotes/calculate', payload),
  createQuote: (payload) => req('POST', '/api/quotes', payload),
  listQuotes: (params) => req('GET', `/api/quotes?${new URLSearchParams(params)}`),
  getQuote: (id) => req('GET', `/api/quotes/${id}`),
  updateQuote: (id, payload) => req('PUT', `/api/quotes/${id}`, payload),
  setStatus: (id, status) => req('PATCH', `/api/quotes/${id}/status`, { status }),
  deleteQuote: (id) => req('DELETE', `/api/quotes/${id}`),
  excelUrl: (id) => `/api/quotes/${id}/excel`,

  // 설정
  getSettings: () => req('GET', '/api/settings'),
  putSettings: (settings) => req('PUT', '/api/settings', { settings }),
};

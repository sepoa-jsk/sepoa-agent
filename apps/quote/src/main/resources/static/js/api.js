// API 래퍼 — 세션 쿠키 기반. 오류 시 {status, error, message} throw.

// Java 앱의 context-path 가 /quote2 라 모든 요청에 prefix를 붙인다.
// 게이트웨이(:8080/quote2/)와 직접 접속(:3200/quote2/) 모두 같은 경로다.
// J9 에서 /quote 를 Java 로 전환할 때 이 값도 함께 바꾼다.
const BASE = '/quote2';

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
  createPriceItem: (body) => req('POST', '/api/pricing/items', body),
  updatePriceItem: (id, body) => req('PUT', `/api/pricing/items/${id}`, body),
  deletePriceItem: (id) => req('DELETE', `/api/pricing/items/${id}`),
  // 가격정책 버전 이력(V7) — 현재 버전 + 이력 / 한 버전 / 새 버전
  pricePolicy: (solution, deployment = 'SAAS') => req('GET', `/api/pricing/policy${qs({ solution, deployment })}`),
  pricePolicyVersion: (id) => req('GET', `/api/pricing/policy/${id}`),
  savePricePolicy: (body) => req('POST', '/api/pricing/policy', body),

  // 견적
  calculate: (payload) => req('POST', '/api/quotes/calculate', payload),
  previewQuote: (body) => req('POST', '/api/quotes/preview', body),
  createQuote: (payload) => req('POST', '/api/quotes', payload),
  listQuotes: (params) => req('GET', `/api/quotes${qs(params)}`),
  getQuote: (id) => req('GET', `/api/quotes/${id}`),
  updateQuote: (id, payload) => req('PUT', `/api/quotes/${id}`, payload),
  setStatus: (id, status) => req('PATCH', `/api/quotes/${id}/status`, { status }),
  deleteQuote: (id) => req('DELETE', `/api/quotes/${id}`),
  copyQuote: (id) => req('POST', `/api/quotes/${id}/copy`),
  quoteHtml: (id) => req('GET', `/api/quotes/${id}/html`),
  mailConfig: () => req('GET', '/api/quotes/mail-config'),
  mailQuote: (id, body) => req('POST', `/api/quotes/${id}/mail`, body),
  excelUrl: (id) => `${BASE}/api/quotes/${id}/excel`,
  pdfUrl: (id) => `${BASE}/api/quotes/${id}/pdf`,

  // 임금단가(개발인건비)
  laborYears: () => req('GET', '/api/labor-rates/years'),
  laborRates: (year) => req('GET', '/api/labor-rates' + (year ? `?year=${year}` : '')),
  createLaborYear: (body) => req('POST', '/api/labor-rates/years', body),
  updateLaborRate: (id, body) => req('PUT', `/api/labor-rates/${id}`, body),
  setActiveLaborYear: (id) => req('PATCH', `/api/labor-rates/years/${id}/active`),
  // 단가표 PDF 읽기(저장 안 함) — 파일이라 JSON 이 아니라 FormData 로 보낸다
  parseLaborSheet: async (year, file) => {
    const fd = new FormData();
    fd.append('year', year);
    fd.append('file', file);
    const res = await fetch(`${BASE}/api/labor-rates/parse`, { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || `요청 실패 (${res.status})`); e.status = res.status; throw e; }
    return data;
  },
  importLaborRates: (body) => req('POST', '/api/labor-rates/import', body),

  // 블록/견적조건/템플릿
  blocks: () => req('GET', '/api/blocks'),
  conditions: () => req('GET', '/api/conditions'),
  // 견적조건 문구 관리(기준정보) — 세트 목록(문장 · 쓰는 곳 포함) / 세트 저장(없으면 생성) / 삭제
  conditionSets: () => req('GET', '/api/condition-sets'),
  saveConditionSet: (code, body) => req('PUT', `/api/condition-sets/${encodeURIComponent(code)}`, body),
  deleteConditionSet: (code) => req('DELETE', `/api/condition-sets/${encodeURIComponent(code)}`),
  // templates() / templates('SEAL') / templates({ quote_type:'BUILD', solution:'SEAL' })
  templates: (opt) => {
    const p = typeof opt === 'string' ? { solution: opt } : (opt || {});
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '')).toString();
    return req('GET', '/api/templates' + (qs ? `?${qs}` : ''));
  },
  templateDetail: (code) => req('GET', `/api/templates/${encodeURIComponent(code)}`),
  createTemplate: (body) => req('POST', '/api/templates', body),
  updateTemplate: (id, body) => req('PUT', `/api/templates/${id}`, body),
  applyTemplate: (template_code) => req('POST', '/api/quotes/apply-template', { template_code }),

  // 시스템관리 — 사용자 · 조직 · 역할·권한(V10) · 발송 이력
  users: () => req('GET', '/api/users'),
  updateUser: (id, body) => req('PUT', `/api/users/${id}`, body),
  depts: () => req('GET', '/api/depts'),
  createDept: (body) => req('POST', '/api/depts', body),
  updateDept: (id, body) => req('PUT', `/api/depts/${id}`, body),
  deleteDept: (id) => req('DELETE', `/api/depts/${id}`),
  roles: () => req('GET', '/api/roles'),
  saveRole: (code, body) => req('PUT', `/api/roles/${encodeURIComponent(code)}`, body),
  deleteRole: (code) => req('DELETE', `/api/roles/${encodeURIComponent(code)}`),
  myMenus: () => req('GET', '/api/roles/mine'),
  dispatch: (params) => req('GET', `/api/dispatch${qs(params)}`),

  // 설정
  getSettings: () => req('GET', '/api/settings'),
  putSettings: (settings) => req('PUT', '/api/settings', { settings }),

  // 마스터 (신규 CRUD)
  masterAll: () => req('GET', '/api/master'),
  masterList: (type, solution) =>
    req('GET', `/api/master/${type}${solution ? '?solution=' + encodeURIComponent(solution) : ''}`),
  masterCreate: (type, row) => req('POST', `/api/master/${type}`, row),
  masterUpdate: (type, id, row) => req('PUT', `/api/master/${type}/${id}`, row),
  masterDelete: (type, id) => req('DELETE', `/api/master/${type}/${id}`),
};
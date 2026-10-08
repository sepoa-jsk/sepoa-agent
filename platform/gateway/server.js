'use strict';
/**
 * 사내 업무 플랫폼 게이트웨이 — 경로만 나눠 주는 얇은 리버스 프록시.
 *
 * 브라우저 → :8080/<업무경로>/... → 각 업무 앱의 자기 포트
 *
 * - 업무 목록·포트·경로는 ../ports.json 한 곳에서만 읽는다. 여기에 업무를 하드코딩하지 않는다.
 * - 업무 앱을 이 프로세스 안에 직접 넣지(mount) 않는다. 앱마다 독립 프로세스로 띄우고
 *   여기서는 HTTP 로 넘겨주기만 한다. 앱 하나를 재시작해도 다른 업무는 영향이 없다.
 * - 의존성 0. Node 내장 http 만 쓴다 (폐쇄망 배포에서 설치할 것이 없다).
 * - 운영에서는 이 파일 대신 nginx/httpd 를 둘 수 있다. 규칙은 ports.json 과 같다.
 *
 * 실패를 삼키지 않는다 — 업무 앱이 꺼져 있으면 502 와 함께 어느 앱인지·어떻게 띄우는지 돌려준다.
 *
 * 로그인(SSO)은 아직 여기서 하지 않는다. ROADMAP 의 공통 인증 단계에서 이 게이트웨이가
 * Google SSO 를 처리하고 X-Auth-User-* 헤더로 사용자를 넘기도록 바꾼다 (docs/STANDARDS.md 3장).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.PORTS_FILE || path.join(__dirname, '..', 'ports.json');

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const routes = (cfg.apps || [])
    .filter((a) => a.enabled !== false && a.path)
    .map((a) => ({ ...a, host: a.host || process.env[`${a.id.toUpperCase()}_HOST`] || '127.0.0.1' }))
    // 긴 경로부터 맞춘다 (/quote2 가 /quote 에 먼저 걸리지 않도록)
    .sort((x, y) => y.path.length - x.path.length);
  return { cfg, routes };
}

let { cfg, routes } = loadConfig();
const PORT = Number(process.env.GATEWAY_PORT) || (cfg.gateway && cfg.gateway.port) || 8080;

/** /quote2/x 는 /quote2 에, /quote/x 는 /quote 에. /quoteX 는 어디에도 맞지 않는다. */
function matchRoute(url) {
  const p = url.split('?')[0];
  return routes.find((r) => p === r.path || p.startsWith(r.path + '/'));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 업무 앱의 health 를 짧게 확인한다. health 가 없는 앱은 '/' 응답 여부로 본다. */
function probe(app) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: app.host || '127.0.0.1', port: app.port, method: 'GET', path: app.health || (app.stripPrefix ? '/' : app.path + '/'), timeout: 1500 },
      (r) => { r.resume(); resolve({ up: r.statusCode < 500, status: r.statusCode }); }
    );
    req.on('timeout', () => { req.destroy(); resolve({ up: false, error: 'TIMEOUT' }); });
    req.on('error', (e) => resolve({ up: false, error: e.code }));
    req.end();
  });
}

async function statusAll() {
  const all = [...(cfg.apps || []), ...(cfg.internal || [])].filter((a) => a.enabled !== false);
  const results = await Promise.all(all.map(async (a) => ({
    id: a.id, name: a.name, path: a.path || null, port: a.port, stack: a.stack,
    ...(await probe({ ...a, host: a.host || '127.0.0.1' })),
  })));
  return results;
}

async function renderHome(res) {
  const st = await statusAll();
  const byId = Object.fromEntries(st.map((s) => [s.id, s]));
  const rows = (cfg.apps || []).map((a) => {
    const s = byId[a.id];
    const state = a.enabled === false ? '준비중' : s && s.up ? '실행중' : '꺼짐';
    const link = a.enabled === false ? escapeHtml(a.path) : `<a href="${escapeHtml(a.path)}/">${escapeHtml(a.path)}/</a>`;
    return `<tr><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.dept || '')}</td><td>${link}</td><td>${a.port}</td><td>${escapeHtml(a.stack)}</td><td class="${state === '실행중' ? 'ok' : 'off'}">${state}</td></tr>`;
  }).join('');
  const internal = (cfg.internal || []).map((a) => {
    const s = byId[a.id];
    return `<tr><td>${escapeHtml(a.name)}</td><td>내부</td><td>-</td><td>${a.port}</td><td>${escapeHtml(a.stack)}</td><td class="${s && s.up ? 'ok' : 'off'}">${s && s.up ? '실행중' : '꺼짐'}</td></tr>`;
  }).join('');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>세포아 사내 업무 플랫폼</title>
<style>body{font:13px Pretendard,'Malgun Gothic',sans-serif;color:#172B4D;background:#F4F5F7;margin:0;padding:24px}
h1{font-size:16px;margin:0 0 12px}table{border-collapse:collapse;background:#fff;min-width:640px}
th,td{border:1px solid #DFE1E6;padding:6px 10px;text-align:left}th{background:#F4F5F7;color:#5E6C84;font-weight:600}
a{color:#0747A6}.ok{color:#00875A;font-weight:600}.off{color:#8993A4}</style></head><body>
<h1>세포아 사내 업무 플랫폼</h1>
<table><thead><tr><th>업무</th><th>부서</th><th>경로</th><th>포트</th><th>스택</th><th>상태</th></tr></thead>
<tbody>${rows}${internal}</tbody></table>
<p style="color:#5E6C84">상태 JSON: <a href="/__gateway/status">/__gateway/status</a> · 설정: platform/ports.json</p>
</body></html>`);
}

function proxy(req, res, route) {
  const upstreamPath = route.stripPrefix ? (req.url.slice(route.path.length) || '/') : req.url;
  const fixedPath = upstreamPath.startsWith('/') ? upstreamPath : '/' + upstreamPath;
  const xfFor = [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');

  const upstream = http.request(
    {
      host: route.host,
      port: route.port,
      method: req.method,
      path: fixedPath,
      headers: {
        ...req.headers,
        host: req.headers.host || `${route.host}:${route.port}`,
        'x-forwarded-for': xfFor,
        'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'http',
        'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host || '',
        'x-forwarded-prefix': route.stripPrefix ? route.path : '',
      },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    console.error(`[gateway] ${route.id} ${req.method} ${req.url} → ${err.code}: ${err.message}`);
    if (res.headersSent) return res.destroy();
    sendJson(res, 502, {
      status: 'DOWN',
      error: 'BadGateway',
      app: route.id,
      message: `${route.name}(${route.host}:${route.port})에 연결하지 못했습니다 — ${err.code}`,
      hint: `${route.dir} 에서 '${route.start}' 로 기동했는지 확인하십시오. 전체 기동은 레포 루트의 dev.ps1`,
    });
  });

  req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url === '/index.html') return await renderHome(res);
    if (req.url.startsWith('/__gateway/status')) return sendJson(res, 200, { gateway: 'UP', apps: await statusAll() });
    if (req.url.startsWith('/__gateway/reload')) {
      ({ cfg, routes } = loadConfig());
      return sendJson(res, 200, { reloaded: true, routes: routes.map((r) => r.path) });
    }
    const route = matchRoute(req.url);
    if (!route) return sendJson(res, 404, { error: 'NotFound', message: `등록된 업무 경로가 아닙니다: ${req.url.split('?')[0]}`, routes: routes.map((r) => r.path) });
    // 슬래시 없는 업무 루트(/blog)는 /blog/ 로 보낸다 — 상대 경로 자원(api/..., css/...)이 맞게 풀리도록
    if (req.url.split('?')[0] === route.path && route.stripPrefix) {
      res.writeHead(301, { location: route.path + '/' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '') });
      return res.end();
    }
    return proxy(req, res, route);
  } catch (e) {
    console.error('[gateway] 내부 오류', e);
    if (!res.headersSent) sendJson(res, 500, { error: 'GatewayError', message: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('\n[세포아 사내 업무 플랫폼 게이트웨이]');
    console.log(`  홈:   http://localhost:${PORT}/`);
    for (const r of [...routes].sort((a, b) => a.path.localeCompare(b.path))) {
      console.log(`  ${r.name.padEnd(16)} http://localhost:${PORT}${r.path}/  → ${r.host}:${r.port}${r.stripPrefix ? '' : ' (경로 유지)'}`);
    }
    console.log('');
  });
}

module.exports = { server, matchRoute: (u) => matchRoute(u) };

'use strict';
require('dotenv').config();

const http = require('http');
const express = require('express');

const blogApp = require('./blog-automation/web-console/server');
const quoteApp = require('./quote/server');

const app = express();
const PORT = Number(process.env.GATEWAY_PORT) || 8080;

// Java 이식본(quote_automation)의 기동 포트. application-dev.yml 의 JAVA_PORT 와 맞춘다.
const JAVA_PORT = Number(process.env.JAVA_PORT) || 3200;
const JAVA_HOST = process.env.JAVA_HOST || '127.0.0.1';

app.get('/', (req, res) => {
  res.type('html').send(
    '<h1>Sepoa Agent</h1><ul>' +
      '<li><a href="/blog/">블로그 자동화 콘솔</a></li>' +
      '<li><a href="/quote/">견적 시스템 (Node)</a></li>' +
      '<li><a href="/quote2/api/health">견적 시스템 (Java 이식본)</a></li>' +
      '</ul>'
  );
});

app.use('/blog', blogApp);
app.use('/quote', quoteApp);

// ── /quote2 → Java 앱 프록시 ────────────────────────────────────────────────
// Node(/quote)와 Java(/quote2)를 나란히 띄워 J5 병행 대조에 쓴다.
// http-proxy-middleware 를 쓰지 않는 것은 폐쇄망 배포에서 의존성을 늘리지 않기 위함이다.
//
// 실패를 삼키지 않는다 — Java 앱이 떠 있지 않으면 502 와 함께 원인을 돌려준다.
// 빈 응답이나 타임아웃으로 조용히 끝내면 "Java 쪽이 안 뜬 것"과 "프록시가 깨진 것"을
// 구분할 수 없다(docs/LESSONS.md).
app.use('/quote2', (req, res) => {
  // express 가 마운트 경로(/quote2)를 잘라내므로 다시 붙인다.
  // Java 쪽 context-path 가 /quote2 라 경로가 그대로 맞아야 한다.
  const upstream = http.request(
    {
      host: JAVA_HOST,
      port: JAVA_PORT,
      method: req.method,
      path: '/quote2' + req.url,
      headers: { ...req.headers, host: `${JAVA_HOST}:${JAVA_PORT}` },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    console.error(`[quote2 프록시] ${req.method} ${req.url} → ${err.code}: ${err.message}`);
    if (res.headersSent) return res.destroy();
    res.status(502).json({
      status: 'DOWN',
      error: 'BadGateway',
      message: `Java 앱(${JAVA_HOST}:${JAVA_PORT})에 연결하지 못했습니다 — ${err.code}`,
      hint: 'quote_automation 에서 ./mvnw spring-boot:run 으로 기동했는지 확인하십시오.',
    });
  });

  req.pipe(upstream);
});

app.listen(PORT, () => {
  console.log('\n[Sepoa Agent 통합 서버 실행 중]');
  console.log('  루트:        http://localhost:' + PORT + '/');
  console.log('  블로그:      http://localhost:' + PORT + '/blog/');
  console.log('  견적(Node):  http://localhost:' + PORT + '/quote/');
  console.log('  견적(Java):  http://localhost:' + PORT + '/quote2/  → ' + JAVA_HOST + ':' + JAVA_PORT + '\n');
});

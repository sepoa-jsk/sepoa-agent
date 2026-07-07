'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const { sessionMiddleware, AUTH_MODE } = require('./lib/auth');
const { pool } = require('./lib/db');

const app = express();
const PORT = Number(process.env.PORT) || 3100;

// nginx 등 리버스 프록시 뒤에 있을 때 (TRUST_PROXY=true) secure 쿠키/프로토콜 인식
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware());

// 정적 프론트엔드 (Phase 3)
app.use(express.static(path.join(__dirname, 'public')));

// 헬스체크
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, authMode: AUTH_MODE });
  } catch (err) {
    res.status(500).json({ ok: false, db: err.message });
  }
});

// 라우트
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/pricing'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/settings', require('./routes/settings'));

// 404 (API)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: `${req.method} ${req.originalUrl}` });
});

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'INTERNAL', message: err.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`quote 서버 실행 중 — http://localhost:${PORT} (AUTH_MODE=${AUTH_MODE})`);
  });
}

module.exports = app;

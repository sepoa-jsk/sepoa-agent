'use strict';
// API 라우터 등록 일원화 (WBS STEP 1-c).
// server.js 는 미들웨어·정적파일·에러핸들러·listen 만 담당하고,
// 어떤 경로에 무엇이 붙는지는 전부 여기서 결정한다.
const express = require('express');
const { pool } = require('../infra/db');
const { AUTH_MODE } = require('../infra/auth');

function mountRoutes(app) {
  // 헬스체크
  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, authMode: AUTH_MODE });
    } catch (err) {
      res.status(500).json({ ok: false, db: err.message });
    }
  });

  // 도메인 라우트
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/master', require('./routes/master'));
  app.use('/api', require('./routes/pricing'));

  app.use('/api/quotes', require('./routes/quotes'));
  app.use('/api/settings', require('./routes/settings'));
  app.use('/api/labor-rates', require('./routes/labor-rates'));
  app.use('/api', require('./routes/templates'));

  // 404 (API) — 위 라우트에 걸리지 않은 /api 요청
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `${req.method} ${req.originalUrl}` });
  });

  return app;
}

module.exports = { mountRoutes };

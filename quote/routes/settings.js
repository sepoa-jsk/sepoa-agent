'use strict';
// 설정 라우트 — 공급자 정보 등 key-value. 조회는 로그인, 수정은 ADMIN.
const express = require('express');
const { query } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../lib/auth');

const router = express.Router();

// GET /api/settings — 전체 key-value
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rows = await query('SELECT `key`, value FROM sq_settings ORDER BY `key`');
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings — { settings: { key: value, ... } } 일괄 upsert (ADMIN)
router.put('/', requireAdmin, async (req, res, next) => {
  try {
    const settings = req.body.settings;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'INVALID_BODY', message: 'settings 객체가 필요합니다.' });
    }
    for (const [k, v] of Object.entries(settings)) {
      await query(
        'INSERT INTO sq_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [k, v == null ? null : String(v)]
      );
    }
    const rows = await query('SELECT `key`, value FROM sq_settings ORDER BY `key`');
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

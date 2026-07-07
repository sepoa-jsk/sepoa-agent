'use strict';
// 인증 라우트: Google SSO / 개발용 로그인 / 로그아웃 / 현재 사용자
const express = require('express');
const {
  AUTH_MODE,
  isAllowedDomain,
  provisionUser,
  verifyGoogleIdToken,
  requireAuth,
} = require('../lib/auth');

const router = express.Router();

function setSessionUser(req, user) {
  req.session.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
  };
}

// POST /api/auth/google — { credential | id_token }
router.post('/google', async (req, res) => {
  try {
    const idToken = req.body.credential || req.body.id_token;
    if (!idToken) return res.status(400).json({ error: 'MISSING_TOKEN', message: 'Google ID token이 필요합니다.' });

    const profile = await verifyGoogleIdToken(idToken);
    if (!isAllowedDomain(profile.email)) {
      return res.status(403).json({ error: 'DOMAIN_NOT_ALLOWED', message: '허용되지 않은 이메일 도메인입니다.' });
    }
    const user = await provisionUser(profile);
    setSessionUser(req, user);
    res.json({ user: req.session.user });
  } catch (err) {
    res.status(401).json({ error: 'AUTH_FAILED', message: err.message });
  }
});

// POST /api/auth/dev-login — AUTH_MODE=dev 전용. { email, name? }
router.post('/dev-login', async (req, res) => {
  if (AUTH_MODE !== 'dev') {
    return res.status(403).json({ error: 'DEV_LOGIN_DISABLED', message: '개발용 로그인은 AUTH_MODE=dev에서만 허용됩니다.' });
  }
  try {
    const email = (req.body.email || '').trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'INVALID_EMAIL', message: '유효한 이메일이 필요합니다.' });
    }
    if (!isAllowedDomain(email)) {
      return res.status(403).json({ error: 'DOMAIN_NOT_ALLOWED', message: '허용되지 않은 이메일 도메인입니다.' });
    }
    const user = await provisionUser({ email, name: req.body.name || email.split('@')[0], picture: null });
    setSessionUser(req, user);
    res.json({ user: req.session.user });
  } catch (err) {
    res.status(500).json({ error: 'AUTH_FAILED', message: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sq_sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user, authMode: AUTH_MODE });
});

module.exports = router;

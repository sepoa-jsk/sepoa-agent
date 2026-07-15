'use strict';
// 인증/인가 — Google SSO(ID token 검증) + DB 세션 + 역할(ADMIN/USER)
// AUTH_MODE=dev 이면 Google 없이 개발용 로그인 허용.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { OAuth2Client } = require('google-auth-library');
const { query } = require('./db');

const AUTH_MODE = process.env.AUTH_MODE || 'dev';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'sepoasoft.co.kr')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// ── 세션 미들웨어 (sq_sessions 테이블에 저장) ──────────────
function sessionMiddleware() {
  // 스토어가 자체 mysql2 풀을 생성하도록 접속옵션을 전달 (promise 풀과 콜백 API 불일치 회피)
  const store = new MySQLStore({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    schema: {
      tableName: 'sq_sessions',
      columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' },
    },
    createDatabaseTable: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 24 * 60 * 60 * 1000,
  });

  return session({
    key: 'sq_sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // 사내 HTTP 배포 대응: HTTPS일 때만 COOKIE_SECURE=true 로 켠다 (기본 false)
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 24 * 60 * 60 * 1000,
    },
  });
}

function isAllowedDomain(email) {
  if (ALLOWED_DOMAINS.length === 0) return true;
  const domain = String(email).split('@')[1]?.toLowerCase();
  return !!domain && ALLOWED_DOMAINS.includes(domain);
}

// 최초 로그인 시 자동 생성(auto-provisioning), 이후 로그인은 프로필/last_login 갱신
async function provisionUser({ email, name, picture }) {
  const normEmail = String(email).toLowerCase();
  const rows = await query('SELECT * FROM sq_users WHERE email = ?', [normEmail]);
  if (rows.length > 0) {
    const u = rows[0];
    await query(
      'UPDATE sq_users SET name = ?, picture = ?, last_login_at = NOW() WHERE id = ?',
      [name ?? u.name, picture ?? u.picture, u.id]
    );
    return { id: u.id, email: u.email, name: name ?? u.name, picture: picture ?? u.picture, role: u.role };
  }
  const role = ADMIN_EMAILS.includes(normEmail) ? 'ADMIN' : 'USER';
  const res = await query(
    'INSERT INTO sq_users (email, name, picture, role, last_login_at) VALUES (?, ?, ?, ?, NOW())',
    [normEmail, name ?? null, picture ?? null, role]
  );
  return { id: res.insertId, email: normEmail, name: name ?? null, picture: picture ?? null, role };
}

// Google ID token 검증 → 프로필 반환
async function verifyGoogleIdToken(idToken) {
  if (!googleClient) throw new Error('GOOGLE_CLIENT_ID가 설정되지 않았습니다.');
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p?.email_verified) throw new Error('이메일이 인증되지 않은 Google 계정입니다.');
  return { email: p.email, name: p.name, picture: p.picture };
}

// ── 미들웨어 ────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'UNAUTHENTICATED', message: '로그인이 필요합니다.' });
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: '로그인이 필요합니다.' });
  }
  if (req.session.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' });
  }
  return next();
}

// 브라우저(세션 쿠키) 또는 타시스템(X-API-Key) 허용 — 연계 전용 엔드포인트용
function apiKeyOrAuth(req, res, next) {
  const key = req.get('X-API-Key');
  if (process.env.API_KEY && key && key === process.env.API_KEY) return next();
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'UNAUTHENTICATED', message: '인증이 필요합니다.' });
}

module.exports = {
  AUTH_MODE,
  sessionMiddleware,
  isAllowedDomain,
  provisionUser,
  verifyGoogleIdToken,
  requireAuth,
  requireAdmin,
  apiKeyOrAuth,
};

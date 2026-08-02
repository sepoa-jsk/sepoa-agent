'use strict';
// 마이그레이션 러너: db/migrations/ 하위 NNN_YYYYMMDD_설명.sql 을 번호순으로 적용한다.
// 각 파일을 세미콜론 기준으로 분리해 순차 실행 (mysql2는 기본 단일 statement).
//
// 적용 이력을 sq_migrations 에 남긴다. 이력에 있는 파일은 건너뛰므로, 백필이
// 매 실행마다 다시 돌아 정상 데이터를 덮어쓰는 사고가 생기지 않는다.
// (006 백필이 무상제공 견적의 onetime_total 을 매번 supply_amount 로 되살린 전례가 있다.
//  문법적 멱등(IF NOT EXISTS)과 의미적 멱등은 다르다.)
//
// checksum 은 파일 내용의 SHA-256 이다. 이력에 있으나 내용이 달라졌으면 경고 후 중단한다.
// 자동 재적용은 하지 않는다 — 이미 적용된 파일의 재실행이 바로 위 사고의 원인이었다.
//
// 사용:
//   node db/migrate.js                     미적용 파일을 순서대로 적용
//   node db/migrate.js --status            적용/미적용 현황만 출력
//   node db/migrate.js --baseline <파일…>  실행하지 않고 '적용됨'으로 등록
//   node db/migrate.js --baseline <파일…> --note "사유"
//   node db/migrate.js --dry-run           적용 대상만 출력하고 아무것도 실행하지 않음
//   node db/migrate.js --schema <이름>     대상 스키마 지정 (예행 적용용 복제본)
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const FILE_RE = /^\d{3}_\d{8}_.*\.sql$/;

function splitStatements(sql) {
  // 라인 주석(-- ) 제거 후 세미콜론 분리. (본 스키마엔 문자열 리터럴 세미콜론 없음)
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function checksum(content) {
  // 개행 차이(CRLF/LF)로 체크섬이 흔들리지 않게 정규화한 뒤 해시한다.
  return crypto.createHash('sha256').update(content.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function listFiles() {
  // NNN_YYYYMMDD_설명.sql — NNN 이 실행 순서를 정한다(날짜는 정보용).
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => FILE_RE.test(f)).sort();
}

async function ensureHistoryTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS sq_migrations (
      filename   VARCHAR(190) NOT NULL,
      checksum   CHAR(64)     NOT NULL,
      applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      note       VARCHAR(255) NULL COMMENT '실행 없이 등록한 경우 그 사유',
      PRIMARY KEY (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function loadHistory(conn) {
  const [rows] = await conn.query('SELECT filename, checksum, applied_at, note FROM sq_migrations');
  return new Map(rows.map((r) => [r.filename, r]));
}

// 파일이 건드리는 테이블을 추정한다. 적용 전후 행수를 대조해 로그로 남기기 위한 것이며,
// 정확한 파서가 아니라 대상 후보를 넉넉히 잡는 용도다.
function tablesTouched(sql) {
  const names = new Set();
  const re = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|ALTER\s+TABLE)\s+`?(\w+)`?/gi;
  let m;
  while ((m = re.exec(sql))) if (m[1].startsWith('sq_')) names.add(m[1]);
  return [...names].sort();
}

async function rowCounts(conn, schema, tables) {
  const out = {};
  for (const t of tables) {
    try {
      const [[r]] = await conn.query(
        `SELECT COUNT(*) n FROM \`${schema}\`.\`${t}\``);
      out[t] = Number(r.n);
    } catch {
      out[t] = null; // 아직 없는 테이블
    }
  }
  return out;
}

function formatCounts(before, after) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.map((t) => {
    const b = before[t], a = after[t];
    const show = (v) => (v === null ? '없음' : v);
    return `${t} ${show(b)}→${show(a)}${b !== a ? ' *' : ''}`;
  });
}

async function connect(schema) {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: schema,
    charset: 'utf8mb4',
    multipleStatements: true,
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const valueOf = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const schema = valueOf('--schema') || process.env.DB_NAME;
  const files = listFiles();

  if (files.length === 0) {
    console.log('실행할 마이그레이션 파일이 없습니다.');
    return;
  }

  const conn = await connect(schema);
  try {
    await ensureHistoryTable(conn);
    const history = await loadHistory(conn);
    console.log(`대상 스키마: ${schema} · 파일 ${files.length}개 · 이력 ${history.size}건\n`);

    // ── --baseline: 실행하지 않고 적용됨으로 등록 ──
    if (has('--baseline')) {
      const note = valueOf('--note') || '실행 없이 등록(baseline)';
      const targets = argv.slice(argv.indexOf('--baseline') + 1)
        .filter((a) => FILE_RE.test(a));
      if (targets.length === 0) {
        console.error('--baseline 뒤에 등록할 파일명을 지정하세요.');
        process.exitCode = 1;
        return;
      }
      for (const f of targets) {
        if (!files.includes(f)) {
          console.error(`  ! ${f} — migrations 디렉터리에 없습니다.`);
          process.exitCode = 1;
          return;
        }
        const sum = checksum(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
        await conn.query(
          `INSERT INTO sq_migrations (filename, checksum, note) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), note = VALUES(note)`,
          [f, sum, note]);
        console.log(`  등록  ${f}  ${sum.slice(0, 12)}…  (${note})`);
      }
      console.log(`\n${targets.length}개 파일을 실행 없이 이력에 등록했습니다.`);
      return;
    }

    // ── 체크섬 검증: 이력에 있으나 내용이 바뀐 파일 ──
    const drifted = [];
    for (const f of files) {
      const rec = history.get(f);
      if (!rec) continue;
      const sum = checksum(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
      if (sum !== rec.checksum) drifted.push({ file: f, was: rec.checksum, now: sum });
    }
    if (drifted.length > 0) {
      console.error('중단: 이미 적용된 파일의 내용이 바뀌었습니다.\n');
      for (const d of drifted) {
        console.error(`  ${d.file}`);
        console.error(`    적용시 ${d.was}`);
        console.error(`    현재   ${d.now}`);
      }
      console.error('\n자동 재적용은 하지 않습니다. 이미 적용된 파일을 다시 돌리면');
      console.error('백필이 정상 데이터를 덮어쓸 수 있습니다(006 전례).');
      console.error('의도한 수정이면 새 번호 파일로 변경분을 넣고, 이 파일의 이력을');
      console.error('현재 내용으로 갱신하십시오:');
      console.error(`  node db/migrate.js --baseline ${drifted.map((d) => d.file).join(' ')} --note "사유"`);
      process.exitCode = 1;
      return;
    }

    const pending = files.filter((f) => !history.has(f));

    // ── --status ──
    if (has('--status')) {
      for (const f of files) {
        const rec = history.get(f);
        if (rec) {
          const when = new Date(rec.applied_at).toISOString().slice(0, 19).replace('T', ' ');
          console.log(`  적용  ${f}  ${when}${rec.note ? '  — ' + rec.note : ''}`);
        } else {
          console.log(`  대기  ${f}`);
        }
      }
      console.log(`\n적용 ${files.length - pending.length} / 대기 ${pending.length}`);
      return;
    }

    if (pending.length === 0) {
      console.log('적용할 새 마이그레이션이 없습니다. (전부 skip)');
      return;
    }

    if (has('--dry-run')) {
      console.log('적용 대상:');
      pending.forEach((f) => console.log(`  ${f}`));
      console.log(`\n--dry-run 이므로 아무것도 실행하지 않았습니다. (${pending.length}개 대기)`);
      return;
    }

    for (const f of files) {
      if (history.has(f)) {
        console.log(`skip  ${f}`);
        continue;
      }
      const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      const statements = splitStatements(raw);
      const tables = tablesTouched(raw);
      const before = await rowCounts(conn, schema, tables);

      process.stdout.write(`적용  ${f} (${statements.length} statements) ... `);
      for (const stmt of statements) {
        await conn.query(stmt);
      }
      console.log('완료');

      const after = await rowCounts(conn, schema, tables);
      const lines = formatCounts(before, after);
      if (lines.length) console.log(`        행수 ${lines.join(' · ')}`);

      await conn.query(
        'INSERT INTO sq_migrations (filename, checksum) VALUES (?, ?)',
        [f, checksum(raw)]);
    }
    console.log(`\n마이그레이션 ${pending.length}개 파일 적용 완료. (skip ${files.length - pending.length})`);
  } finally {
    await conn.end();
  }
}

module.exports = { splitStatements, checksum, listFiles, tablesTouched };

if (require.main === module) {
  main().catch((err) => {
    console.error('마이그레이션 실패:', err.message);
    process.exit(1);
  });
}

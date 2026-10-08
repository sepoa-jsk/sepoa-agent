'use strict';
// dbdump / dbverify 라운드트립 — 승격의 조건이다.
//
// 백업 2~4차가 이 도구에 의존하고 4차는 작업 20 DROP 직전이라,
// "복원되지 않는 백업"을 만들면 되돌릴 방법이 없다.
// 경계 사례를 담은 임시 스키마를 만들어 덤프 → 복원 → 값 대조까지 확인한다.
//
// 실제로 한 번 깨졌던 케이스를 반드시 포함한다:
//   sq_blocks.calc = "소계합→특별DC→십만절사; VAT별도; 일시불/월 분리"
//   값 안의 세미콜론 때문에 단순 split(';') 이 문장을 잘못 잘랐다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { dump } = require('../../../quote/tools/ops/dbdump.js');
const { verify } = require('../../../quote/tools/ops/dbverify.js');
const fmt = require('../../../quote/tools/ops/dumpformat.js');

const CONN = {
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
};
const SRC = 'test_01_dumpsrc';
const TMP = 'test_01_dumpsrc_restorecheck';

// 실제로 덤프를 깨뜨렸던 값
const SEMICOLON = '소계합→특별DC→십만절사; VAT별도; 일시불/월 분리';

const CASES = [
  { label: '세미콜론 포함(실제 sq_blocks.calc)', txt: SEMICOLON },
  { label: '작은따옴표', txt: "it's a 'quoted' value" },
  { label: '역슬래시', txt: 'C:\\Program Files\\back\\slash' },
  { label: '역슬래시+따옴표 조합', txt: "path\\'s end\\\\" },
  { label: '개행', txt: '첫 줄\n둘째 줄\r\n셋째 줄' },
  { label: '탭', txt: 'a\tb\tc' },
  { label: 'NUL 과 Ctrl-Z', txt: 'a\u0000b\u001Ac' },
  { label: '빈 문자열', txt: '' },
  { label: '한글', txt: '전자인장관리솔루션 · 견적조건' },
  { label: '이모지(utf8mb4 4바이트)', txt: '견적 확정 🎉🔒 완료' },
  { label: '센티넬 문자열을 값에 넣은 경우', txt: `값 안의 ${fmt.EOS} 문자열` },
  { label: 'SQL 주입 모양', txt: "'); DROP TABLE x; --" },
];

async function conn(database) {
  return mysql.createConnection({
    ...CONN, port: +CONN.port, database, charset: 'utf8mb4',
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
  });
}

test('dbdump/dbverify 라운드트립 — 경계 사례', async (t) => {
  const outFile = path.join(os.tmpdir(), `sq-dumptest-${process.pid}.sql`);
  let c = await conn();
  try {
    await c.query(`DROP DATABASE IF EXISTS \`${SRC}\``);
    await c.query(`DROP DATABASE IF EXISTS \`${TMP}\``);
    await c.query(`CREATE DATABASE \`${SRC}\` DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.end();
    c = await conn(SRC);

    // 타입별 직렬화를 함께 보기 위해 한 테이블에 여러 타입을 담는다.
    await c.query(`
      CREATE TABLE t_edge (
        id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
        label     VARCHAR(120) NOT NULL,
        txt       TEXT NULL,
        txt_null  TEXT NULL,
        n_int     INT NULL,
        n_big     BIGINT NULL,
        n_dec     DECIMAL(18,4) NULL,
        n_bool    TINYINT(1) NULL,
        d_dt      DATETIME NULL,
        d_date    DATE NULL,
        j_json    JSON NULL,
        b_blob    VARBINARY(64) NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // FK 순서 회피가 실제로 동작하는지 보려고, 자식 테이블을 부모보다 앞 이름으로 만든다.
    await c.query(`
      CREATE TABLE a_child (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        parent_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (id),
        KEY idx_p (parent_id),
        CONSTRAINT fk_child_edge FOREIGN KEY (parent_id) REFERENCES t_edge(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    for (const cs of CASES) {
      await c.query(
        `INSERT INTO t_edge (label, txt, txt_null, n_int, n_big, n_dec, n_bool, d_dt, d_date, j_json, b_blob)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [cs.label, cs.txt, null, -2147483648, '9223372036854775807', '12345678901234.5678', 1,
          '2026-08-02 13:45:59', '2026-08-02', JSON.stringify({ k: cs.txt, arr: [1, 2, 3] }),
          Buffer.from([0x00, 0x01, 0xff, 0x7f, 0x80])]);
    }
    // 값이 전혀 없는 행(NULL 과 빈 문자열 구분 확인용)
    await c.query(`INSERT INTO t_edge (label, txt) VALUES ('전 컬럼 NULL', NULL)`);
    const [[{ id: firstId }]] = await c.query('SELECT MIN(id) id FROM t_edge');
    await c.query('INSERT INTO a_child (parent_id) VALUES (?)', [firstId]);

    const [before] = await c.query('SELECT * FROM t_edge ORDER BY id');
    await c.end();

    // ── 덤프 ──
    const meta = await dump({ out: outFile, schema: SRC, ...CONN });
    assert.equal(meta.tables, 2, '테이블 2종이 덤프되어야 한다');
    assert.equal(meta.totalRows, CASES.length + 1 + 1, '행수가 맞아야 한다');

    const text = fs.readFileSync(outFile, 'utf8');

    await t.test('utf8mb4 · FK 회피 · 센티넬 헤더', () => {
      assert.match(text, /SET NAMES utf8mb4;/, 'SET NAMES utf8mb4 가 있어야 한다');
      assert.match(text, /SET FOREIGN_KEY_CHECKS = 0;/, '앞에서 FK 검사를 꺼야 한다');
      assert.match(text, /SET FOREIGN_KEY_CHECKS = 1;/, '끝에서 되돌려야 한다');
      const off = text.indexOf('SET FOREIGN_KEY_CHECKS = 0');
      const on = text.lastIndexOf('SET FOREIGN_KEY_CHECKS = 1');
      assert.ok(off < text.indexOf('CREATE TABLE'), 'FK 끄기는 CREATE TABLE 앞이어야 한다');
      assert.ok(on > text.lastIndexOf('INSERT INTO'), 'FK 켜기는 마지막 INSERT 뒤여야 한다');
    });

    await t.test('NULL 과 빈 문자열이 구분된다', () => {
      // txt_null 은 전 행 NULL, 빈 문자열 케이스는 '' 로 들어가야 한다
      assert.ok(text.includes(',NULL,'), 'NULL 리터럴이 있어야 한다');
      assert.ok(/,''[,)]/.test(text), "빈 문자열 '' 이 있어야 한다");
    });

    await t.test('값 안의 세미콜론이 문장을 자르지 않는다', () => {
      const stmts = fmt.split(text);
      const inserts = stmts.filter((s) => s.startsWith('INSERT INTO'));
      assert.ok(inserts.length >= 2, `INSERT 문이 온전해야 한다 (실제 ${inserts.length}문)`);
      // 세미콜론 값을 담은 INSERT 가 통째로 하나의 문이어야 한다
      const withSemi = inserts.find((s) => s.includes('VAT별도'));
      assert.ok(withSemi, '세미콜론 케이스가 INSERT 문 안에 있어야 한다');
      assert.ok(withSemi.startsWith('INSERT INTO') && withSemi.includes('VALUES'),
        '세미콜론에서 잘리지 않아야 한다');
    });

    await t.test('센티넬 문자열이 값에 있어도 깨지지 않는다', () => {
      const stmts = fmt.split(text);
      assert.ok(stmts.some((s) => s.includes('DROP TABLE x')),
        'SQL 주입 모양 값이 문자열 리터럴로 보존되어야 한다');
    });

    // ── 복원 검증 ──
    const { results } = await verify({ dumpPath: outFile, schema: SRC, tmpSchema: TMP, ...CONN, log: () => {} });
    const failed = results.filter((r) => !r.pass);
    assert.equal(failed.length, 0,
      '검증 전 항목 통과해야 한다: ' + failed.map((r) => `${r.label}(${r.detail})`).join(' / '));

    // ── 값 대조 — 복원본을 다시 만들어 원본과 1:1 비교 ──
    c = await conn();
    await c.query(`DROP DATABASE IF EXISTS \`${TMP}\``);
    await c.query(`CREATE DATABASE \`${TMP}\` DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.query(`USE \`${TMP}\``);
    for (const s of fmt.split(text)) await c.query(s);
    const [after] = await c.query('SELECT * FROM t_edge ORDER BY id');

    await t.test('전 컬럼 값이 원본과 같다', () => {
      assert.equal(after.length, before.length, '행수가 같아야 한다');
      for (let i = 0; i < before.length; i++) {
        const a = before[i], b = after[i];
        for (const k of Object.keys(a)) {
          const av = Buffer.isBuffer(a[k]) ? a[k].toString('hex') : a[k];
          const bv = Buffer.isBuffer(b[k]) ? b[k].toString('hex') : b[k];
          const an = av === null ? 'NULL' : JSON.stringify(av);
          const bn = bv === null ? 'NULL' : JSON.stringify(bv);
          assert.equal(bn, an, `행 ${i + 1} "${a.label}" 의 ${k} 가 달라졌다`);
        }
      }
    });

    await t.test('NULL 이 빈 문자열로 바뀌지 않았다', () => {
      for (const r of after) assert.equal(r.txt_null, null, `${r.label}: txt_null 은 NULL 이어야 한다`);
      const empty = after.find((r) => r.label === '빈 문자열');
      assert.equal(empty.txt, '', '빈 문자열은 NULL 이 아니라 "" 여야 한다');
      const allNull = after.find((r) => r.label === '전 컬럼 NULL');
      assert.equal(allNull.txt, null, 'NULL 은 NULL 로 남아야 한다');
    });

    await t.test('이모지·한글이 4바이트까지 보존된다', () => {
      const emoji = after.find((r) => r.label === '이모지(utf8mb4 4바이트)');
      assert.equal(emoji.txt, '견적 확정 🎉🔒 완료');
      const ko = after.find((r) => r.label === '한글');
      assert.equal(ko.txt, '전자인장관리솔루션 · 견적조건');
    });

    await t.test('숫자·DATETIME·JSON 타입이 유지된다', () => {
      const r = after[0];
      assert.equal(String(r.n_big), '9223372036854775807', 'BIGINT 정밀도가 유지되어야 한다');
      assert.equal(String(r.n_int), '-2147483648');
      assert.equal(String(r.n_dec), '12345678901234.5678');
      assert.equal(String(r.n_bool), '1');
      assert.equal(r.d_dt, '2026-08-02 13:45:59');
      assert.equal(r.d_date, '2026-08-02');
      const j = typeof r.j_json === 'string' ? JSON.parse(r.j_json) : r.j_json;
      assert.equal(j.k, SEMICOLON, 'JSON 안의 세미콜론 값도 보존되어야 한다');
      assert.deepEqual(j.arr, [1, 2, 3]);
    });

    await t.test('바이너리가 바이트 단위로 보존된다', () => {
      const b = after[0].b_blob;
      const hex = Buffer.isBuffer(b) ? b.toString('hex') : Buffer.from(String(b), 'binary').toString('hex');
      assert.equal(hex, '0001ff7f80', 'NUL·0xFF 를 포함한 바이너리가 그대로여야 한다');
    });

    await c.end();
    c = null;
  } finally {
    // 임시 스키마·파일은 반드시 지운다.
    try { if (c) await c.end(); } catch { /* 이미 닫힘 */ }
    const cleanup = await conn().catch(() => null);
    if (cleanup) {
      await cleanup.query(`DROP DATABASE IF EXISTS \`${TMP}\``).catch(() => {});
      await cleanup.query(`DROP DATABASE IF EXISTS \`${SRC}\``).catch(() => {});
      await cleanup.end();
    }
    for (const f of [outFile, outFile + '.counts.json']) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
});

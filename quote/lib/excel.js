'use strict';
// 세포아 견적서 Excel (ExcelJS) — 실제 전자인장 견적서 양식 재현.
// 헤더박스 + ▣ 솔루션 견적 + ▣ 시스템 구축 견적(인건비) + 합계 + ▣ 견적조건.
// 기준단가(base_price)/제안단가(unit_price)를 모두 출력. 공급자정보는 settings 에서.
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const ASSETS = path.join(__dirname, '..', 'assets');
const SEAL_PATH = path.join(ASSETS, 'seal.png');
const LOGO_PATH = path.join(ASSETS, 'logo.png');       // sepoasoft 로고
const BAND_TOP_PATH = path.join(ASSETS, 'band_top.png');    // 상단 대각선 색상 바
const BAND_BOTTOM_PATH = path.join(ASSETS, 'band_bottom.png'); // 하단 대각선 색상 바
const SOLUTION_NAMES = { EXPENSE: '경비관리(무전표)', PROCURE: '전자구매', SEAL: '전자인장관리' };
const DEPLOYMENT_NAMES = { ONPREM: 'On-Premise', SAAS: 'SaaS Cloud', PCLOUD: 'Private Cloud' };

const GRAY = 'FFD9D9D9';   // 라벨셀 배경
const LIGHT = 'FFF2F2F2';  // 소계/Total 배경
const ACCENT = 'FF0747A6'; // 최종/총계 강조
const THIN = { style: 'thin', color: { argb: 'FFAAAAAA' } };
const ALLB = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const FN = '맑은 고딕';
const MONEY = '#,##0';

const fmtDate = (d) => (d ? String(d).slice(0, 10) : '');

// 컬럼 문자 ↔ 번호
const colNum = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const numCol = (n) => { let s = ''; while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; };

async function buildQuoteWorkbook(quote, settings = {}, masters = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.supplier_name || '㈜세포아소프트';
  buildCover(wb, quote, settings); // 1번 시트: 가격제안서 표지
  const ws = wb.addWorksheet('견적서', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });

  // A=여백, 내용은 B~H
  const widths = { A: 1.5, B: 18.5, C: 22, D: 35.4, E: 9.8, F: 15.2, G: 15, H: 15 };
  Object.entries(widths).forEach(([c, w]) => (ws.getColumn(c).width = w));

  const nameOfSolution = (c) => (masters.solutionNames && masters.solutionNames[c]) || SOLUTION_NAMES[c] || c;
  const nameOfDeployment = (c) => (masters.deploymentNames && masters.deploymentNames[c]) || DEPLOYMENT_NAMES[c] || c;

  // ── 유틸 ──
  function eachCell(range, fn) {
    const [s, e] = range.split(':');
    const c1 = colNum(s.match(/[A-Z]+/)[0]), r1 = +s.match(/\d+/)[0];
    const c2 = colNum(e.match(/[A-Z]+/)[0]), r2 = +e.match(/\d+/)[0];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn(ws.getCell(numCol(c) + r));
  }
  const border = (range) => eachCell(range, (c) => { c.border = ALLB; });
  function setCell(addr, value, opt = {}) {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = { name: FN, size: opt.size || 10, bold: !!opt.bold, color: { argb: opt.color || 'FF000000' }, underline: opt.underline || false };
    c.alignment = { horizontal: opt.h || 'left', vertical: 'middle', wrapText: !!opt.wrap };
    if (opt.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opt.fill } };
    if (opt.money) c.numFmt = MONEY;
    return c;
  }
  const label = (addr, text) => setCell(addr, text, { bold: true, h: 'center', fill: GRAY });

  // memo 파싱 ([태그] 값)
  const memo = String(quote.memo || '');
  const tag = (t) => { const m = memo.match(new RegExp('\\[' + t + '\\]\\s*(.+)')); return m ? m[1].trim() : ''; };
  const purpose = tag('견적용도');
  const payTerms = tag('결제조건') || '고객사 결제조건';
  const vatIncluded = tag('부가세') === '포함';
  const onsiteText = tag('상주') || '상주';

  // 데이터 분류 (솔루션 / 인건비)
  const solItems = [], labItems = [];
  let solutionCode = null;
  for (const sec of quote.sections || []) {
    for (const it of sec.items || []) {
      if (it.category === '시스템구축') labItems.push(it);
      else { solItems.push(it); if (!solutionCode) solutionCode = sec.solution; }
    }
  }
  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const solSub = sum(solItems, (i) => i.amount);
  const labSub = sum(labItems, (i) => i.amount);
  const mmSum = sum(labItems, (i) => i.qty);
  const total = Number(quote.supply_amount) || (solSub + labSub);
  const disc = Number(quote.discount_amount) || 0;
  const vat = Number(quote.vat_amount) || 0;
  const grand = Number(quote.total_amount) || 0;
  const finalAmt = total - disc; // 최종견적금액(특별DC 반영)
  // 적용네고율(견적조건 문구용) — 인건비 우선, 없으면 솔루션
  const src = labItems.find((i) => Number(i.base_price)) || solItems.find((i) => Number(i.base_price));
  const negoPct = src ? Math.round((Number(src.unit_price) / Number(src.base_price)) * 100) : 100;

  // ── 상단 주소/제목 ──
  ws.mergeCells('B1:H1');
  setCell('B1', '서울특별시 구로구 디지털로31길 62, 아티스포럼 714~717호   ☎ 02-6242-3094', { size: 8.5, h: 'right', color: 'FF888888' });
  ws.mergeCells('B3:H3');
  setCell('B3', 'Quotation', { size: 28, bold: true, h: 'center', underline: true, color: ACCENT });
  ws.getRow(3).height = 38;

  // ── 헤더 박스 (B4~H8) ──
  const rcv = quote.customer_name ? quote.customer_name + ' 귀중' : '';
  label('B4', '수  신'); ws.mergeCells('C4:E4'); setCell('C4', rcv, { bold: true });
  label('F4', '견 적 번 호'); ws.mergeCells('G4:H4'); setCell('G4', quote.quote_no || '', { h: 'center' });
  label('B5', '견 적 용 도'); ws.mergeCells('C5:E5'); setCell('C5', purpose);
  label('F5', '견 적 일 자'); ws.mergeCells('G5:H5'); setCell('G5', fmtDate(quote.quote_date), { h: 'center' });
  label('B6', '결 제 조 건'); ws.mergeCells('C6:E6'); setCell('C6', payTerms);
  label('F6', '견적유효일'); ws.mergeCells('G6:H6'); setCell('G6', quote.valid_until ? fmtDate(quote.valid_until) : '견적일로부터 30일', { h: 'center' });
  label('B7', '총 견 적 가'); setCell('C7', grand, { bold: true, h: 'right', money: true });
  ws.mergeCells('D7:E7'); setCell('D7', `(단위: 원, 부가세 ${vatIncluded ? '포함' : '별도'})`, { size: 8.5, color: 'FF888888' });
  label('F7', '상    호'); ws.mergeCells('G7:H7'); setCell('G7', settings.supplier_name || '㈜세포아소프트', { h: 'center', bold: true });
  label('B8', '설 치 완 료'); ws.mergeCells('C8:E8'); setCell('C8', '협의된 프로젝트 기간');
  label('F8', '대 표 이 사'); ws.mergeCells('G8:H8'); setCell('G8', (settings.supplier_ceo || '이 희 림') + '  (인)', { h: 'center' });
  border('B4:H8');

  // 인감 오버레이 (대표 행 G8)
  try {
    if (fs.existsSync(SEAL_PATH)) {
      const imageId = wb.addImage({ buffer: fs.readFileSync(SEAL_PATH), extension: 'png' });
      ws.getRow(8).height = 30;
      ws.addImage(imageId, { tl: { col: colNum('H') - 1.6, row: 7.05 }, ext: { width: 46, height: 46 }, editAs: 'oneCell' });
    }
  } catch { /* 인감 없으면 생략 */ }

  ws.mergeCells('B9:H9');
  setCell('B9', '하기와 같이 견적하오니 참조 바랍니다.', { size: 9.5 });

  let row = 11;

  // ── ▣ 솔루션 견적 ──
  setCell(`B${row}`, '▣ 솔루션 견적', { bold: true, size: 11, color: ACCENT });
  setCell(`H${row}`, '(단위 : 원)', { size: 8.5, h: 'right', color: 'FF888888' });
  row += 1;
  row = table(row, ['구분', '모듈', '세부기능', '수량(식)', '기준단가', '제안단가', '제안금액'],
    solItems, nameOfSolution(solutionCode) || '솔루션', '식');
  row = subtotalRow(row, '솔루션 소계', solSub, null);
  row += 1;

  // ── ▣ 시스템 구축 견적 ──
  setCell(`B${row}`, '▣ 시스템 구축 견적', { bold: true, size: 11, color: ACCENT });
  row += 1;
  row = table(row, ['구분', '역할(등급)', '세부내역', '공수(MM)', '기준단가', '제안단가', '제안금액'],
    labItems, '시스템구축\n개발인건비', 'MM');
  row = subtotalRow(row, '인건비 소계', labSub, mmSum);

  // ── 합계 ──
  row = totalRow(row, 'Total (솔루션 + 인건비)', total, false);
  if (disc > 0) {
    row = totalRow(row, '특별 DC', -disc, false);
    row = totalRow(row, '최종견적금액 (특별 DC 적용)', finalAmt, true);
  } else {
    row = totalRow(row, '최종견적금액', finalAmt, true);
  }
  if (!vatIncluded) {
    row = totalRow(row, '부가세 (VAT 10%)', vat, false);
    row = totalRow(row, '총 견적가', grand, true, true);
  } else {
    row = totalRow(row, '총 견적가 (부가세 포함)', grand, true, true);
  }
  row += 1;

  // ── ▣ 견적조건 ──
  setCell(`B${row}`, '▣ 견적조건', { bold: true, size: 11, color: ACCENT });
  row += 1;
  // 저장된 견적조건 우선, 없으면(구 견적) 기본 문구 폴백.
  const conds = (Array.isArray(quote.conditions) && quote.conditions.length)
    ? quote.conditions.map((c) => c.text).filter(Boolean)
    : [
      '프로젝트 투입공수 및 일정은 세부 업무요건에 따라 변경될 수 있습니다.',
      `개발단가는 한국SW산업협회 노임 단가 기준 ${negoPct}%를 적용하였습니다.`,
      '솔루션 유지보수는 시스템 오픈 후 12개월간 무상유지보수 이후 진행되며, 유상유지보수는 솔루션 공급가의 15%로 제안합니다.',
      `본 프로젝트는 ${onsiteText}로 진행합니다.`,
    ];
  for (const c of conds) {
    ws.mergeCells(`B${row}:H${row}`);
    setCell(`B${row}`, '-. ' + c, { size: 9 });
    row += 1;
  }

  return wb;

  // ── 표 렌더 (B~H, 7컬럼) ──
  function table(startRow, headers, items, gubunLabel, unit) {
    let r = startRow;
    // 헤더
    headers.forEach((hd, i) => {
      const c = numCol(colNum('B') + i);
      setCell(c + r, hd, { bold: true, h: 'center', fill: GRAY });
    });
    border(`B${r}:H${r}`);
    r += 1;
    const dataStart = r;
    if (items.length === 0) {
      ws.mergeCells(`B${r}:H${r}`);
      setCell(`B${r}`, '(항목 없음)', { h: 'center', color: 'FF999999' });
      border(`B${r}:H${r}`);
      return r + 1;
    }
    items.forEach((it) => {
      setCell(`B${r}`, '', {});                                   // 구분(병합용, 값은 대표행에)
      setCell(`C${r}`, it.name || '', { wrap: true });            // 모듈/역할
      setCell(`D${r}`, it.spec || '', { wrap: true });            // 세부기능/내역
      setCell(`E${r}`, Number(it.qty) || 0, { h: 'center' });     // 수량/공수
      setCell(`F${r}`, Number(it.base_price) || 0, { h: 'right', money: true }); // 기준단가
      setCell(`G${r}`, Number(it.unit_price) || 0, { h: 'right', money: true }); // 제안단가
      setCell(`H${r}`, Number(it.amount) || 0, { h: 'right', money: true });     // 제안금액
      border(`B${r}:H${r}`);
      r += 1;
    });
    // 구분 세로병합 + 대표값
    ws.mergeCells(`B${dataStart}:B${r - 1}`);
    setCell(`B${dataStart}`, gubunLabel, { bold: true, h: 'center', wrap: true, fill: LIGHT });
    border(`B${dataStart}:B${r - 1}`);
    return r;
  }

  function subtotalRow(r, text, amount, mm) {
    ws.mergeCells(`B${r}:D${r}`);
    setCell(`B${r}`, text, { bold: true, h: 'right', fill: LIGHT });
    if (mm != null) setCell(`E${r}`, Number(mm), { bold: true, h: 'center', fill: LIGHT });
    else setCell(`E${r}`, '', { fill: LIGHT });
    setCell(`F${r}`, '', { fill: LIGHT }); setCell(`G${r}`, '', { fill: LIGHT });
    setCell(`H${r}`, amount, { bold: true, h: 'right', money: true, fill: LIGHT });
    border(`B${r}:H${r}`);
    return r + 1;
  }

  function totalRow(r, text, amount, strong, grandTop) {
    ws.mergeCells(`B${r}:G${r}`);
    const fill = grandTop ? ACCENT : (strong ? LIGHT : null);
    const color = grandTop ? 'FFFFFFFF' : (strong ? ACCENT : 'FF000000');
    setCell(`B${r}`, text, { bold: strong, h: 'right', fill, color, size: grandTop ? 12 : 10 });
    setCell(`H${r}`, amount, { bold: strong, h: 'right', money: true, fill, color, size: grandTop ? 12 : 10 });
    border(`B${r}:H${r}`);
    if (grandTop) ws.getRow(r).height = 22;
    return r + 1;
  }
}

// ── 표지(가격제안서 커버) ──────────────────────────────────────
// ⚠️ ExcelJS 로는 PDF 표지의 대각선 색상 바·로고 이미지를 그대로 재현할 수
//    없어, 상/하단 브랜드 색상 밴드 + 중앙 타이틀 + 고객정보로 근사한다.
//    로고 이미지(PNG)를 assets 에 넣어주면 전면 삽입으로 교체 가능.
function buildCover(wb, quote, settings) {
  const cs = wb.addWorksheet('표지', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, margins: { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2 } },
    views: [{ showGridLines: false }],
  });
  'ABCDEFGH'.split('').forEach((c) => (cs.getColumn(c).width = 11.5));

  const memo = String(quote.memo || '');
  const tg = (t) => { const m = memo.match(new RegExp('\\[' + t + '\\]\\s*(.+)')); return m ? m[1].trim() : ''; };
  const cust = quote.customer_name || '';
  const purpose = tg('견적용도');
  const contact = quote.customer_contact || '';
  const phone = tg('연락처');
  const email = tg('이메일');
  const supplier = (settings.supplier_name) || '㈜세포아소프트';

  const fill = (addr, argb) => { cs.getCell(addr).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; };
  const put = (addr, val, opt = {}) => {
    const c = cs.getCell(addr); c.value = val;
    c.font = { name: FN, size: opt.size || 11, bold: !!opt.bold, color: { argb: opt.color || 'FF333333' } };
    c.alignment = { horizontal: opt.h || 'center', vertical: 'middle' };
  };
  const LIME = 'FFA6CE39', YEL = 'FFF5C400', PINK = 'FFEC008C', DARK = 'FF404040';
  const img = (file) => (fs.existsSync(file) ? wb.addImage({ buffer: fs.readFileSync(file), extension: 'png' }) : null);
  const topId = img(BAND_TOP_PATH), botId = img(BAND_BOTTOM_PATH), logoId = img(LOGO_PATH);

  // 상단 브랜드 밴드 — 이미지 있으면 삽입, 없으면 색상 셀로 폴백
  if (topId != null) { cs.getRow(1).height = 30; cs.addImage(topId, 'A1:H3'); }
  else { cs.getRow(1).height = 18; fill('A1', LIME); fill('B1', YEL); fill('C1', PINK); ['D1', 'E1', 'F1', 'G1', 'H1'].forEach((a) => fill(a, DARK)); }

  // 중앙 타이틀
  cs.mergeCells('A14:H15'); put('A14', (cust + ' ' + (purpose || '시스템 구축')).trim(), { size: 26, bold: true });
  cs.getRow(14).height = 36; cs.getRow(15).height = 36;
  cs.mergeCells('A17:H18'); put('A17', '가 격 제 안 서', { size: 26, bold: true });
  cs.getRow(17).height = 36; cs.getRow(18).height = 36;

  // 고객 정보 블록 (우측 하단)
  let r = 34;
  [['고객사', cust], ['담당자', contact], ['연락처', phone], ['이메일', email]].forEach(([k, v]) => {
    cs.mergeCells(`E${r}:H${r}`); put(`E${r}`, `${k} : ${v || ''}`, { size: 10.5, h: 'left', color: 'FF555555' });
    r += 1;
  });

  // 로고(우측 하단) — 이미지 있으면 삽입, 없으면 상호 텍스트
  if (logoId != null) cs.addImage(logoId, { tl: { col: 4.3, row: 39 }, ext: { width: 260, height: 72 }, editAs: 'oneCell' });
  else { cs.mergeCells('E44:H44'); put('E44', supplier, { size: 13, bold: true, h: 'right', color: 'FF7AA324' }); }

  // 하단 브랜드 밴드 (미러)
  if (botId != null) { cs.getRow(46).height = 30; cs.addImage(botId, 'A45:H47'); }
  else { cs.getRow(46).height = 18; ['A46', 'B46', 'C46', 'D46', 'E46'].forEach((a) => fill(a, DARK)); fill('F46', PINK); fill('G46', YEL); fill('H46', LIME); }

  cs.pageSetup.printArea = 'A1:H47';
  return cs;
}

module.exports = { buildQuoteWorkbook };

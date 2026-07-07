'use strict';
// 견적서 Excel 생성 (ExcelJS). 섹션 소계 + 전체 합계, 공급자정보(settings), 인감 오버레이.
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const SEAL_PATH = path.join(__dirname, '..', 'assets', 'seal.png');

// 코드→표기명 (마스터 미전달 시 폴백)
const SOLUTION_NAMES = { EXPENSE: '경비관리(무전표)', EPRO: '전자구매', ESEAL: '전자인장관리' };
const DEPLOYMENT_NAMES = { ONPREM: 'On-Premise', SAAS: 'SaaS Cloud', PCLOUD: 'Private Cloud', SVC: '서비스솔루션' };

const NAVY = 'FF1E2D4E';
const LIGHT = 'FFEDF0F5';
const BORDER = { style: 'thin', color: { argb: 'FFBFC6D2' } };
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
const MONEY = '#,##0';

function fmtDate(d) {
  return d ? String(d).slice(0, 10) : '';
}

async function buildQuoteWorkbook(quote, settings = {}, masters = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.supplier_name || '세포아소프트(주)';
  const ws = wb.addWorksheet('견적서', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });

  // 9개 컬럼 (A~I)
  const widths = [10, 26, 24, 8, 7, 7, 14, 16, 18];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const LAST_COL = 'I';

  const nameOfSolution = (code) => (masters.solutionNames?.[code]) || SOLUTION_NAMES[code] || code;
  const nameOfDeployment = (code) => (masters.deploymentNames?.[code]) || DEPLOYMENT_NAMES[code] || code;

  let row = 1;

  // ── 제목 ──
  ws.mergeCells(`A${row}:${LAST_COL}${row}`);
  const title = ws.getCell(`A${row}`);
  title.value = '견   적   서';
  title.font = { size: 22, bold: true, color: { argb: NAVY } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(row).height = 34;
  row += 2;

  // ── 견적 메타 (좌: 수신/견적번호, 우: 공급자) ──
  const metaTop = row;
  ws.getCell(`A${row}`).value = '견적번호';
  ws.getCell(`B${row}`).value = quote.quote_no;
  row += 1;
  ws.getCell(`A${row}`).value = '견적일자';
  ws.getCell(`B${row}`).value = fmtDate(quote.quote_date);
  row += 1;
  ws.getCell(`A${row}`).value = '유효기간';
  ws.getCell(`B${row}`).value = quote.valid_until ? fmtDate(quote.valid_until) : '견적일로부터 30일';
  row += 1;
  ws.getCell(`A${row}`).value = '수    신';
  ws.getCell(`B${row}`).value = quote.customer_name ? `${quote.customer_name} 귀중` : '';
  if (quote.customer_contact) {
    row += 1;
    ws.getCell(`A${row}`).value = '담 당 자';
    ws.getCell(`B${row}`).value = quote.customer_contact;
  }
  for (let r = metaTop; r <= row; r++) {
    ws.getCell(`A${r}`).font = { bold: true, size: 11, color: { argb: NAVY } };
    ws.getCell(`B${r}`).font = { size: 11 };
  }

  // 공급자 박스 (F~I, metaTop 기준)
  const supLabelCol = 'F';
  const supValStart = 'G';
  const supplierRows = [
    ['상    호', settings.supplier_name || '세포아소프트(주)'],
    ['사업자번호', settings.supplier_biz_no || ''],
    ['대    표', settings.supplier_ceo || ''],
    ['주    소', settings.supplier_address || ''],
  ];
  supplierRows.forEach((pair, i) => {
    const r = metaTop + i;
    ws.getCell(`${supLabelCol}${r}`).value = pair[0];
    ws.getCell(`${supLabelCol}${r}`).font = { bold: true, size: 10, color: { argb: NAVY } };
    ws.mergeCells(`${supValStart}${r}:${LAST_COL}${r}`);
    const vc = ws.getCell(`${supValStart}${r}`);
    vc.value = pair[1];
    vc.font = { size: 10 };
    vc.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  });
  // 인감 오버레이 — '대표 이희림' 값 셀 위에 겹쳐 날인 (관행)
  try {
    if (fs.existsSync(SEAL_PATH)) {
      const imageId = wb.addImage({ buffer: fs.readFileSync(SEAL_PATH), extension: 'png' });
      // supplierRows 인덱스 2 = '대표' 행. cell row(1-indexed) = metaTop+2 → addImage row(0-indexed) = metaTop+1
      const ceoRow0 = metaTop + 1;
      // 값 열 G(0-indexed 6) 기준, 이름('이희림') 끝에 살짝 겹치도록 오른쪽으로 이동
      ws.getRow(metaTop + 2).height = 30; // 대표 행 높이 확보
      ws.addImage(imageId, {
        tl: { col: 6.75, row: ceoRow0 - 0.15 },
        ext: { width: 56, height: 56 },
        editAs: 'oneCell',
      });
    }
  } catch { /* 인감 없으면 생략 */ }

  row = Math.max(row, metaTop + supplierRows.length) + 2;

  // ── 품목 테이블 헤더 ──
  const headers = ['구분', '품목', '규격', '수량', '단위', '개월', '단가', '금액', '비고'];
  const headerRow = ws.getRow(row);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = ALL_BORDERS;
  });
  headerRow.height = 22;
  row += 1;

  const sections = quote.sections || [];
  for (const sec of sections) {
    // 섹션 헤더
    ws.mergeCells(`A${row}:${LAST_COL}${row}`);
    const sh = ws.getCell(`A${row}`);
    const cls = sec.company_class ? ` · ${sec.company_class}` : '';
    const months = sec.contract_months && sec.contract_months > 1 ? ` · 계약 ${sec.contract_months}개월` : '';
    sh.value = `[${nameOfSolution(sec.solution)} - ${nameOfDeployment(sec.deployment)}]${cls}${months}`;
    sh.font = { bold: true, size: 11, color: { argb: NAVY } };
    sh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    sh.alignment = { horizontal: 'left', vertical: 'middle' };
    sh.border = ALL_BORDERS;
    row += 1;

    for (const it of sec.items || []) {
      const r = ws.getRow(row);
      const vals = [
        it.category || '',
        it.name || '',
        it.spec || '',
        Number(it.qty) || 0,
        it.unit || '',
        Number(it.months) || 1,
        Number(it.unit_price) || 0,
        Number(it.amount) || 0,
        it.note || '',
      ];
      vals.forEach((v, i) => {
        const c = r.getCell(i + 1);
        c.value = v;
        c.border = ALL_BORDERS;
        c.font = { size: 10 };
        c.alignment = { vertical: 'middle', wrapText: i === 1 || i === 2 || i === 8 };
      });
      r.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(6).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(7).numFmt = MONEY;
      r.getCell(7).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(8).numFmt = MONEY;
      r.getCell(8).alignment = { horizontal: 'right', vertical: 'middle' };
      row += 1;
    }

    // 섹션 소계
    ws.mergeCells(`A${row}:G${row}`);
    const stLabel = ws.getCell(`A${row}`);
    stLabel.value = '섹션 소계';
    stLabel.font = { bold: true, size: 10, color: { argb: NAVY } };
    stLabel.alignment = { horizontal: 'right', vertical: 'middle' };
    stLabel.border = ALL_BORDERS;
    const stVal = ws.getCell(`H${row}`);
    stVal.value = Number(sec.subtotal) || 0;
    stVal.numFmt = MONEY;
    stVal.font = { bold: true, size: 10, color: { argb: NAVY } };
    stVal.alignment = { horizontal: 'right', vertical: 'middle' };
    stVal.border = ALL_BORDERS;
    ws.getCell(`I${row}`).border = ALL_BORDERS;
    row += 1;
  }

  row += 1;

  // ── 합계 블록 (우측) ──
  const totals = [
    ['공급가액', Number(quote.supply_amount) || 0, false],
    ['할인', -(Number(quote.discount_amount) || 0), false],
    ['부가세 (VAT 10%)', Number(quote.vat_amount) || 0, false],
    ['합계금액', Number(quote.total_amount) || 0, true],
  ];
  for (const [label, val, strong] of totals) {
    ws.mergeCells(`F${row}:G${row}`);
    const lc = ws.getCell(`F${row}`);
    lc.value = label;
    lc.alignment = { horizontal: 'right', vertical: 'middle' };
    lc.border = ALL_BORDERS;
    ws.mergeCells(`H${row}:${LAST_COL}${row}`);
    const vc = ws.getCell(`H${row}`);
    vc.value = val;
    vc.numFmt = MONEY;
    vc.alignment = { horizontal: 'right', vertical: 'middle' };
    vc.border = ALL_BORDERS;
    if (strong) {
      lc.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      vc.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      ws.getRow(row).height = 24;
    } else {
      lc.font = { bold: true, size: 10, color: { argb: NAVY } };
      vc.font = { size: 10 };
    }
    row += 1;
  }

  // ── 메모 ──
  if (quote.memo) {
    row += 1;
    ws.getCell(`A${row}`).value = '비고';
    ws.getCell(`A${row}`).font = { bold: true, size: 10, color: { argb: NAVY } };
    row += 1;
    ws.mergeCells(`A${row}:${LAST_COL}${row + 2}`);
    const mc = ws.getCell(`A${row}`);
    mc.value = quote.memo;
    mc.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    mc.font = { size: 10 };
    mc.border = ALL_BORDERS;
  }

  return wb;
}

module.exports = { buildQuoteWorkbook };

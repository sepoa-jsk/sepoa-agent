'use strict';
// Excel 생성 테스트 (DB 불필요) — 워크북이 생성되고 합계/인감이 반영되는지 확인
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildQuoteWorkbook } = require('../lib/excel');

const quote = {
  quote_no: 'S20260707001',
  quote_date: '2026-07-07',
  valid_until: null,
  customer_name: '테스트고객(주)',
  customer_contact: '홍길동 과장',
  supply_amount: 18000000,
  discount_amount: 500000,
  vat_amount: 1750000,
  total_amount: 19250000,
  memo: '납품조건: 계약 후 30일',
  sections: [
    {
      solution: 'ESEAL', deployment: 'ONPREM', company_class: 'ENT', contract_months: 1, subtotal: 18000000,
      items: [
        { category: '솔루션', name: 'POA Seal™', spec: '인감날인', qty: 1, unit: '식', months: 1, unit_price: 18000000, amount: 18000000, note: '' },
      ],
    },
  ],
};

const settings = {
  supplier_name: '세포아소프트(주)',
  supplier_biz_no: '119-81-95026',
  supplier_ceo: '이희림',
  supplier_address: '서울특별시 구로구 디지털로31길 62, 아티스포럼 714~717호',
};

test('buildQuoteWorkbook — 유효한 xlsx 버퍼 생성', async () => {
  const wb = await buildQuoteWorkbook(quote, settings);
  const buf = await wb.xlsx.writeBuffer();
  assert.ok(buf.length > 1000, '엑셀 버퍼가 비정상적으로 작음');
});

test('buildQuoteWorkbook — 재로딩 시 합계/공급자/견적번호 반영', async () => {
  const wb = await buildQuoteWorkbook(quote, settings);
  const buf = await wb.xlsx.writeBuffer();

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  const ws = wb2.getWorksheet('견적서');
  assert.ok(ws, '견적서 시트 없음');

  // 셀 값 스캔
  const texts = [];
  ws.eachRow((rowObj) => rowObj.eachCell((cell) => texts.push(String(cell.value))));
  assert.ok(texts.includes('S20260707001'), '견적번호 누락');
  assert.ok(texts.some((t) => t.includes('세포아소프트')), '공급자명 누락');
  assert.ok(texts.includes('19250000') || texts.includes('19,250,000'), '합계금액 누락');
});

test('buildQuoteWorkbook — 인감 이미지가 워크북에 포함', async () => {
  const wb = await buildQuoteWorkbook(quote, settings);
  // ExcelJS: 이미지가 등록되면 media 배열에 존재
  assert.ok(wb.media && wb.media.length >= 1, '인감 이미지가 포함되지 않음');
  assert.equal(wb.media[0].extension, 'png');
});

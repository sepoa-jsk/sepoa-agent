'use strict';
// SW협회 노임단가 → 기준단가 산정 (PDF 검증식).
//   ⚠️ avgRaw·overhead·tech 는 중간 반올림하지 않고 raw 로 계산하고,
//      마지막에 합계만 한 번 반올림해야 PDF와 1원 오차 없이 일치한다.
//   avgRaw   = daily_rate × work_days
//   overhead = avgRaw × overhead_rate
//   tech     = (avgRaw + overhead) × tech_rate
//   기준단가 = round(avgRaw + overhead + tech)
function calcStandardRate(std) {
  const avgRaw = Number(std.daily_rate) * Number(std.work_days || 20.5);
  const overhead = avgRaw * Number(std.overhead_rate || 1.1);
  const tech = (avgRaw + overhead) * Number(std.tech_rate || 0.2);
  return Math.round(avgRaw + overhead + tech);
}

// 인력구분(code) → 협회직군 매핑 → 해당 연도 협회단가 → 기준단가.
// query 는 lib/db.js 의 query 헬퍼(프로미스, 배열 반환)를 인자로 받는다.
// 매핑이 없거나 해당 연도 협회단가가 없으면 null.
async function getLaborBaseRate(query, roleCode, year) {
  const roles = await query(
    'SELECT standard_role_code FROM sq_labor_roles WHERE code=?', [roleCode]);
  if (!roles.length || !roles[0].standard_role_code) return null;
  const stdCode = roles[0].standard_role_code;
  const stds = await query(
    'SELECT * FROM sq_labor_standards WHERE year=? AND role_code=?', [year, stdCode]);
  if (!stds.length) return null;
  return calcStandardRate(stds[0]);
}

module.exports = { calcStandardRate, getLaborBaseRate };

// 리스크 계수 상수 — 한 곳에 모아 둔다.
//
// 이동 계획:
//   작업 12  이 목록을 엔진(src/domain/labor/risk-factor.js)으로 옮겨 인건비에 실제 반영
//   작업 13  sq_mst_risk_factor 마스터로 옮기고 화면은 마스터를 조회
// 지금은 화면에 체크리스트만 노출하며 **인건비에 반영되지 않는다**.
// 값을 여기 말고 다른 곳에 복사해 두지 말 것.
export const RISK_FACTORS = [
  { code: 'NO_REMOTE', label: '원격 개발 불가', desc: '고객사 상주만 허용. 이동·대기 시간이 공수에 포함된다', factor: 1.8, type: 'MULTIPLY' },
  { code: 'FINANCE', label: '금융권', desc: '보안심사·망분리·감사 대응 공수', factor: 1.4, type: 'MULTIPLY' },
  { code: 'PUBLIC', label: '공공기관', desc: '조달 절차·산출물 양식 대응', factor: 1.3, type: 'MULTIPLY' },
  { code: 'INTERFACE', label: '인터페이스 연동', desc: '건당 추가 공수', factor: 0.5, type: 'ADD_MM', unit: '건' },
  { code: 'LEGACY', label: '레거시 이관', desc: '기존 데이터 이관·정합성 검증', factor: 1.25, type: 'MULTIPLY' },
  { code: 'MULTI_SITE', label: '다중 사업장', desc: '거점별 배포·교육', factor: 1.2, type: 'MULTIPLY' },
];

export const FACTOR_NOTE =
  '계수는 아직 인건비 계산에 반영되지 않습니다. 작업 12(엔진)·작업 13(마스터) 이후 적용됩니다.';

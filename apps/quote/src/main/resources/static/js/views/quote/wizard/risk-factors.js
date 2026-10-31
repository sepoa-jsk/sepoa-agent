// 리스크 계수 — 기준정보 > 리스크 계수 화면에서 고친다(2026-10-31). 설정(sq_settings) 'risk_factors' 에 JSON 으로 둔다.
//
// 설정에 값이 없으면 아래 기본값을 쓴다. 견적 작성 4단계는 loadRiskFactors() 로 한 번 읽어 RISK_FACTORS 를 채운다
// (배열을 바꿔 끼우지 않고 내용만 바꾼다 — 이 배열을 가져다 쓰는 곳이 그대로 새 값을 본다).
// 지금은 화면에 체크리스트만 노출하며 **인건비에 반영되지 않는다**.
import { api } from '../../../api.js';

export const RISK_KEY = 'risk_factors';
// type: MULTIPLY(공수 × 계수) | ADD_MM(건당 공수 + 계수, unit 은 건 등)
export const DEFAULT_RISK_FACTORS = [
  { code: 'NO_REMOTE', label: '원격 개발 불가', desc: '고객사 상주만 허용. 이동·대기 시간이 공수에 포함된다', factor: 1.8, type: 'MULTIPLY' },
  { code: 'FINANCE', label: '금융권', desc: '보안심사·망분리·감사 대응 공수', factor: 1.4, type: 'MULTIPLY' },
  { code: 'PUBLIC', label: '공공기관', desc: '조달 절차·산출물 양식 대응', factor: 1.3, type: 'MULTIPLY' },
  { code: 'INTERFACE', label: '인터페이스 연동', desc: '건당 추가 공수', factor: 0.5, type: 'ADD_MM', unit: '건' },
  { code: 'LEGACY', label: '레거시 이관', desc: '기존 데이터 이관·정합성 검증', factor: 1.25, type: 'MULTIPLY' },
  { code: 'MULTI_SITE', label: '다중 사업장', desc: '거점별 배포·교육', factor: 1.2, type: 'MULTIPLY' },
];

export const RISK_FACTORS = DEFAULT_RISK_FACTORS.map((f) => ({ ...f }));
let loaded = false;
export const riskLoaded = () => loaded;

// 설정의 값(JSON 배열) — 없거나 깨졌으면 null
export function parseRiskFactors(raw) {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((f) => f && f.code) : null;
  } catch { return null; }
}

export async function loadRiskFactors() {
  try {
    const { settings } = await api.getSettings();
    const list = parseRiskFactors(settings && settings[RISK_KEY]);
    if (list) RISK_FACTORS.splice(0, RISK_FACTORS.length, ...list);
  } catch { /* 기본값 그대로 */ }
  loaded = true;
  return RISK_FACTORS;
}

export const FACTOR_NOTE =
  '계수는 아직 인건비 계산에 반영되지 않습니다. 계수 값은 기준정보 > 리스크 계수에서 고칩니다.';

-- ============================================================
-- price_items 마스터 연결 (022_procure_items_link.sql)
-- block 값 + 마스터 참조코드 채우기. 샘플 잔재는 active=0.
-- 견적서 3블록(온프): SOLUTION/LABOR/THIRDPARTY. SaaS: SAAS_SERVICE/SAAS_ETC.
-- 재실행 안전(UPDATE).
-- ============================================================
SET NAMES utf8mb4;

-- ── 샘플 잔재 비활성화 (히스토리 보존 위해 삭제 아님) ──────
UPDATE sq_price_items SET active=0
  WHERE code IN ('PRO_ONP_LIC','PRO_ONP_SETUP','PRO_ONP_MAINT','PRO_ONP_CUSTOM',
                 'PRO_SAAS_USER','PRO_SAAS_CUSTOM');

-- ── [온프] ① 솔루션 블록 → module_code ────────────────────
UPDATE sq_price_items SET block='SOLUTION', module_code='SOURCING' WHERE code='PRO_ONP_SOURCING';
UPDATE sq_price_items SET block='SOLUTION', module_code='ORDERING' WHERE code='PRO_ONP_ORDERING';
UPDATE sq_price_items SET block='SOLUTION', module_code='CONTRACT' WHERE code='PRO_ONP_CONTRACT';
UPDATE sq_price_items SET block='SOLUTION', module_code='EV'       WHERE code='PRO_ONP_EV';
UPDATE sq_price_items SET block='SOLUTION', module_code='COMMON'   WHERE code='PRO_ONP_COMMON';

-- ── [온프] ② 인건비 블록 → labor_role_code ────────────────
UPDATE sq_price_items SET block='LABOR', labor_role_code='PI'   WHERE code='PRO_ONP_PI';
UPDATE sq_price_items SET block='LABOR', labor_role_code='PMO'  WHERE code='PRO_ONP_PMO';
UPDATE sq_price_items SET block='LABOR', labor_role_code='PM'   WHERE code='PRO_ONP_PM';
UPDATE sq_price_items SET block='LABOR', labor_role_code='DEV'  WHERE code='PRO_ONP_DEV';
UPDATE sq_price_items SET block='LABOR', labor_role_code='UIUX' WHERE code='PRO_ONP_UIUX';
UPDATE sq_price_items SET block='LABOR', labor_role_code='TA'   WHERE code='PRO_ONP_TA';
UPDATE sq_price_items SET block='LABOR', labor_role_code='QAO'  WHERE code='PRO_ONP_QAO';

-- ── [온프] ③ 3rd party 블록 → thirdparty_code ─────────────
UPDATE sq_price_items SET block='THIRDPARTY', thirdparty_code='PKI'      WHERE code='PRO_ONP_PKI';
UPDATE sq_price_items SET block='THIRDPARTY', thirdparty_code='PKI_EASY' WHERE code='PRO_ONP_PKI_EASY';

-- ── [SaaS] 서비스 이용료 → service_type ───────────────────
UPDATE sq_price_items SET block='SAAS_SERVICE', service_type='S2C'      WHERE code='PRO_SAAS_S2C';
UPDATE sq_price_items SET block='SAAS_SERVICE', service_type='S2P'      WHERE code='PRO_SAAS_S2P';
UPDATE sq_price_items SET block='SAAS_SERVICE', service_type='P2P'      WHERE code='PRO_SAAS_P2P';
UPDATE sq_price_items SET block='SAAS_SERVICE', service_type='SOURCING' WHERE code='PRO_SAAS_SOURCING';

-- ── [SaaS] 기타(셋업/부가/옵션) → SAAS_ETC ────────────────
UPDATE sq_price_items SET block='SAAS_ETC'
  WHERE code IN ('PRO_SAAS_SETUP','PRO_SAAS_BIA','PRO_SAAS_INFRA_S2C','PRO_SAAS_INFRA_S2P',
                 'PRO_SAAS_OPT_EVAL','PRO_SAAS_OPT_BUDGET','PRO_SAAS_OPT_QUALITY','PRO_SAAS_OPT_STOCK');
-- 견적 근거 메일 (2026-11-02, 사용자 요청: "이 견적서의 근거를 위해 고객사로 부터 온 메일을 연결하는 기능")
--
-- source_mail  고객사에서 온 메일 — JSON {"url": 메일 링크, "text": 붙여넣은 메일 본문}. 없으면 NULL.
--              메일 본문에서 고객 담당자 · 연락처 · 이메일을 뽑아 기본정보에 채운다(화면 쪽 일).
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_quotes`
  ADD COLUMN IF NOT EXISTS `source_mail` mediumtext DEFAULT NULL COMMENT '근거 메일 {url, text}' AFTER `memo`;

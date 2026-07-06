# sepoa-blog-harness

세포아소프트 네이버 블로그(blog.naver.com/sepoa0127) 콘텐츠 발행 하네스.
하이브리드 운영: 폴더는 진실의 원천(GitHub), 실행은 Claude Code.

## 폴더 구조
```
sepoa-blog-harness/
├── CLAUDE.md            # 브랜드·파이프라인·가드레일 (항상 읽힘)
├── DESIGN.md            # 이미지 시각 규칙
├── spec.md             # 이번 글의 상위기획 (글마다 새로 채움)
├── drafts/             # 본문 초안 저장
├── images/             # 이미지 프롬프트 저장
└── .claude/
    ├── skills/         # 파이프라인 4단계
    │   ├── title-select/
    │   ├── keyword-approve/
    │   ├── write-body/
    │   └── image-prompt/
    └── agents/
        └── evaluator.md   # 발행 전 검증 (Read 전용)
```

## 쓰는 법
1. 이 폴더에서 터미널을 열고 `claude` 실행.
2. `spec.md`를 이번 글 내용으로 채운다.
3. "이 spec으로 블로그 글 만들어줘" 라고 지시.
4. 파이프라인이 자동 진행되며 3개 스톱포인트에서 멈춰 승인을 요청한다:
   - 제목 선택 → 키워드 승인 → 이미지 텍스트 승인
5. `/evaluator`가 PASS를 낼 때까지 검증 루프.
6. 최종 초안(drafts/)과 이미지 프롬프트(images/)를 네이버 블로그에 붙여넣기.

## 팀 공유
폴더째 GitHub에 push → 팀원이 clone 후 `claude` 켜면 동일 규격 적용.

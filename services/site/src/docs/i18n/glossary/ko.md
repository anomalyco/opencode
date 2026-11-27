# Korean (ko) glossary and style

OpenCode V2 docs (`src/docs/content/ko/`) and the Console marketing dictionary (`packages/site/src/i18n/ko/` in
anomalyco/opencode-console) share these decisions. The English column of the shared `../glossary.md` still applies; this
file records how Korean renders those rows and the terms the shared file leaves to the language.

## Style

- 합니다체. Definitions and explanations end in `-입니다` / `-합니다`; steps and instructions end in `-하세요`
  (`다운로드하세요`, `설정하세요`). No `-한다`, no `-해요`.
- Short, declarative sentences in Korean word order. Break an English sentence with a dash or semicolon into separate
  Korean sentences instead of copying the punctuation.
- No colons before a list of examples; make it a sentence. Avoid starting a sentence with `그것은` / `이것은`.
- Keep one English word per Korean term (table below) everywhere, including headings and table cells.
- Do not add particles inside code spans, product names or file names. Write `opencode.json` 파일, not `opencode.json`을.
- Numbers, prices, dates and versions come from the English unchanged: `$10`, `$40`, `$20`, `14일`, `v0.1.48`, `600조`.
  Korean number units attach without a space to the numeral (`5분`, `30일`, `1M 토큰`).
- Bold English UI labels quoted from the product stay English inside the bold markers: **Settings › Members**,
  **Invite Members**, **Send invitations**, **Add credits**.
- Korean quotes are `“…”`; ellipsis is `…`.

## Terms

| English | Korean | Notes |
| --- | --- | --- |
| agent | 에이전트 | Never `에이전트` inside a code span; compounds: 코딩 에이전트, 하위 에이전트 |
| subagent | 서브에이전트 | |
| child agent | 하위 에이전트 | |
| agentic coding | 에이전트 코딩 | |
| Console (the product) | Console | 제품명. `the Console` → `Console`. Bold UI labels keep it too |
| workspace | 워크스페이스 | Personal workspace → 개인 워크스페이스 |
| team | 팀 | Go Teams stays English |
| member / members | 멤버 | The Members page title → 멤버 |
| owner / admin / member (roles) | 소유자 / 관리자 / 멤버 | |
| account | 계정 | Never 계좌 |
| sign in / sign out | 로그인 / 로그아웃 | `sign in` as a verb → 로그인하세요 |
| authentication / authenticate | 인증 / 인증하다 | Never 인증 확인 |
| authentication method / auth method | 인증 방식 | |
| token (OAuth, access, bearer, API) | 토큰 | Token counts stay `토큰` (`1M 토큰`) |
| API key | API 키 | Never API 키값 |
| provider (model provider) | 제공자 | 커스텀 제공자, 모델 제공자, ID 공급자 is the exception below |
| identity provider | ID 공급자 | Okta, Microsoft Entra ID, Google Workspace |
| inference | 추론 | |
| credits | 크레딧 | Never 포인트 |
| balance | 잔액 | Top up → 충전 |
| budget | 예산 | |
| spend limit | 지출 한도 | |
| billing | 결제 | `billing address` → 청구지 주소 |
| invoice | 청구서 | `invoiced monthly` → 월 단위 청구 |
| subscription | 구독 | |
| plan | 요금제 | Free plan → 무료 요금제 |
| seat | 시트 | `seat fees` → 시트 요금 |
| refund | 환불 | |
| usage | 사용량 | |
| request | 요청 | |
| rate limit | 요청 한도 | `rate-limited` → 요청 한도에 걸린 |
| policy / policies | 정책 | `policy statement` → 정책 선언 |
| permission | 권한 | Permission rules → 권한 규칙 |
| session | 세션 | |
| prompt | 프롬프트 | |
| context | 컨텍스트 | |
| context window | 컨텍스트 윈도 | 압축 문서에서 짧게 `window`라고도 함 |
| compaction | 압축 | Page title Compaction → 압축 |
| summarize | 요약 | |
| tool / tool call | 도구 / 도구 호출 | |
| effective tool name | 최종 도구 이름 | 네임스페이스와 문자 치환을 반영한 이름 |
| skill | 스킬 | |
| plugin | 플러그인 | |
| command / slash command | 명령어 / 슬래시 명령어 | |
| command palette | 명령어 팔레트 | |
| formatter | 포매터 | |
| linter | 린터 | |
| theme | 테마 | |
| keybind / keybinds | 키바인드 | |
| pill (GUI) | 캡슐형 항목 | Composer pills → 입력창의 캡슐형 항목. pill button → 캡슐형 버튼. `ComposerPill` stays English |
| snapshot | 스냅샷 | |
| checkpoint | 체크포인트 | |
| attachment | 첨부 파일 | |
| worktree | 워크트리 | |
| canonical checkout | 기준 체크아웃 | Worktree and plugin docs |
| repository / branch / commit | 저장소 / 브랜치 / 커밋 | |
| pull request / issue | 풀 리퀘스트 / 이슈 | |
| diff (the viewer, its output or section) | diff | Generic difference → 차이, 변경 사항 |
| harness | harness | Keep English, also in compounds (harness 페이지) |
| profile (Codex) | profile | Keep English |
| gateway | 게이트웨이 | |
| proxy (network) | 프록시 | |
| loopback | 루프백 | |
| transcript | 대화 기록 | |
| telemetry / trace | 텔레메트리 / 트레이스 | OpenTelemetry 관측 데이터 |
| scrollback | 스크롤백 | |
| bundle | 번들 | |
| expose (API, endpoint, tool, RPC) | 제공 | Public network exposure → 노출 |
| deprecated / deprecation | 더 이상 권장하지 않음 / 사용 비권장 | 제거 only when actually removed |
| raised surfaces | 떠 있는 UI 요소 | |
| base URL | 기본 URL | |
| web search | 웹 검색 | |
| service account | 서비스 계정 | |
| directory sync | 디렉터리 동기화 | |
| invitation / invite | 초대 | |
| role | 역할 | |
| Free (price or tier label) | 무료 | |
| pay-as-you-go | 종량제 | |
| allowance | 사용 한도 / 지출 한도 | Go limits → 사용 한도; budgets → 지출 한도. Do not confuse with usage (사용량). |
| markup | 마크업 | |
| zero retention | 데이터 보존 없음 | `ZDR` stays `ZDR` |
| train on your data | 내 데이터로 학습 | |
| region | 리전 | |
| private network | 프라이빗 네트워크 | |
| firewall | 방화벽 | |
| virtual machine | 가상 머신 | |

Keep in English: OpenCode, Zen, Go, Go Plus, Go Teams, Desktop, Console, MCP, LSP, SDK, CLI, API, TUI, JSON, JSONC,
YAML, SSE, OAuth, OIDC, SAML, SCIM, SSO, ZDR, harness, ACP, and every provider, model, company, app and tool name.

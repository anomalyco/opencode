# OpenCode 심층 분석

작성일: 2026-03-14
최종 수정: 2026-03-17

소스: <https://github.com/anomalyco/opencode>

## 한눈에 보기

- **replay 기반 아키텍처**: DB의 `message + parts` event log와 next prompt는 의도적으로 다르다. 저장은 풍부하게, replay는 continuation에 필요한 것만.
- **3층 context 관리**: tool output truncation(payload-local) / session prune(old payload weakening) / compaction(history-level boundary rewrite)이 분리된 계층으로 동작한다.
- **provider 추상화**: Vercel AI SDK 위에 구축. provider별 base prompt, cache hint, reasoning metadata 처리를 각각 분기한다.
- **file-backed planning**: plan file + synthetic reminder + transition tool의 조합으로 장기 계획을 관리한다.
- **Permission Ruleset + Doom Loop**: 동일 tool+input 3회 반복 감지, ruleset 기반 allow/deny/ask로 안전성을 확보한다.

---

## 1. 컨텍스트 엔지니어링

### 1-1. MCP와 Skill

OpenCode에서 MCP와 skill은 서로 다른 context surface로 처리된다.

#### Skill tool이 특별한 이유

OpenCode는 세 프로젝트(Codex, OpenCode, OpenClaw) 중 유일하게 **skill 로딩 자체를 별도 tool로** 만들었다. Claude Code의 `Skill` tool과 유사하지만, OpenCode는 이것을 완전한 first-class tool로 구현하여 tool description 안에 간략 목록, system prompt 안에 verbose 목록이라는 **이중 노출** 전략을 취한다. 소스코드(`tool/skill.ts`, `skill/skill.ts`, `session/system.ts`)에서 확인한 동작을 정리한다.

**1. Skill tool의 parameter schema**

parameter는 `{ name: z.string() }` 딱 하나뿐이다. description에 동적으로 예시가 포함된다:

```typescript
// tool/skill.ts — 실제 schema 생성부
const parameters = z.object({
  name: z.string().describe(`The name of the skill from available_skills (e.g., 'commit', 'review-pr', ...)`),
})
```

skill이 하나도 없으면 description이 “No skills are currently available.”로 바뀐다.

**2. Tool description의 실제 구조**

`SkillTool`의 `init()`이 호출될 때 `Skill.available(agent)`로 현재 agent의 permission에서 deny되지 않은 skill 목록을 가져온다. 이 목록으로 tool description 문자열을 동적으로 구성한다:

```
Load a specialized skill that provides domain-specific instructions and workflows.

When you recognize that a task matches one of the available skills listed below,
use this tool to load the full skill instructions.

The skill will inject detailed instructions, workflows, and access to bundled
resources (scripts, references, templates) into the conversation context.

Tool output includes a `<skill_content name=”...”>` block with the loaded content.

The following skills provide specialized sets of instructions for particular tasks
Invoke this tool to load a skill when a task matches one of the available skills listed below:

## Available Skills
- **commit**: Create conventional commits following project conventions
- **review-pr**: Review pull requests with structured feedback
(간략 형태 — Skill.fmt(list, { verbose: false }))
```

**3. System prompt에서의 verbose 노출**

`system.ts`의 `SystemPrompt.skills(agent)`가 system prompt에 별도 블록으로 주입된다. 여기서는 `Skill.fmt(list, { verbose: true })`를 사용하여 XML 형태의 상세 목록을 노출한다:

```xml
Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.
<available_skills>
  <skill>
    <name>commit</name>
    <description>Create conventional commits following project conventions</description>
    <location>file:///Users/user/.claude/skills/commit/SKILL.md</location>
  </skill>
  <skill>
    <name>review-pr</name>
    <description>Review pull requests with structured feedback</description>
    <location>file:///Users/user/project/.opencode/skills/review-pr/SKILL.md</location>
  </skill>
</available_skills>
```

**왜 두 곳에 다른 형태로 넣는가**: LLM의 판단 시점이 다르기 때문이다.

| | System prompt (verbose XML) | Tool description (간략 markdown) |
|---|---|---|
| 위치 | system message (매 turn) | tools 파라미터의 skill tool description |
| 역할 | “이런 skill들이 존재한다” — 배경 인지 | “skill tool을 이렇게 호출하라” — 실행 가이드 |
| LLM 판단 | “지금 skill을 쓸 상황인가?” | “name 파라미터에 뭘 넣지?” |

코드 주석에 이중 노출의 의도가 명시되어 있다: *”the agents seem to ingest the information about skills a bit better if we present a more verbose version of them here and a less verbose version in tool description, rather than vice versa.”* 한 곳에만 넣으면 모델이 skill 존재를 놓치는 경우가 있어서, 이중 노출로 인지 확률을 높인 것이다. 경험적 판단이라고 명시되어 있다.

**4. Execute 시 전체 흐름**

모델이 `skill({ name: “commit” })` tool을 호출하면:

1. `Skill.get(“commit”)` → SKILL.md를 frontmatter(`name`, `description`) + markdown body로 파싱
2. permission check: `ctx.ask({ permission: “skill”, patterns: [“commit”], always: [“commit”] })`
3. `Ripgrep.files()`로 SKILL.md 디렉터리 내 파일 목록 수집 (SKILL.md 자체는 제외, 최대 10개)
4. 아래 형태의 tool output을 반환:

```
<skill_content name=”commit”>
# Skill: commit

(SKILL.md의 markdown body 전문)

Base directory for this skill: file:///path/to/.claude/skills/commit
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.
Note: file list is sampled.

<skill_files>
<file>/path/to/.claude/skills/commit/scripts/run.sh</file>
<file>/path/to/.claude/skills/commit/reference/convention.md</file>
</skill_files>
</skill_content>
```

반환 객체의 구조:
```typescript
{
  title: “Loaded skill: commit”,           // UI 표시용
  output: “<skill_content name=...>...”,   // ← LLM이 보는 tool result
  metadata: { name: “commit”, dir: “/path/to/.claude/skills/commit” }
}
```

**5. Skill은 instruction 로드이지 실행이 아니다**

skill tool이 반환하는 것은 **SKILL.md 본문 + 하위 파일 경로 목록**이다. skill 안의 스크립트나 템플릿을 실행하는 것은 skill tool의 역할이 아니며, LLM이 본문을 읽고 `bash`, `read` 등 일반 tool로 직접 실행한다.

```
skill({ name: "commit" })
  → tool result: SKILL.md 본문 + <skill_files> 경로 목록   ← 여기까지가 skill tool

LLM이 본문의 지침을 읽고 판단:
  → read({ filePath: ".claude/skills/commit/scripts/run.sh" })  ← 일반 tool
  → bash({ command: ".claude/skills/commit/scripts/run.sh" })   ← 일반 tool
```

**6. Context에 남는 방식 — 프로젝트별 비교**

skill 본문과 하위 파일 경로가 **tool result**로 전달되므로, context 수명이 일반 tool output과 동일하다. 이는 세 프로젝트가 각각 다른 메커니즘을 쓴다는 점에서 중요하다:

| 프로젝트 | skill 전달 형태 | LLM이 인식하는 역할 |
|---|---|---|
| **Codex** | 대화 히스토리 내 **user message** (`<skill>` 태그) | “사용자가 준 지시” |
| **OpenCode** | **tool result** (`<skill_content>` 태그) | “과거에 조회한 정보” |
| **OpenClaw** | `read` tool로 SKILL.md를 읽은 **tool result** | “과거에 조회한 정보” |

이 차이가 context 수명과 모델 attention에 직접 영향을 준다:

| | user message 삽입 (Codex) | tool result append (OpenCode, OpenClaw) |
|---|---|---|
| **prune 대상** | 안 됨 — user message는 prune하지 않음 | **됨** — 오래되면 `”[cleared]”`로 교체 |
| **모델 attention** | “사용자 지시”로 취급 → 더 강한 attention | “과거 조회 정보”로 취급 → 상대적으로 약함 |
| **prompt cache** | input 앞부분에 끼워넣기 → **로딩 시 기존 prefix cache 깨짐** | 대화 흐름에 append → **기존 prefix cache 유지** |
| **compaction 시** | summary에 흡수 | 동일하게 summary에 흡수 |

트레이드오프가 명확하다:
- **Codex** (user message): skill이 prune되지 않고 모델이 “지시”로 인식하므로 **더 오래, 더 강하게** 유지된다. 하지만 skill 로딩 시 input prefix에 끼워넣기 때문에 **prompt cache가 깨진다.**
- **OpenCode** (tool result): skill이 일반 tool output으로 취급되어 prune 대상이고 attention이 약하다. 하지만 대화 흐름에 append되므로 **prompt cache를 보존한다.** 또한 skill 로딩이 명시적 tool call이므로, “언제 어떤 skill을 로드했는지”가 transcript에 기록되어 디버깅이 쉽다.

구체적으로:
- 로드 직후 turn에서는 당연히 보임
- 이후 turn에서도 prune/compact 되기 전까지 계속 보임
- prune 대상이 되면 `”[Old tool result content cleared]”`로 교체 — skill 지침이 사라짐
- compaction이 발생하면 summary에 흡수되어 원문은 사라지지만 핵심은 유지될 가능성이 높음
- 별도의 “skill 재로드” 메커니즘은 없음 — 같은 skill을 다시 호출하면 동일한 tool result가 다시 생성됨

**SKILL.md 탐색 순서** (후순위가 동명 skill을 덮어씀):
1. 글로벌: `~/.claude/skills/**/SKILL.md`, `~/.agents/skills/**/SKILL.md`
2. 프로젝트: worktree까지 `.claude/skills/**/SKILL.md`, `.agents/skills/**/SKILL.md`
3. `.opencode/{skill,skills}/**/SKILL.md` (opencode 고유 경로)
4. `config.skills.paths`에 지정된 추가 경로
5. `config.skills.urls`에서 원격 index.json → 파일 다운로드 → 캐시 디렉터리

즉 skill은 `system prompt catalog + tool-based lazy load`다. skill 본문은 호출 시점까지 context에 들어가지 않는다. skill 디렉터리 내 번들 파일(scripts, templates 등)의 경로까지 함께 노출해서, 로드 직후 `read`/`bash`로 번들 리소스에 접근할 수 있게 설계되어 있다.

#### "목록은 고정, 본문만 동적" 원칙과 prompt cache

세 프로젝트(Codex, OpenCode, OpenClaw) 모두 skill 목록을 system prompt에 넣는다. 세션 중간에 skill을 동적으로 추가/삭제하면 system prompt가 바뀌어 prompt cache가 깨질 것이므로, **목록은 세션 수준에서 고정하고 본문만 동적으로 로드**하는 설계를 공유한다.

```
캐시 안정 영역 (system prompt — 세션 내 고정)
┌──────────────────────────────────────────┐
│  ## Available Skills                      │
│  - commit: Create conventional commits... │  ← 목록만. 세션 시작 시 결정.
│  - review-pr: Review pull requests...     │     매 turn 동일 → cache stable
└──────────────────────────────────────────┘

동적 영역 (대화 히스토리 — append only)
┌──────────────────────────────────────────┐
│  assistant: skill({ name: "commit" })     │  ← 호출 시에만
│  tool: <skill_content>본문...</>           │     append → prefix 안 건드림
└──────────────────────────────────────────┘
```

| 시점 | 무엇이 결정되는가 | system prompt 변경? | cache 영향 |
|---|---|---|---|
| 세션/attempt 시작 | skill 목록 스캔 (SKILL.md 탐색) | 이 시점에 한 번 결정 | 없음 |
| 매 turn | system prompt 재조립 | **동일한 목록** → 변경 없음 | cache hit |
| skill tool 호출 시 | skill 본문 로드 | **변경 없음** — tool result로 감 | cache hit |

세션 중간에 SKILL.md 파일을 추가/삭제해도 현재 세션의 system prompt는 바뀌지 않는다. 변경은 다음 세션(또는 다음 attempt)에 반영된다. MCP tool도 마찬가지로, 연결 시점에 `listTools()`로 definition을 가져오고 매 turn 재연결하지 않는다.

이 원칙은 skill뿐 아니라 **system prompt에 들어가는 모든 것에 적용**된다: instruction files, environment info, tool registry 모두 세션/attempt 수준에서 결정되고, 대화 중 동적으로 바뀌는 정보는 messages에 append한다. prompt cache를 보존하면서 lazy loading을 가능하게 하는 핵심 설계다.

#### MCP vs Skill 비교 테이블

MCP의 tool/resource/prompt 각각이 어떤 context surface로 들어가는지, skill과 대비한 비교:

| 측면 | Skill | MCP tool | MCP resource | MCP prompt |
|---|---|---|---|---|
| **prompt에 노출** | system prompt에 verbose XML + `skill` tool 1개의 description에 간략 목록 (이중 노출) | 각 MCP tool이 개별 tool definition으로 노출 | 노출 안됨 (사용자가 attach해야 함) | `/` command 목록에 `<client>:<prompt>` 형태로 등록 |
| **definition 비용** | **고정 1개** — skill이 10개여도 `skill` tool definition 1개 + description에 목록만 | **N개** — MCP tool 10개면 10개 definition이 매 API 호출마다 포함 (모든 built-in tool도 마찬가지) | 없음 | 없음 |
| **본문 로딩 시점** | lazy — 모델이 `skill` tool 호출 시 | eager — MCP 연결 시 `listTools()`로 definition 로드. 본문(result)은 호출 시 | 사용자 action 시 (UI에서 resource attach) | 사용자가 `/` command 실행 시 |
| **context surface** | tool result (assistant tool_call → tool response 쌍) | tool result (assistant tool_call → tool response 쌍) — built-in tool과 동일 | user message 내 synthetic text part (`synthetic: true`) | user message의 text part (command template 치환 결과) |
| **LLM에 보이는 형태** | `<skill_content name=”...”>` XML 블록 (markdown body + file 목록) | 일반 tool과 동일 — JSON tool result | `”Reading MCP resource: {name} ({uri})”` + 리소스 텍스트 내용 (synthetic text parts) | 일반 user message와 동일 (template의 `$1` 등이 치환된 텍스트) |
| **permission 체계** | `permission: “skill”`, pattern은 skill name | agent permission에서 `mcp_<client>_<tool>` 로 제어 | 별도 permission 없음 (사용자가 직접 attach하므로) | 별도 permission 없음 (사용자가 직접 실행하므로) |
| **context 수명** | tool result로서 prune/compaction 대상 | tool result로서 prune/compaction 대상 — built-in tool과 동일 | 해당 user message가 history에 있는 동안 유지 | 해당 user message가 history에 있는 동안 유지 |

**MCP 3-way 분산의 상세**:

MCP의 `tool / resource / prompt`가 서로 다른 context surface로 분산되어 있다:

- **tool**: `MCP.tools()`에서 `<client>_<tool>` 이름으로 AI SDK `dynamicTool`로 변환. built-in tool과 같은 레벨로 merge됨. tool result 내 `resource` type content는 `resource.text`를 텍스트로, `resource.blob`를 base64 file attachment로 분리 추출.
- **resource**: `createUserMessage()` 단계에서 처리. `part.source.type === “resource”`이면 `MCP.readResource(clientName, uri)`를 호출하고, 반환된 contents를 `synthetic: true` text part로 펼침. 실제 payload 예시:
  ```
  [TextPart] synthetic=true “Reading MCP resource: schema.sql (postgres://schema)”
  [TextPart] synthetic=true “(리소스의 text 내용)”
  [FilePart] source={type:”resource”, clientName, uri}  ← 원본 part 유지
  ```
- **prompt**: `Command` namespace에서 command template로 변환. MCP prompt의 arguments를 `$1`, `$2` ... 위치 변수로 치환한 뒤, `MCP.getPrompt()`의 응답에서 `messages[].content.text`를 `\n`으로 join하여 하나의 template 문자열로 만듦. 이 template은 `/` command와 동일하게 실행됨.

**내장 tool inventory** (3층 구조):

| 계층 | 도구 |
|---|---|
| 정적 built-in | `read`, `glob`, `grep`, `edit`, `write`, `apply_patch`, `bash`, `task`, `skill`, `webfetch`, `websearch`, `question`, `plan_exit`, `todowrite`, `codesearch`, `lsp`(experimental) |
| turn별 임시 도구 | `StructuredOutput` (json_schema format일 때만) |
| runtime 동적 도구 | MCP tool (`<client>_<tool>`), plugin tool (`{tool,tools}/*.{js,ts}`에서 로드) |

수정 도구는 모델별로 달라진다: `gpt-*` 계열(gpt-4, oss 제외)에는 `apply_patch`만, 그 외에는 `edit`+`write`만. `codesearch`/`websearch`는 opencode provider이거나 exa flag가 켜져 있어야 등록된다. `Plugin.trigger(“tool.definition”, ...)`으로 플러그인이 tool description/schema를 런타임에 수정할 수 있다.

### 1-2. Plan mode와 Todo

planning과 todo가 서로 다른 substrate에 놓여 있다.

| 구성요소 | 저장 위치 | 수명 | 다음 prompt 반영 방식 |
|---|---|---|---|
| plan mode | 매 턴 synthetic `<system-reminder>` | turn-scoped | 마지막 user message 말단에 강한 reminder 주입 |
| plan file | `.opencode/plans/<created>-<slug>.md` | persistent (파일) | 모델이 `read`로 직접 로드 |
| `plan_exit` | transition tool | one-shot | synthetic user message + agent switch |
| todo | SQLite `TodoTable` | session-scoped | 자동 주입 없음 (UI에서만 조회 가능) |

#### Plan mode 상세

**활성화 방식**: plan mode는 사용자가 agent를 `plan`으로 전환할 때 활성화된다. `agent.ts`에서 `plan` agent는 native agent로 정의되어 있으며, `mode: “primary”`로 build와 동등한 최상위 agent다. 사용자가 UI에서 직접 plan agent를 선택하거나, build agent가 `plan_enter` tool을 호출(현재 주석 처리됨)하여 진입할 수 있다.

단, plan mode 전체가 feature flag `OPENCODE_EXPERIMENTAL_PLAN_MODE` 뒤에 있다. flag가 꺼져 있으면 `PlanExitTool`도 registry에 등록되지 않고, reminder 주입도 구버전 로직(단순 `PROMPT_PLAN` 텍스트 주입)으로 동작한다.

**plan agent의 permission 제한** (`agent.ts`에서 확인):

```typescript
plan: {
  permission: PermissionNext.merge(
    defaults,  // “*”: “allow” 기본
    {
      question: “allow”,
      plan_exit: “allow”,
      external_directory: { [path.join(Global.Path.data, “plans”, “*”)]: “allow” },
      edit: {
        “*”: “deny”,                                           // ← 모든 edit 차단
        [“.opencode/plans/*.md”]: “allow”,                    // ← plan file만 허용
        [path.relative(worktree, Global.Path.data + “/plans/*.md”)]: “allow”,
      },
    },
    user,  // 사용자 config로 추가 override 가능
  ),
}
```

핵심: `edit: { “*”: “deny” }`로 모든 파일 수정을 차단하되, plan file 경로만 예외적으로 허용한다. `write` tool은 별도 제한이 없으므로 plan file 생성은 가능하다. `bash`, `read`, `glob`, `grep` 등 읽기 도구는 defaults의 `”*”: “allow”`로 모두 허용된다.

**매 turn 주입되는 synthetic reminder** (experimental flag 활성화 시):

`prompt.ts`의 `insertReminders()`에서 plan agent 진입 시 마지막 user message 말단에 `<system-reminder>` 블록을 추가한다. 핵심 텍스트:

```
<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet --
you MUST NOT make any edits (with the exception of the plan file mentioned below),
run any non-readonly tools (including changing configs or making commits), or otherwise
make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
No plan file exists yet. You should create your plan at
.opencode/plans/1710000000000-my-session.md using the write tool.
(또는: A plan file already exists at {path}. You can read it and make incremental edits using the edit tool.)
You should build your plan incrementally by writing to or editing this file.
NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow
### Phase 1: Initial Understanding
... Launch up to 3 explore agents IN PARALLEL ...
### Phase 2: Design
... Launch general agent(s) to design the implementation ...
### Phase 3: Review
... Read the critical files identified by agents ...
### Phase 4: Final Plan
... Write your final plan to the plan file ...
### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy
with your final plan file - you should always call plan_exit ...
This is critical - your turn should only end with either asking the user a question
or calling plan_exit.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to
request plan approval. Do NOT use question tool to ask “Is this plan okay?” -
that's what plan_exit does.
</system-reminder>
```

이 reminder는 `synthetic: true` text part로 DB에도 저장되며, 매 turn의 `insertReminders()` 호출 시 agent가 `plan`이고 이전 assistant가 `plan`이 아닌 경우(진입 시점)에만 주입된다. **이미 plan mode에 있는 동안의 후속 turn에서는 다시 주입되지 않는다** — 이전 turn의 reminder가 history에 남아 있기 때문이다.

**plan file 경로 생성 규칙**: `Session.plan()`이 `{worktree}/.opencode/plans/{session.time.created}-{session.slug}.md`를 반환. git repo가 아니면 `{Global.Path.data}/plans/` 하위로 이동. 디렉터리가 없으면 `fs.mkdir(dirname, { recursive: true })`로 자동 생성한다.

**plan mode에서 사용 가능한 질문/종료 tool**:

plan mode의 prompt가 명시적으로 `question`과 `plan_exit` 두 tool의 용도를 구분한다:

| tool | plan mode에서의 역할 | 예시 |
|---|---|---|
| `question` | 요구사항/접근방식 **명확화** | "DB는 PostgreSQL인가요 MySQL인가요?" |
| `plan_exit` | 계획 **승인 요청** + mode 전환 | "이 계획으로 진행할까요?" |

prompt 원문: *"Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask 'Is this plan okay?' — that's what plan_exit does."*

즉 `question`은 정보 수집, `plan_exit`는 계획 확정이다. "이 계획 괜찮나요?"를 `question`으로 묻는 것은 prompt에서 금지하고 있다 — 그건 `plan_exit`의 역할이다.

**plan_exit 실행 시 전체 흐름**:

1. 현재 session의 plan file 경로를 계산 (`Session.plan(session)`)
2. 사용자에게 `Question.ask()`로 확인 UI 표시:
   ```
   “Plan at .opencode/plans/1710...-my-session.md is complete.
    Would you like to switch to the build agent and start implementing?”
   [Yes] Switch to build agent and start implementing the plan
   [No]  Stay with plan agent to continue refining the plan
   ```
3. “No”이면 `Question.RejectedError`를 throw → plan mode 유지, tool 결과는 에러로 처리
4. “Yes”이면:
   - 마지막 user message의 model을 가져옴 (`getLastModel()`)
   - 새 user message를 생성하여 DB에 저장:
     ```typescript
     {
       role: “user”,
       agent: “build”,    // ← plan에서 build로 agent switch
       model: lastModel,
     }
     ```
   - 그 안에 synthetic text part를 추가:
     ```
     “The plan at .opencode/plans/1710...-my-session.md has been approved,
      you can now edit files. Execute the plan”
     ```
   - tool result로 `”User approved switching to build agent. Wait for further instructions.”` 반환

5. 다음 loop에서 `insertReminders()`가 **plan→build 전환**을 감지 (현재 agent가 build이고 이전 assistant가 plan). **마지막 user message에 `synthetic: true` text part를 추가**하여 BUILD_SWITCH reminder를 주입한다. 새 message가 아니라 기존 user message에 part를 덧붙이는 방식:
   ```json
   // LLM에 나가는 user message
   {
     "role": "user",
     "content": [
       { "type": "text", "text": "이제 구현해줘" },              // 사용자 실제 입력
       { "type": "text", "text": "Your operational mode has changed from plan to build.\nYou are no longer in read-only mode.\nYou are permitted to make file changes, run shell commands, and utilize your arsenal of tools as needed.\n\nA plan file exists at .opencode/plans/1710...-my-session.md.\nYou should execute on the plan defined within it" }
       // ↑ synthetic part — plan mode reminder도 같은 패턴
     ]
   }
   ```
   plan mode 진입 시의 Phase 1-5 workflow reminder도 동일한 방식으로 마지막 user message에 synthetic text part로 추가된다. tool result나 system message가 아닌 **user message 말단 삽입**이므로, LLM은 이를 사용자의 지시로 인식한다.

**plan mode 전체 흐름 요약**:

```
사용자 → plan agent 선택
  ↓
[insertReminders] <system-reminder> 주입 (Phase 1-5 workflow)
  ↓
모델: explore agent로 코드 탐색 → general agent로 설계 → plan file에 기록
  ↓
모델: plan_exit tool 호출
  ↓
[plan_exit] 사용자에게 “Switch to build?” 질문
  ↓ Yes
synthetic user message (agent: “build”) + “Execute the plan” 생성
  ↓
[insertReminders] BUILD_SWITCH reminder + plan file 경로 주입
  ↓
build agent가 plan file을 read하고 실행 시작
```

#### Todo 상세

**todowrite의 parameter schema**:

```typescript
parameters: z.object({
  todos: z.array(z.object({
    content: z.string().describe(“Brief description of the task”),
    status: z.string().describe(“Current status of the task: pending, in_progress, completed, cancelled”),
    priority: z.string().describe(“Priority level of the task: high, medium, low”),
  })).describe(“The updated todo list”),
})
```

**전체 리스트를 매번 덮어쓰는 방식**이다. 부분 업데이트가 아니라, 호출할 때마다 `DELETE + INSERT`로 해당 session의 모든 todo를 교체한다:

```typescript
// session/todo.ts — Todo.update()
Database.transaction((db) => {
  db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()  // 전부 삭제
  db.insert(TodoTable).values(
    input.todos.map((todo, position) => ({
      session_id: input.sessionID,
      content: todo.content,
      status: todo.status,
      priority: todo.priority,
      position,  // 배열 순서가 position으로
    }))
  ).run()
})
```

tool result는 업데이트된 todo 리스트를 JSON으로 반환한다:
```typescript
{
  title: “3 todos”,  // 미완료 항목 수
  output: JSON.stringify(params.todos, null, 2),  // LLM이 보는 결과
  metadata: { todos: params.todos }  // 프레임워크용
}
```

**todoread가 빠진 이유: 모델 호환성 문제**

`TodoReadTool`은 코드 자체는 완전히 구현되어 있다 (`todo.ts`에 `TodoWriteTool`과 나란히 정의됨). 하지만 `registry.ts`에서 `// TodoReadTool`로 주석 처리되어 등록되지 않는다.

GitHub issues에서 경위를 확인할 수 있다:

1. Qwen 등 non-Claude 모델이 todo tool을 **hallucinate**하거나 인자를 **잘못된 JSON**으로 보내는 문제가 반복 발생 ([#1336](https://github.com/anomalyco/opencode/issues/1336), [#1783](https://github.com/anomalyco/opencode/issues/1783))
2. maintainer(thdxr)가 2025-08 commit `5cc44c87`로 Qwen에서 todo tools 비활성화: *”disable todo tools for qwen models to improve compatibility”*
3. 이후 재활성화 시도 ([#2498](https://github.com/anomalyco/opencode/issues/2498)) → collaborator: *”will be fixed in next release”*
4. 하지만 재발 → maintainer: *”going to go back to disabling”* ([#1783](https://github.com/anomalyco/opencode/issues/1783) 코멘트)
5. 현재: registry에서 주석 처리 상태

즉 **todoread가 빠진 1차 이유는 non-Claude 모델의 tool calling 품질 문제**다. 특히 Qwen 계열에서 `todos` 배열 인자를 JSON string으로 직렬화하거나, 존재하지 않는 `todo_write`/`todolist` 같은 이름을 hallucinate하는 문제가 해결되지 않아 tool 자체를 비활성화한 것이다.

**2차 이유로 설계적 합리성도 있다**: todowrite가 **전체 리스트를 매번 덮어쓰는** 방식이므로, tool result에 최신 상태가 그대로 돌아온다. 즉 **write가 곧 read**이기도 하다:

```
todowrite({ todos: [
  { content: “handler.go 수정”, status: “completed”, priority: “high” },
  { content: “middleware.go 수정”, status: “in_progress”, priority: “high” },
  { content: “테스트 추가”, status: “pending”, priority: “medium” }
]})

→ tool result: 위 리스트가 그대로 반환됨
→ 다음 turn에서 모델이 history를 보면 최신 상태를 알 수 있음
```

system prompt도 “매 단계마다 todowrite를 빈번하게 호출하라”고 강하게 지시한다:

```
IMPORTANT: Always use the TodoWrite tool to plan and track tasks throughout the conversation.
```

이 패턴이면 todoread는 tool definition 1개만큼의 token 비용만 추가하면서 모델 호환성 문제를 악화시키는 셈이다.

**단, compaction 이후에는 gap이 있다**: compaction이 일어나면 이전 todowrite의 tool result가 summary에 흡수되거나 prune될 수 있다. 이 시점에서 모델은 현재 todo 상태를 모른다. todoread가 있었다면 DB에서 최신 상태를 조회할 수 있겠지만, 현재는 그 경로가 없다.

**todo가 다음 prompt에 반영되는 방식**:

prompt.ts에서 todo를 자동 주입하는 로직은 **존재하지 않는다**. todo는 순수하게:
- **LLM 측**: todowrite의 tool result로 현재 상태를 확인 (방금 쓴 내용이 그대로 돌아오므로)
- **사용자 측**: UI에서 `GET /session/:id/todo` API로 조회
- **다음 turn의 LLM**: history에 남아 있는 이전 todowrite tool result를 통해 간접적으로 인지 (prune/compaction 전까지)

#### Plan + Todo의 관계

**plan file과 todo는 동기화되지 않는다.** 완전히 독립적인 두 메커니즘이다.

역할 분담:

| | Plan file | Todo |
|---|---|---|
| **용도** | 장기 계획 — “무엇을 어떤 순서로 할 것인가” | 단기 진행 추적 — “지금 어디까지 했는가” |
| **저장소** | 파일시스템 (.opencode/plans/*.md) | SQLite (TodoTable) |
| **수명** | session을 넘어 영구 — git에 커밋될 수도 있음 | session-scoped — 세션이 끝나면 접근 불가 |
| **생성 주체** | plan agent (write/edit tool) | build agent (todowrite tool) |
| **다음 turn 인지** | 모델이 `read`로 직접 로드 | 이전 todowrite의 tool result로 간접 인지 |
| **사용자 가시성** | 파일로 직접 열어볼 수 있음 | UI의 todo 패널에서 실시간 확인 |

일반적 워크플로우에서 plan file은 “설계도”, todo는 “체크리스트”로 기능한다. plan mode에서 plan file을 작성한 뒤 build mode로 전환하면, build agent가 plan file을 읽고 todowrite로 실행 단계를 체크리스트화하는 것이 의도된 패턴이다. 하지만 이 연결은 순전히 프롬프트 지시에 의존하며, 코드 레벨의 자동화는 없다.

### 1-3. 상시 컨텍스트의 이중 구조

**항상 켜지는 컨텍스트 표면**:

1. **provider system prompt**: 모델별 분기. `claude` → `PROMPT_ANTHROPIC`, `gpt-*/o1/o3` → `PROMPT_BEAST`, `gemini-` → `PROMPT_GEMINI`, 기타 → `PROMPT_ANTHROPIC_WITHOUT_TODO` (qwen.txt). 공통 header로 `PROMPT_CODEX`(codex_header.txt)가 항상 붙음.
2. **instruction 파일 계층**
3. **환경 정보 `<env>` 블록**
4. **skill 목록** (system prompt 내 verbose XML)

**instruction 파일의 탐색 순서**:

프로젝트 instruction은 `AGENTS.md` → `CLAUDE.md` → `CONTEXT.md` 순서로 `findUp`(현재 디렉터리부터 worktree까지 상위 탐색). **처음 발견되는 파일명에서 멈춤** (AGENTS.md가 있으면 CLAUDE.md는 로드하지 않음). 글로벌 instruction도 마찬가지로 첫 발견에서 멈춤:
- `OPENCODE_CONFIG_DIR/AGENTS.md` → `~/.config/opencode/AGENTS.md` → `~/.claude/CLAUDE.md` (claude code 호환)

추가로 `config.instructions` 배열에 상대 경로(`globUp`), 절대 경로(glob), `~/` 경로, URL을 지정할 수 있고, URL은 `fetch(url, {timeout: 5000})`으로 가져옴. 모든 instruction은 `”Instructions from: “ + path + “\n” + content` 형태로 join됨.

**`<env>` 블록의 실제 내용**:

```
You are powered by the model named claude-sonnet-4-20250514. The exact model ID is anthropic/claude-sonnet-4-20250514
Here is some useful information about the environment you are running in:
<env>
  Working directory: /Users/user/project
  Workspace root folder: /Users/user/project
  Is directory a git repo: yes
  Platform: darwin
  Today's date: Tue Mar 18 2026
</env>
```

**날짜와 prompt cache**: `Today's date`는 `new Date().toDateString()`으로 매 loop 진입 시 생성되므로, **날짜가 바뀌면 `<env>` 블록이 바뀌고 cache가 깨진다.** PR [#14743](https://github.com/anomalyco/opencode/pull/14743)에서 이 문제를 인식하고 `OPENCODE_EXPERIMENTAL_CACHE_STABILIZATION=1` 플래그로 날짜를 프로세스 lifetime 동안 freeze하는 실험적 해결책을 제시했다. 또한 같은 PR에서 `<env>` 블록을 stable 블록(provider prompt + global AGENTS.md)과 분리하여, 날짜가 바뀌어도 stable 블록의 cache는 보존되도록 했다.

**하위 디렉토리 AGENTS.md의 lazy 주입**: `read` tool의 execute 콜백 안에서, 파일 내용을 읽은 뒤 `InstructionPrompt.resolve()`를 자동 호출한다. 이 함수가 읽은 파일의 디렉토리부터 프로젝트 루트까지 상위로 올라가면서 `AGENTS.md`/`CLAUDE.md`/`CONTEXT.md`를 찾고, 발견되면 tool result 말미에 `<system-reminder>` 태그로 붙여준다. **read tool의 description에는 이 동작에 대한 언급이 없다** — LLM은 이 주입을 요청하지 않으며, harness가 투명하게 처리한다. 대상은 **AGENTS.md 계열 instruction 파일만**이다 (일반 소스 파일이 아님).

```
/project/
  AGENTS.md              ← system prompt에 로드 (전역 규칙)
  backend/
    AGENTS.md            ← read("backend/src/handler.go") 시 tool result에 붙음
  frontend/
    AGENTS.md            ← read("frontend/src/App.tsx") 시 tool result에 붙음
```

루트의 AGENTS.md는 이미 system prompt에 있으므로 skip. 같은 세션/메시지에서 이미 로드된 것도 중복 주입하지 않음.

실제 tool result:
```
<content>
1: package api
...
(End of file - total 42 lines)
</content>

<system-reminder>
Instructions from: /project/backend/AGENTS.md
(해당 AGENTS.md의 전문)
</system-reminder>
```

monorepo에서 디렉토리별로 다른 규칙을 두고, 해당 파일에 접근했을 때만 관련 규칙을 lazy로 주입하는 패턴이다.

### 1-4. 저장 포맷과 프롬프트 포맷의 분리

OpenCode의 본질은 SQLite에 저장된 세션이 곧 다음 prompt가 아니라는 점이다.

- **내부 canonical truth**: `message + parts` event log (DB)
- **next prompt**: provider용 메시지로 재구성한 결과물

세션은 “프롬프트 덤프”가 아니라 **replay 가능한 운영 로그**다.

`MessageV2`의 part 유형과 DB/replay 차이:

| Part | DB 저장 | Replay 변환 |
|---|---|---|
| `text` | 텍스트 + metadata + synthetic flag | `ignored=true`면 건너뜀, 아니면 그대로 text |
| `reasoning` | text + provider metadata | 같은 모델이면 `providerMetadata` 유지, 다르면 제거 |
| `tool` (completed) | status, input, output, attachments, metadata, time.compacted | prune됨(`time.compacted` 있음) → `”[Old tool result content cleared]”`. 아니면 정상 output. media attachment는 provider별 분기 |
| `tool` (pending/running) | 일시적 상태 — process() 종료 시 `error: “Tool execution aborted”`로 강제 전환 | `”[Tool execution was interrupted]”` error result (Anthropic API가 모든 tool_use에 대응하는 tool_result 요구) |
| `tool` (error) | error text, input, time | error text 그대로 tool result로 전달 |
| `step-start` / `step-finish` | snapshot hash, cost, tokens | step-start만 UIMessage로 전달, step-finish는 필터링 |
| `patch` | hash, files[] | 사용 안 함 (변환에서 무시) |
| `subtask` | agent, model, command, prompt | `”The following tool was executed by the user”` 짧은 text |
| `compaction` | auto, overflow | `”What did we do so far?”` user text |
| `file` | mime, url, source, filename | media(image/pdf)이면 file part, text/plain이면 무시, directory이면 무시 |
| `retry` | attempt, error, time | 변환에서 무시 |

**Tool 상태 전이**:

```
tool-input-start → pending (LLM이 tool call 시작, 인자 미완성)
tool-call        → running (인자 완성, execute 콜백 실행 중)
tool-result      → completed (정상 완료)
tool-error       → error (실행 실패 또는 permission 거부)
```

pending/running은 **일시적 상태**다. 유저 인터럽트, 네트워크 에러, 프로세스 종료 등으로 stream이 중간에 끊기면 pending/running 상태로 남을 수 있다. 이 경우 `process()` 종료 시 미완료 tool을 전부 `error: "Tool execution aborted"`로 강제 전환한다. 프로세스가 갑자기 죽어서 DB에 pending으로 남아있더라도, 다음 replay 시 `"[Tool execution was interrupted]"` error result로 처리된다. 이는 Anthropic API가 모든 `tool_use`에 대응하는 `tool_result`를 요구하기 때문이다.

**`filterCompacted()`의 compaction boundary 결정 로직**:

compaction은 2개 메시지 쌍으로 구성된다:

```
user message  (compaction part):  “What did we do so far?”
  └→ assistant message (summary=true):  “## Goal\n...”    ← parentID = user message ID
```

`filterCompacted()`는 **최신→과거** 순으로 역순회하면서 “summary가 성공적으로 생성된 compaction 쌍”을 찾는다:

1. assistant message에 `summary=true` + `finish` + error 없음이면 → 이 assistant의 `parentID`(= compaction user message의 ID)를 기록
2. user message에 `compaction` part가 있고, 그 ID가 1에서 기록한 것이면 → **여기서 중단**

compaction user message는 있지만 summary assistant가 실패/미완료인 경우(= 1에 기록되지 않음)는 무시하고 더 과거의 compaction을 찾는다. 결과적으로 “가장 최근의 성공적으로 완료된 compaction boundary”가 결정되고, 그 이전의 모든 메시지가 replay에서 제외된다.

**media in tool result 처리**: Anthropic/OpenAI SDK는 tool result 내 media를 지원하지만, 기타 OpenAI-호환 provider는 string만 허용. 이 경우 media attachment를 추출해서 별도의 synthetic user message(`”Attached image(s) from tool result:”`)로 assistant message 뒤에 끼워 넣는다. 이것은 DB에는 없는 replay-only 메시지다.

### 1-5. Long-term Memory

독립 memory subsystem 대신 여러 artifact가 memory 역할을 나눠 가진다:

- **compaction summary**: `SessionCompaction.process()`가 context overflow 시 자동 실행. 오래된 메시지를 요약으로 압축하고, 원본의 tool part에 `time.compacted` timestamp를 찍어 output을 제거함.
- **session diff**: `step-start`와 `step-finish` part의 snapshot hash를 비교(`Snapshot.diffFull(from, to)`)하여 `Snapshot.FileDiff[]`(file, additions, deletions)를 계산. `Storage.write([“session_diff”, sessionID], diffs)`로 키-값 저장소에 저장. 메시지 단위(`summarizeMessage`)와 세션 단위(`summarizeSession`) 두 레벨로 집계됨.
- **transcript 자체**: `filterCompacted()` 이후 남은 최근 turn들이 정밀 상태를 유지.
- **plan file**: 장기 작업 계획의 working memory. 파일 시스템에 `.opencode/plans/` 하위 markdown으로 존재.
- **session row의 운영 state**:
  - `summary`: `{ additions, deletions, files, diffs? }` — 세션 전체 변경량
  - `revert`: `{ messageID, partID?, snapshot?, diff? }` — 되돌리기용 상태
  - `permission`: `PermissionNext.Ruleset` — 세션별 tool 권한 규칙
  - `time.compacting`: compaction 진행 중 timestamp
  - `time.archived`: 아카이브 timestamp
  - `slug`, `title`, `version`, `share_url` 등 메타데이터

memory를 하나의 retriever DB보다 `여러 종류의 외부화된 작업 흔적`으로 다루는 방식이다. 특히 session diff는 “무엇이 바뀌었는가”를, compaction summary는 “무엇을 했는가”를, plan file은 “무엇을 할 것인가”를 각각 담당하며, 이 세 가지가 서로 다른 시점의 working memory로 기능한다.

---

## 2. System Prompt 조립

**핵심 파일**: `packages/opencode/src/session/system.ts`, `instruction.ts`, `prompt.ts`, `llm.ts`

OpenCode의 유효 prompt stack은 겉보기에는 하나의 system message처럼 조립되지만, 실제 transport 단계에서는 cache 안정성과 provider 경로에 따라 다시 분기된다.

```typescript
// 개념적 조립
system =
  provider_or_agent_prompt
  + environment
  + skills
  + instruction files
  + optional structured-output instruction
  + optional user.system

// 단, 전송 직전에는 provider/plugin 조건에 따라 다시 분기될 수 있음
```

조립 순서:

1. **Provider-specific base prompt**: Claude -> `anthropic.txt`, GPT -> `beast.txt`, Gemini -> `gemini.txt` 등
2. **Environment info**: `<env>` 태그 안에 모델명, cwd, git 여부, platform, 날짜
3. **Skills 목록**: 사용 가능한 skill들의 verbose 설명
4. **Instruction files**: `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md` (프로젝트/글로벌 디렉토리 탐색)
5. **Structured output prompt**: json_schema format일 때만
6. **User-level system prompt**: 유저 메시지에 첨부

```
┌─ system message ────────────────────────┐
│  1. provider별 base prompt (.txt)        │
│  2. <env> environment info               │
│  3. skills 목록                          │
│  4. instruction files (AGENTS.md 등)     │
│  5. structured output prompt (선택)      │
│  6. user system prompt (선택)            │
└──────────────────────────────────────────┘
┌─ tools 파라미터 ────────────────────────┐
│  ToolRegistry.tools() → resolveTools()   │
│  built-in + custom + MCP                 │
└──────────────────────────────────────────┘
```

**설계 특이점**: 대부분의 stable context는 system 계열로 모으지만, 실제 transport 단계에서는 provider/plugin 조건에 따라 2-part system 구조를 유지해 cache 안정성을 살리거나, Codex/OpenAI OAuth 경로처럼 base prompt를 `system message`가 아니라 `options.instructions`로 보내기도 한다. 즉 “단일 system string”은 내부 표현에 가깝고, 실제 전송 표면은 provider-aware하게 다시 정리된다.

또 한 가지 중요한 층이 더 있다. `provider transform`은 단순 cache hint를 넘어서 replay portability의 핵심 역할을 한다.

- toolCallId 정규화
- empty message 제거
- reasoning part를 provider 전용 필드로 이동
- unsupported media를 placeholder/텍스트로 치환
- providerOptions key remap

즉 OpenCode의 prompt 품질은 system prompt 문장만이 아니라, `DB event log -> provider-specific replay transform` 계층에서 크게 결정된다.

**provider별 base prompt를 분리하는 이유**: 각 모델의 tool calling 문법, reasoning 특성, 출력 스타일이 다르므로 base prompt를 모델 family마다 다르게 가져간다. 이는 단일 universal prompt보다 각 모델의 강점을 더 잘 활용할 수 있지만, prompt 관리 복잡도가 늘어나는 트레이드오프가 있다.

---

## 3. Agentic Loop

**핵심 파일**: `packages/opencode/src/session/prompt.ts` -- `SessionPrompt.loop()`, `processor.ts` -- `SessionProcessor.process()`

OpenCode는 **2중 루프**를 사용한다.

### 외부 루프: `SessionPrompt.loop()`

세션 수준 제어를 담당한다.

```
User Input
  └→ SessionPrompt.prompt()
       └→ createUserMessage()
       └→ SessionPrompt.loop()
            └→ while(true) {
                 1. MessageV2.filterCompacted()로 메시지 히스토리 로드
                 2. 종료 조건 체크
                    if lastAssistant.finish not in ["tool-calls","unknown"]
                      && lastUser.id < lastAssistant.id → break
                 3. pending subtask/compaction 처리
                 4. context overflow 선제 체크 (isOverflow → compaction task)
                 5. SessionProcessor.process() 호출 (내부 루프)
                 6. 결과 분기: "stop" → break / "compact" → continue / "continue" → step++
                 7. max steps 체크 → MAX_STEPS prompt 주입
               }
            → SessionCompaction.prune()  // 오래된 tool output 정리
```

### 내부 루프: `SessionProcessor.process()`

2가지 역할: ① `streamText()` 1회 호출 + stream event 소비(DB 저장), ② retryable 에러 시 재시도.

```
processor.process()
  └→ while(true) {
       try {
         streamText(maxSteps 미설정 = 기본 1) 호출
           → LLM 호출 1회
           → tool call이면: SDK가 execute 콜백 호출 → tool result 수신
           → stream 종료 (SDK는 여기서 끝 — LLM 재호출 안 함)
           → OpenCode: stream event를 순차 소비하며 DB에 tool part 저장
         → break
       } catch {
         if ContextOverflowError → needsCompaction=true → break
         if retryable error → backoff → continue (재시도)
         if PermissionRejected → blocked=true → break
         else → error 기록 → break
       }
     }
  → 미완료 tool을 전부 error로 강제 전환
  → return "stop" | "compact" | "continue"
```

**`maxSteps`가 설정되지 않으므로 SDK 기본값 1이 적용된다.** 즉 SDK는 LLM 1회 호출 + tool 실행까지만 하고 stream을 종료한다. tool result 이후 LLM 재호출은 SDK가 아니라 **외부 루프(`SessionPrompt.loop()`)**가 담당한다 — 다음 iteration에서 이전 messages + tool result를 포함하여 새 `process()`를 호출한다. `while(true)`가 반복되는 것은 retryable 에러 시 재시도할 때뿐이다.

### 루프 종료 조건

- `lastAssistant.finish`가 `"stop"` 또는 `"length"` (tool call이 아닌 종료)
- `processor.process()`가 `"stop"` 반환 (permission rejection, 에러)
- `abort.aborted` (사용자 취소)
- `step >= maxSteps`
- `structuredOutput` 캡처 완료

### Tool call 실행

OpenCode의 모든 tool은 Vercel AI SDK의 `tool()` 함수에 `execute` 콜백을 등록한다. `maxSteps`가 설정되지 않으므로(기본 1), SDK는 **LLM 1회 호출 + tool call이면 execute 콜백 1회 호출**까지만 하고 stream을 종료한다. SDK 내부에 "tool loop"은 없다.

permission 체크, truncation, subagent 생성은 모두 execute 콜백 안에서 일어나며, SDK는 그 내용을 모른다. tool result 이후 LLM 재호출은 SDK가 아니라 **외부 루프(`SessionPrompt.loop()`)**가 담당한다 — 다음 iteration에서 이전 messages + tool result를 포함하여 새 `process()`를 호출한다.

OpenCode는 stream에서 발생하는 `tool-input-start` → `tool-call` → `tool-result`/`tool-error` 이벤트를 순차적으로 DB에 영속화한다. compaction/prune는 `streamText()` 종료 후 외부 루프에서 처리된다.

명시적 병렬 실행은 **`BatchTool`**(experimental)이 유일하게 제공한다. 최대 25개 tool call을 `Promise.all`로 병렬 실행한다.

**BatchTool의 구체적 동작**:

- 모델이 `batch` tool을 호출하면, `invocations` 배열에 담긴 최대 25개의 개별 tool call을 동시에 실행
- 각 tool call은 독립적인 `Promise`로 래핑되어 `Promise.all`로 병렬 처리
- 하나가 실패해도 나머지는 계속 진행 (개별 error result 반환)
- 실무 시나리오: 여러 파일을 동시에 `read`하거나, 여러 디렉토리를 동시에 `glob`하는 경우 latency를 크게 줄임
- 단, write 계열 tool을 batch로 병렬 실행하면 race condition이 발생할 수 있으므로, permission ruleset과 함께 사용해야 안전

### Vercel AI SDK 사용의 트레이드오프

OpenCode는 LLM 호출과 tool 실행에 Vercel AI SDK의 `streamText()`를 사용한다. 단, `maxSteps`를 설정하지 않으므로(기본 1) SDK는 **LLM 1회 호출 + execute 콜백 1회**까지만 담당한다. tool result 이후 LLM 재호출, compaction/prune, overflow 감지는 모두 OpenCode 외부 루프(`SessionPrompt.loop()`)가 처리한다.

**SDK가 담당하는 것**: LLM API 호출, streaming, tool call 파싱, execute 콜백 호출, provider 추상화 (Anthropic/OpenAI/Google 등 동일 인터페이스)

**OpenCode가 담당하는 것**: tool result를 포함한 messages로 다음 `streamText()` 호출, stream event의 DB 저장, compaction/prune, permission, doom loop 감지

**장점**: provider별 API 차이(streaming 프로토콜, tool call 형식, 에러 응답)를 SDK가 추상화하므로 multi-provider 지원이 쉽다.

**단점**: execute 콜백 안에서만 개입 가능하고, SDK의 LLM 호출/streaming 동작 자체는 커스텀할 수 없다. SDK가 제공하는 확장 포인트에 의존해야 한다. 예:
- **tool call repair** (`experimental_repairToolCall`): LLM이 잘못된 tool 이름을 보내면 SDK가 이 콜백을 호출한다. 대소문자 오류(예: `Read` → `read`)는 자동 수정. 그래도 매칭 안 되면 `invalid` dummy tool로 라우팅하여 에러 메시지를 tool result로 반환 — LLM이 다음 시도에서 올바른 이름을 쓸 수 있게 한다. 이 repair가 없으면 SDK가 에러를 throw하여 stream이 끊긴다.

**다른 프로젝트와의 비교**:

| | LLM 호출 | tool 실행 | tool result → 다음 LLM 호출 |
|---|---|---|---|
| **Codex** | 자체 Rust 코드 | 자체 코드 (RwLock 병렬) | 자체 코드 — 모든 단계를 직접 제어 |
| **OpenCode** | SDK `streamText()` | SDK가 execute 콜백 호출 | **외부 루프** — SDK 밖에서 messages 재조립 후 새 `streamText()` |
| **OpenClaw** | pi-agent-core | pi-agent-core (내부) | pi-agent-core — 단 `before_tool_call` hook으로 개입 가능 |

---

## 4. Compaction과 Overflow 관리

### 4-1. Compaction 트리거

핵심 판정 함수는 `SessionCompaction.isOverflow()`다. 직전 assistant 호출의 usage를 기준으로 위험도를 판단한다.

```text
count = tokens.total
     || (tokens.input + tokens.output + tokens.cache.read + tokens.cache.write)

reserved = config.compaction.reserved
        || min(20_000, maxOutputTokens(model))

usable = model.limit.input
       ? model.limit.input - reserved
       : model.limit.context - maxOutputTokens(model)

if count >= usable:
  overflow_or_compact
```

주요 특성:
- `tokens.reasoning`은 compaction 판정식에 직접 더하지 않음
- `model.limit.input`이 있으면 우선 사용, 없으면 `model.limit.context - maxOutputTokens(model)`
- 기본 reserve는 `min(20_000, maxOutputTokens(model))`

### 4-2. 체크 시점 (3곳)

3곳 모두 같은 `isOverflow()` 공식을 쓰지만, **체크 시점과 반응이 다르다**:

| 위치 | 시점 | 반응 | 핵심 차이 |
|---|---|---|---|
| **외부 루프 시작** (`prompt.ts`) | `process()` 호출 **전** — 직전 assistant의 tokens로 판단 | compaction task 생성 → `streamText()` 호출 안 함 | **API 비용을 쓰기 전에** 줄인다 |
| **stream 소비 중** (`processor.ts` finish-step) | `streamText()` 실행 **중** — step 완료 시 usage로 판단 | `needsCompaction=true` → stream 조기 종료 → `"compact"` 반환 | 호출은 했지만 **다음 호출 전에** 줄인다 |
| **catch** (`processor.ts` catch) | LLM이 context overflow 에러를 **반환한 후** | `needsCompaction=true` → `"compact"` 반환 | **사후 복구** — 이미 에러가 발생한 상태 |

**왜 3곳이 필요한가**: 외부 루프 시작 시점에는 직전 turn의 tokens만 알고, 이번 turn에서 tool call로 얼마나 늘어날지 모른다. 200K 모델에서 150K 사용 중이면 외부 루프 체크(`150K < 180K`)를 통과하지만, tool call이 40K를 추가하면 finish-step에서 잡히고(`190K >= 180K`), 그마저 놓치면 LLM이 overflow 에러를 반환하여 catch에서 잡힌다.

### 4-3. Compaction boundary

compaction의 실제 앵커는 두 메시지 쌍이다:
- `compaction` user message
- 그 `parentID`를 가리키는 `summary: true` assistant message

`filterCompacted()`가 최신 유효 compaction 경계를 찾고, 그 이전 prefix를 replay에서 제거한다.

```text
prefix (replay에서 사라짐):
  - compaction boundary 이전의 모든 메시지

suffix (다음 prompt에 들어감):
  - compaction user message
  - summary: true assistant message
  - 그 이후의 모든 user/assistant/tool 흐름
```

continuity는 prefix 원문이 아니라 **assistant summary text**에 실린다. 요약문은 별도 메모리 테이블이 아니라 일반 assistant text part로 남으므로, transcript 내부의 새 anchor가 된다.

overflow compaction에서는 추가로: 현재 작업 지시와 가장 가까운 user message를 새 user message로 재앵커링해서, 요약 이후에도 현재 작업의 원문성이 유지되게 한다.

**예시**:

```text
원래 DB 순서:
m1 user: "버그 찾아"
m2 assistant: tool(read), tool(bash), step-finish
m3 user: "테스트도 돌려"
m4 assistant: tool(bash), step-finish
m5 user: compaction{auto:true}
m6 assistant(summary=true): "## Goal ... ## Discoveries ..."
m7 user: "이제 실패 케이스도 고쳐"
m8 assistant: tool(read)

다음 prompt replay:
1. user: "What did we do so far?"      # m5 변형본
2. assistant: "## Goal ..."            # m6 summary text
3. user: "이제 실패 케이스도 고쳐"      # m7
4. assistant: tool(read) ...            # m8
```

`m1~m4`는 prefix로 DB에는 남지만, next prompt에서는 사라진다.

### 4-4. Prune (old tool output weakening)

compaction과 별개로 동작하는 payload-level 정리다. **매 loop 종료마다 항상 실행**되며, compaction 여부와 무관하다. "compaction 먼저, prune 나중"은 둘 다 발생할 때의 순서이지, compaction이 prune의 전제 조건은 아니다.

#### prune의 주 역할: compaction을 최대한 늦추기

compaction은 비용이 크다 (별도 LLM 호출 + 정보 손실). prune은 비용이 거의 없다 (DB에 timestamp 하나 찍기). 따라서 prune으로 context를 가볍게 유지하다가, 그래도 넘치면 compaction하는 구조다.

```
prune 없으면:  ████████████████████████████ 180K → compaction!
prune 있으면:  ████████░░░░████████████████ 140K → 아직 여유
                      ↑ 오래된 tool output cleared
```

#### prune이 실제로 효과를 내는 시나리오

| 시나리오 | 효과 |
|---|---|
| **compaction 미발생 + prune 발생** (가장 흔함) | tokens 120K (usable 180K 미만 → compaction 안 함). 하지만 오래된 tool output이 40K 보호 밖에 있어 prune → token 절약 → compaction 시점을 늦춤 |
| **compaction 직후 + prune** (드뭄) | suffix가 작아서 prune 대상이 거의 없음 → 실질 효과 없음 |
| **compaction 이후 여러 턴 진행** | 새로 쌓인 tool output 중 오래된 것이 40K 보호 밖으로 밀림 → 다시 prune 효과 있음 |

#### Prune 알고리즘

1. 최신에서 과거로 역순 순회
2. 최근 2 user-turn은 보호
3. 이전 summary assistant를 만나면 그보다 더 과거는 대상에서 제외
4. `skill` tool은 보호
5. `completed` tool part의 output에 대해 `Token.estimate()`를 누적
6. 누적합이 `PRUNE_PROTECT = 40,000`을 넘는 지점부터 과거 tool output을 prune 후보로 등록
7. 후보 총합이 `PRUNE_MINIMUM = 20,000`을 넘을 때만 실제 prune 수행

#### prune의 효과

tool output 전체가 단일 placeholder로 교체된다. 부분 보존이나 요약이 아니다.

```
prune 전: "1: package api\n2: \n3: import (\n4:     \"fmt\"...\n120: }"
prune 후: "[Old tool result content cleared]"
```

tool call과 input은 그대로 남으므로, 에이전트는 "handler.go를 read한 적 있다"는 사실은 알지만 파일 내용은 모른다. 필요하면 다시 read해야 한다. DB에는 원본 output이 그대로 남아 있고, `compacted` timestamp 플래그만 추가된다.

#### 전체 흐름

```text
매 loop 종료 시:
-> compaction 필요? (count >= usable)
   -> yes: compaction task 생성 → summary anchor 삽입
   -> no: skip
-> prune 실행 (항상)
   -> 40K 보호 밖의 오래된 tool output에 compacted timestamp 찍기
   -> 다음 replay에서 해당 output이 "[cleared]"로 대체됨
```

### 4-5. Truncation 계층 (4단계)

| 계층 | 역할 | history 영향 |
|---|---|---|
| **tool output spill/truncate** | 단일 tool output이 2000줄/50KB 초과 시 preview만 남기고 `tool-output/`에 spill | 없음 |
| **session prune** | 오래된 completed tool output에 `state.time.compacted` 찍기 | output만 placeholder |
| **compaction boundary rewrite** | compaction user + summary assistant 생성, prefix 제거 | history-level rewrite |
| **replay transform** | DB 저장물을 provider-friendly 메시지로 재구성 | 최종 변환 |

**tool output spill 상세**:
- 기본 한도: `MAX_LINES = 2000`, `MAX_BYTES = 50KB`
- 방향: 기본 `head`, 옵션으로 `tail`
- 줄 단위 루프에서 각 줄의 UTF-8 바이트 수를 누적, 줄 수 또는 바이트 중 하나에 걸리면 중단
- preview만 모델 visible output, 원문은 `tool-output/<id>`에 저장
- 뒤에 `...N lines truncated...` + 파일 경로 + `Grep`/`Read with offset/limit` 안내가 붙음
- spill 파일은 기본 retention 7일, 1시간마다 cleanup
- tool이 이미 `metadata.truncated`를 세팅해 반환하면 공통 truncation은 건너뜀

**큰 bash 출력의 전체 파이프라인**:

```text
1. bash tool이 원본 대형 output 생성
2. 공통 tool wrapper가 Truncate.output() 적용
3. preview만 output으로 남기고 원문은 tool-output/<id>에 저장
4. 같은 turn의 다음 model 호출에는 preview 문자열이 replay
5. 세션이 길어지면 오래된 completed tool output에 state.time.compacted 찍힘
6. 이후 replay에서는 output이 "[Old tool result content cleared]"로 치환
7. 세션이 더 길어져 compaction되면 그 tool이 속한 prefix 자체가 사라질 수 있음
```

---

## 5. Prompt Caching 전략

OpenCode는 prompt caching을 명시적으로 지원한다.

**cache 친화 메커니즘**:

| 메커니즘 | 설명 |
|---|---|
| system prompt 2-part 구조 | cache-friendly하게 유지, provider별 분리 |
| `cacheControl` / `cachePoint` | provider별 cache hint 삽입 |
| `promptCacheKey` / `prompt_cache_key` | session 단위 cache key 관리 |
| usage 집계 | `cachedInputTokens`, `cache write/read`를 별도 집계 |

**prune/compaction은 prompt cache를 깨뜨린다 — 알려진 문제이며 감수하는 전략**:

prune이 `"[Old tool result content cleared]"`로 치환하거나, compaction이 replay boundary를 이동하면, 이전 turn까지 쌓인 prefix cache가 무효화된다. OpenCode 커뮤니티에서 이 문제는 활발히 논의되고 있다:

- [#4416](https://github.com/anomalyco/opencode/issues/4416): cached token을 total에 이중 계산하여 compaction이 너무 일찍 발동 — cache hit 상태인데 불필요한 compaction 발생
- [#5224](https://github.com/anomalyco/opencode/issues/5224): system prompt의 디렉토리 목록이 파일 변경 시 cache 무효화 → maintainer가 "cache를 깨뜨릴 수 있는 동적 정보를 system prompt에 넣지 말라"고 결론, 디렉토리 목록 제거
- [#5416](https://github.com/anomalyco/opencode/issues/5416): Anthropic 1시간 TTL cache 활용 개선 → PR #14743이 system prompt를 stable/dynamic 블록으로 분리, cross-repo 첫 prompt cache hit 0% → 97.6%
- [#4102](https://github.com/anomalyco/opencode/issues/4102) (Epic): "pruning이 과소 활용되고 있어 selective deletion 대신 premature full compaction이 발생" — prune을 더 적극적으로 써서 compaction(= 더 큰 cache 파괴)을 늦춰야 한다는 방향

**현재 전략은 "cache-first가 아니라 cache-opportunistic"**:

- prune/compaction이 대화 히스토리의 cache를 깨뜨리는 것은 **감수**
- 대신 **system prompt prefix를 최대한 안정적으로 유지**하여 cache hit를 살림
  - stable 블록 (provider base prompt + global AGENTS.md) + dynamic 블록 (env, skills) 분리
  - 디렉토리 목록 같은 불안정 정보는 system prompt에서 제거
  - `OPENCODE_EXPERIMENTAL_CACHE_STABILIZATION=1`로 날짜/instruction까지 프로세스 수명 동안 고정 가능
- 긴 세션에서는 **cache 안정성보다 replay budget 관리가 우선** — context overflow 방지가 cache hit보다 중요

---

## 6. Safety와 Guardrails

### 6-1. Permission 시스템

#### 구조

`{ permission, pattern, action }` 3-tuple의 배열(Ruleset)로 구성. action은 `"allow"` / `"deny"` / `"ask"`.

3개 소스에서 merge되며, **뒤에 있는 rule이 이긴다** (last-write-wins):
- defaults (공통: `*: allow, doom_loop: ask, read *.env: ask` 등)
- agent별 override (explore: `*: deny` + `grep/glob/read/bash: allow` 등)
- config의 user permission (**최고 우선순위**)

#### 적용 시점 2곳

| 시점 | 조건 | 효과 |
|---|---|---|
| **definition 필터링** (`disabled()`) | pattern=`"*"` + action=`"deny"` | tool definition을 LLM에서 **제거** (token 절약) |
| **execute 시** (`ctx.ask()`) | 위 외 모든 경우 | allow면 통과, deny면 `DeniedError`, ask면 **사용자에게 질문 후 블로킹 대기** |

`disabled()`의 조건이 엄격하므로, path-specific deny(plan mode의 `edit: {*: deny, plans/*.md: allow}`)는 definition이 남아 LLM이 호출을 시도할 수 있다 — 실행 시에만 차단.

#### 사용자 응답

| 응답 | 효과 | 지속성 |
|---|---|---|
| **once** | 이번 호출만 허용 | 즉시 소멸 |
| **always** | 같은 패턴의 미래 호출도 허용 (bash: `git *`, edit: `*`) | **프로세스 lifetime** — 재시작 시 사라짐 |
| **reject** | loop 전체 중단 + 같은 session의 pending 요청도 자동 reject | 즉시. `continue_loop_on_deny`(experimental)이면 중단 대신 에러로 전달 |

#### Context engineering 관점

- `disabled()`로 제거된 tool: LLM이 존재 자체를 모름 → token 절약
- deny지만 제거되지 않은 tool: LLM이 호출 → `DeniedError`가 tool result로 쌓임 → token 낭비
- "ask" 블로킹: 사용자 응답까지 loop 정지 → timeout 가능성

### 6-2. Doom Loop 감지

동일 tool + 동일 input이 3회 연속 반복되면 permission ask를 발생시킨다. 거부 시 루프가 중단된다.

**실제 예시**:
- 모델이 `bash(command="npm test")`를 호출하고 실패 → 같은 명령을 수정 없이 재시도 → 또 재시도 → 3회째에 doom loop 감지
- 사용자에게 "이 tool call을 계속 허용할 것인가?"를 묻고, 거부하면 모델이 다른 접근법을 시도하도록 유도

이 설계가 Codex/OpenClaw과 다른 점:
- Codex: doom loop 감지 없음 (approval flow로 간접 차단)
- OpenClaw: 3종 detector (repeat/poll/ping-pong)에 임계값 10/20/30 -- 훨씬 관대

OpenCode의 3회 임계값은 상당히 보수적이다. 정상적인 retry가 3회를 넘는 경우(예: flaky 테스트)에서 false positive가 발생할 수 있다는 단점이 있다.

---

## 7. Error Recovery

| 에러 유형 | 처리 방식 |
|---|---|
| context overflow | `ContextOverflowError` -> `needsCompaction` -> compaction task 생성 |
| rate limit | retryable 판단 -> exponential backoff (최대 30초) |
| overload | retryable -> backoff |
| tool 실행 실패 | tool part에 "error" 기록 -> 모델이 다음 행동 결정 |
| permission 거부 | `blocked=true` -> 루프 중단 (또는 `continue_loop_on_deny`면 에러로 전달) |

**Codex/OpenClaw과의 비교에서 OpenCode가 없는 것**:
- WebSocket -> HTTPS fallback (Codex)
- auth profile rotation / model fallback (OpenClaw)
- runtime auth refresh (OpenClaw)
- thinking level 다운그레이드 (OpenClaw)

OpenCode의 error recovery는 가장 단순하다. retryable 판단 -> exponential backoff -> 실패 시 에러 반환. 별도의 fallback 경로가 없다. 이는 Vercel AI SDK에 의존하는 설계의 결과이기도 하다 -- SDK가 제공하지 않는 recovery 전략을 harness 수준에서 추가하기 어렵기 때문이다.

---

## 8. Manus 기법 기준 평가

Manus 블로그의 6가지 실전 원칙에 대한 OpenCode의 대응을 평가한다.

### 1) Design Around the KV-Cache

> KV-cache 원칙: prompt prefix를 최대한 안정적으로 유지하여 이전 요청의 prefix cache를 재사용한다.

| 항목 | 평가 |
|---|---|
| 대응 정도 | **부분적** |
| 실제 방식 | system prompt 2-part 구조, provider별 `cacheControl`/`cachePoint`, session 단위 cache key |
| Manus와 차이 | cache-first라기보다 provider cache 기능을 opportunistic하게 활용. compaction boundary 이동과 placeholder replay로 body mutation을 허용 |
| 실무 해석 | stable system/header 구간은 cache hit 가능. 긴 세션에서는 cache 안정성보다 replay budget 관리가 우선 |

### 2) Mask, Don't Remove

> Mask 원칙: context를 줄이더라도 흔적은 남기고, action/result의 구조는 유지하고 payload만 비운다.

| 항목 | 평가 |
|---|---|
| 대응 정도 | **강함** |
| 실제 방식 | prune 시 tool call 자체는 안 지우고 `state.time.compacted`만 찍음. replay에서 output만 `"[Old tool result content cleared]"`로 치환. pending/running tool은 `"[Tool execution was interrupted]"` error result로 닫음 |
| Manus와 차이 | cache-preserving mask보다 `replay를 가볍게 만들면서 tool graph를 보존`하는 쪽 |
| 실무 해석 | agent는 과거에 어떤 tool을 썼는지 계속 안다. 하지만 긴 payload 본문은 빠르게 사라진다 |

### 3) Use the File System as Context

> 파일시스템 원칙: 긴 관측값/기억을 prompt 안에 오래 쌓지 않고 파일, 경로, 외부 artifact로 넘긴다.

| 항목 | 평가 |
|---|---|
| 대응 정도 | **강함** |
| 실제 방식 | plan file을 외부 working memory로 사용. `read`는 `filePath + offset + limit` 기반. 큰 tool output은 spill-to-disk. file-local instruction을 `read` 결과에 합성 |
| Manus와 차이 | pointer-first는 아니지만, 긴 결과를 파일로 밀어내는 실용 패턴이 분명 |
| 실무 해석 | 세션 transcript와 파일 artifact가 함께 메모리 역할을 나눈다 |

### 4) Manipulate Attention Through Recitation

> Recitation 원칙: 목표, TODO, 제약, 최신 지시를 컨텍스트 최근부에 다시 올려 attention을 유도한다.

| 항목 | 평가 |
|---|---|
| 대응 정도 | **부분적~강함** |
| 실제 방식 | queued user `<system-reminder>`, plan mode synthetic reminder, subtask 후 `"Summarize ... and continue"` user message, compaction summary anchor, file-local `<system-reminder>` |
| Manus와 차이 | 매 turn 고정 recitation은 아니고, 특정 상황에서만 synthetic reminder를 넣는다 |
| 실무 해석 | 최근부 reminder를 자주 만들어 현재 목표를 재부각 |

### 5) Keep the Wrong Stuff In

> Wrong stuff 원칙: 실패 흔적, 틀린 시도, 에러를 완전히 지우지 않고 다음 reasoning 재료로 남긴다.

| 항목 | 평가 |
|---|---|
| 대응 정도 | **부분적** |
| 실제 방식 | tool call/input은 prune 후에도 남음. interrupted tool도 error result로 남음. compaction user + summary assistant가 계속 suffix에 남음 |
| Manus와 차이 | wrong stuff를 남기는 이유가 학습보다 protocol consistency에 더 가깝다 |
| 실무 해석 | 완전 삭제보다 placeholder/에러 result를 남겨 후속 reasoning을 돕는다 |

### 6) Don't Get Few-Shotted

> Anti-few-shot 원칙: 과거의 반복 action-observation 패턴이 모델을 잘못 few-shot하지 않도록 방어한다.

| 항목 | 평가 |
|---|---|
| 대응 정도 | **부분적** |
| 실제 방식 | compaction boundary로 오래된 prefix 자체를 잘라냄. old tool payload placeholder화. subtask/compaction을 짧은 semantic text로 약화. cross-model metadata 재사용 제한 |
| Manus와 차이 | few-shot drift 억제는 compaction/prune의 부산물이지 명시적 정책은 아님 |
| 실무 해석 | 긴 procedural trace 누적 문제는 줄이지만, 최근 suffix 패턴에는 여전히 쉽게 끌릴 수 있다 |

### 종합

- Manus와 가장 가까운 축: **Mask, Don't Remove** + **Use the File System as Context**
- Manus와 가장 다른 점: **Don't Get Few-Shotted**를 명시적으로 다루지 않는다. compaction/prune/sanitize의 부산물로 간접 대응한다.

---

## 9. 설계적 통찰과 시사점

### 핵심 인사이트: replay를 1급 설계 대상으로 두라

문제는 얼마나 많이 저장하느냐가 아니라, 저장한 것 중 무엇을 다음 prompt에 어떤 형태로 다시 만들 것이냐이다. OpenCode는 이 문제를 `MessageV2.toModelMessages()`와 provider transform 계층에 집중시킨다.

### 왜 이렇게 설계했는가

1. **Provider 다양성**: Claude, GPT, Gemini 등 provider를 자주 바꿀 수 있어야 한다. DB 저장 포맷이 특정 provider에 종속되면 전환이 어렵다. 따라서 canonical truth(event log)와 provider-specific replay를 분리한다.

2. **Tool-heavy 워크로드**: coding agent에서는 큰 tool output이 흔하다. 모든 output을 prompt에 영원히 유지하면 context가 빠르게 소진된다. 따라서 truncation -> prune -> compaction의 3단계 degradation path가 필요하다.

3. **점진적 정보 손실**: 정보는 한 번에 사라지지 않는다. `전체 output -> preview -> placeholder -> prefix 삭제`의 경로를 따라 점진적으로 약해진다. 이는 갑작스러운 context loss보다 agent의 일관성을 유지하는 데 유리하다.

### ReAct를 쓰지 않는 이유 (OpenCode 관점)

OpenCode에는 `Thought:`, `Action:`, `Observation:` 같은 ReAct 패턴이 없다. 이유는 ReAct가 해결하던 세 문제를 API/모델 수준에서 해결하기 때문이다.

| ReAct 시대 문제 | 현재 OpenCode의 해법 |
|---|---|
| 구조 강제 (텍스트 파싱) | Vercel AI SDK `streamText()`의 structured tool calling |
| reasoning 유도 ("Think step by step") | 모델 내장 reasoning (extended thinking 등) |
| 종료 판단 ("Final Answer:") | `finish_reason` structured 신호 (`stop`, `tool-calls`) |

OpenCode는 그래도 tool 이름이 틀릴 수 있어서 `experimental_repairToolCall`(대소문자 수정 등)을 두지만, 이는 ReAct 파싱과는 차원이 다른 수준의 보정이다.

harness의 역할이 "루프 구조를 prompt로 가르치는 것"에서 "모델이 이미 하는 것을 안전하게 감싸는 것"으로 전환되었다. system prompt가 지시하는 것은 "이렇게 생각하고 행동하라"가 아니라 "이 도구들이 있고, 이 환경에서 일하고 있고, 이 규칙을 지켜라"다.

### 한 줄 평가

OpenCode는 "전체 history를 다시 넣는 시스템"이 아니라 **operation journal을 continuation용 prompt로 재합성하는 시스템**이다.

---

## 10. 멀티턴 실행 예시: Payload 중심

> **소스코드 기반 재구성**. 실제로 LLM API에 나가는 JSON payload, 돌아오는 stream event, DB에 저장되는 레코드를 중심으로 보여준다. 모든 수치와 상수는 소스코드에서 확인한 것이다.

**시나리오**: 사용자가 "src/api/handler.go에서 에러 핸들링을 개선해줘"라고 요청. 이후 테스트 실행(truncation), 장시간 작업 후 compaction까지 이어지는 4턴 흐름이다.

**Tool parameter 요약**:

| Tool | 필수 파라미터 | 선택 파라미터 |
|---|---|---|
| `glob` | `pattern: string` | `path: string` |
| `read` | `filePath: string` | `offset: number`, `limit: number` |
| `edit` | `filePath: string`, `oldString: string`, `newString: string` | `replaceAll: boolean` |
| `bash` | `command: string`, `description: string` | `timeout: number`, `workdir: string` |
| `grep` | `pattern: string` | `path: string`, `include: string` |

### Turn 1: 초기 호출 + tool chain

#### → LLM에 나가는 messages

system은 별도 파라미터가 아닌 messages 배열 앞에 `role: "system"`으로 삽입된다. caching을 위해 2-part 구조(header/rest)를 유지한다.

```json
[
  {
    "role": "system",
    "content": "You are an AI coding assistant...(anthropic.txt 전문)..."
  },
  {
    "role": "system",
    "content": "<env>\nmodel: claude-sonnet-4-20250514\nworking_directory: /project\nplatform: darwin\nis_git_repo: true\ndate: 2026-03-17\n</env>\n\n## Skills\nglob - Fast file pattern matching...\nread - Reads a file...\n...\n\n## Instructions from AGENTS.md\n..."
  },
  {
    "role": "user",
    "content": [{ "type": "text", "text": "src/api/handler.go에서 에러 핸들링을 개선해줘" }]
  }
]
```

> system[0]은 provider별 base prompt (Claude: `anthropic.txt`, GPT: `beast.txt`, Gemini: `gemini.txt`), system[1]은 environment + skills + instruction files를 합친 것이다. 전송 직전에 `ProviderTransform.message()`가 Anthropic cache hint 삽입, toolCallId 정규화 등을 적용한다.

주요 streamText() 파라미터:

```json
{
  "maxOutputTokens": 32000,
  "temperature": null,
  "providerOptions": { "anthropic": { "cache": "..." } }
}
```

#### ← Stream events (외부 루프가 orchestrate하는 실제 흐름)

`maxSteps=1`이므로 SDK는 LLM 1회 + tool 실행 1회로 stream을 종료한다. 각 LLM 호출은 **별도의 외부 루프 iteration**(= 별도의 `process()` → `streamText()`)이다.

```
── 외부 루프 iteration 1: process() → streamText() ──
← LLM response:
    tool-call: glob({ "pattern": "src/api/**/*.go" })
    stop_reason: tool_use
  SDK: glob execute 콜백 호출 → result 수신 → stream 종료
  process() return "continue"

── 외부 루프 iteration 2: process() → streamText() ──
  (messages에 이전 tool result 포함)
← LLM response:
    tool-call: read({ "filePath": "/project/src/api/handler.go" })
    stop_reason: tool_use
  SDK: read execute 콜백 호출 → result 수신 → stream 종료
  process() return "continue"

── 외부 루프 iteration 3: process() → streamText() ──
← LLM response:
    tool-call: edit({ "filePath": "...", "oldString": "...", "newString": "..." })
    stop_reason: tool_use
  SDK: edit execute 콜백 호출 → result 수신 → stream 종료
  process() return "continue"

── 외부 루프 iteration 4: process() → streamText() ──
← LLM response:
    text: "에러 핸들링을 개선했습니다..."
    stop_reason: stop
  stream 종료
  process() return "continue"

── 외부 루프: lastAssistant.finish == "stop" → break ──
```

> **핵심**: SDK는 LLM 1회 호출 + execute 콜백 1회까지만 담당한다. tool result를 포함한 messages로 다시 LLM을 호출하는 것은 **외부 루프(`SessionPrompt.loop()`)**다. OpenCode는 매 iteration에서 stream event를 순차적으로 DB에 저장한다.

#### → DB 저장

Message 테이블과 Part 테이블이 분리되어 있다. Message에 메타정보, Part에 실제 콘텐츠가 들어간다.

**User message (MessageTable)**:

```json
{
  "id": "msg_01J_user1",
  "sessionID": "sess_01J...",
  "role": "user",
  "agent": "code",
  "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
  "format": { "type": "text" },
  "time": { "created": 1710648000000 }
}
```

**Assistant message (MessageTable)**:

```json
{
  "id": "msg_01J_asst1",
  "sessionID": "sess_01J...",
  "role": "assistant",
  "parentID": "msg_01J_user1",
  "providerID": "anthropic",
  "modelID": "claude-sonnet-4-20250514",
  "agent": "code",
  "path": { "cwd": "/project", "root": "/project" },
  "cost": 0.0023,
  "tokens": {
    "input": 5200, "output": 2200, "reasoning": 0,
    "cache": { "read": 3000, "write": 2000 }
  },
  "time": { "created": 1710648001000, "completed": 1710648005000 },
  "finish": "stop"
}
```

**Parts (PartTable)** -- assistant message에 연결:

```json
[
  {
    "type": "tool", "messageID": "msg_01J_asst1",
    "callID": "call_01", "tool": "glob",
    "state": {
      "status": "completed",
      "input": { "pattern": "src/api/**/*.go" },
      "output": "/project/src/api/handler.go\n...",
      "metadata": { "count": 3, "truncated": false },
      "time": { "start": 1710648001500, "end": 1710648001800 }
    }
  },
  {
    "type": "tool", "messageID": "msg_01J_asst1",
    "callID": "call_02", "tool": "read",
    "state": {
      "status": "completed",
      "input": { "filePath": "/project/src/api/handler.go" },
      "output": "<path>/project/src/api/handler.go</path>...(120 lines)",
      "time": { "start": 1710648002000, "end": 1710648002300 }
    }
  },
  {
    "type": "tool", "messageID": "msg_01J_asst1",
    "callID": "call_03", "tool": "edit",
    "state": {
      "status": "completed",
      "input": { "filePath": "/project/src/api/handler.go", "oldString": "...", "newString": "..." },
      "output": "Edit applied successfully.",
      "time": { "start": 1710648003000, "end": 1710648003200 }
    }
  },
  {
    "type": "text", "messageID": "msg_01J_asst1",
    "text": "에러 핸들링을 개선했습니다..."
  }
]
```

그 외 Part 타입들: `reasoning` (reasoning trace), `step-start`/`step-finish` (multi-step 경계), `snapshot`/`patch` (git 상태), `compaction` (compaction trigger), `subtask` (task tool), `agent` (@agent invoke), `retry` (재시도 정보).

### Turn 2: bash 실행 + truncation

사용자가 "테스트 돌려봐"라고 요청. 에이전트가 `go test ./...`를 실행하는데, output이 3500줄(87KB)로 길다.

#### → LLM에 나가는 messages

DB의 message+parts를 `toModelMessages()`로 변환하여 Turn 1 히스토리를 포함한다. 변환 규칙:

- completed tool part → tool call + tool result (output 포함)
- `state.time.compacted`가 설정된 tool → output이 `"[Old tool result content cleared]"`로 대체
- pending/running tool → `"[Tool execution was interrupted]"` error result
- 에러가 있는 assistant message → 통째로 skip (일부 part가 있는 abort 경우는 예외)

순차 tool call은 **각각 별도 LLM 호출**이므로, `toModelMessages()`가 interleaved 구조로 변환한다. DB에는 하나의 assistant message + parts로 저장되지만, LLM에 나가는 messages는 call/result 쌍이 교차한다.

```json
[
  { "role": "system", "content": "...(base prompt)..." },
  { "role": "system", "content": "...(env + skills + instructions)..." },
  { "role": "user", "content": [{ "type": "text", "text": "src/api/handler.go에서 에러 핸들링을 개선해줘" }] },

  // ── LLM 호출 #1 → glob ──
  { "role": "assistant", "content": [
    { "type": "tool-call", "toolCallId": "call_01", "toolName": "glob", "args": { "pattern": "src/api/**/*.go" } }
  ]},
  { "role": "tool", "content": [
    { "type": "tool-result", "toolCallId": "call_01", "result": "src/api/handler.go\nsrc/api/middleware.go\n..." }
  ]},

  // ── LLM 호출 #2 → read (glob 결과를 보고 결정) ──
  { "role": "assistant", "content": [
    { "type": "tool-call", "toolCallId": "call_02", "toolName": "read", "args": { "filePath": "/project/src/api/handler.go" } }
  ]},
  { "role": "tool", "content": [
    { "type": "tool-result", "toolCallId": "call_02", "result": "<path>...</path>...(120 lines)" }
  ]},

  // ── LLM 호출 #3 → edit (read 결과를 보고 결정) ──
  { "role": "assistant", "content": [
    { "type": "tool-call", "toolCallId": "call_03", "toolName": "edit", "args": { "filePath": "...", "oldString": "...", "newString": "..." } }
  ]},
  { "role": "tool", "content": [
    { "type": "tool-result", "toolCallId": "call_03", "result": "Edit applied successfully." }
  ]},

  // ── LLM 호출 #4 → 텍스트 응답 (stop) ──
  { "role": "assistant", "content": [
    { "type": "text", "text": "에러 핸들링을 개선했습니다..." }
  ]},

  { "role": "user", "content": [{ "type": "text", "text": "테스트 돌려봐" }] }
]
```

> **병렬 호출의 경우**: LLM이 한 응답에 여러 tool call을 반환하면, 하나의 assistant message에 여러 tool-call이 들어가고 tool-result도 한꺼번에 이어진다. 위 예시는 glob→read→edit이 순차 의존이므로 각각 별도 assistant message다.

#### ← Stream events (truncation 적용)

원본 `go test` output은 3500줄/87KB이지만, `Truncate.output()`가 개입한다.

상수: `MAX_LINES = 2000`, `MAX_BYTES = 50KB`, 기본 direction = `"head"`

한쪽 방향만 보존하는 방식이다. head(기본값)이면 앞에서부터 보존하고 뒷부분을 자른다. tail이면 반대다. "앞+뒤" 방식이 **아니다**.

```
tool-call:   bash({ "command": "cd /project && go test ./...", "description": "Run all tests" })
tool-result:
  "=== RUN   TestHandler
  --- PASS: TestHandler (0.02s)
  === RUN   TestMiddleware
  --- PASS: TestMiddleware (0.01s)
  ...(처음 2000줄까지)...

  ...1500 lines truncated...

  The tool call succeeded but the output was truncated.
  Full output saved to: ~/.opencode/data/tool-output/tool_01J...
  Use the Task tool to have explore agent process this file with Grep and Read..."

text:   "모든 테스트가 통과했습니다..."
finish: stop
```

> **주의**: 기본이 head truncation이므로, 테스트 실패 메시지가 output 뒷부분에 있으면 잘릴 수 있다. 에이전트는 saved path를 Read/Grep하거나 Task tool로 위임해야 한다. 저장된 파일은 7일 후 자동 정리된다 (`RETENTION_MS = 7 * 24 * 60 * 60 * 1000`).

#### → DB 저장 (bash tool part)

```json
{
  "type": "tool", "messageID": "msg_01J_asst2",
  "callID": "call_04", "tool": "bash",
  "state": {
    "status": "completed",
    "input": { "command": "cd /project && go test ./...", "description": "Run all tests" },
    "output": "=== RUN   TestHandler\n--- PASS: ...\n(처음 2000줄)...\n\n...1500 lines truncated...\n\nFull output saved to: ~/.opencode/data/tool-output/tool_01J...",
    "metadata": { "truncated": true, "exitCode": 0 },
    "time": { "start": 1710648010000, "end": 1710648015000 }
  }
}
```

DB에는 truncation 후의 preview가 저장된다. 원문은 `~/.opencode/data/tool-output/tool_01J...`에 별도 파일로 남아 있다.

### Turn 3: isOverflow → compaction

에이전트가 여러 파일을 반복적으로 read/edit하면서 10턴 이상 진행. 누적 토큰이 급격히 증가한다.

#### overflow 판정

매 턴 종료 후 `isOverflow()` 판정이 실행된다.

판정 공식:

```
count = tokens.total ?? (tokens.input + tokens.output + tokens.cache.read + tokens.cache.write)
reserved = config.compaction.reserved ?? min(20,000, maxOutputTokens)
usable = model.limit.input ? (model.limit.input - reserved) : (model.limit.context - maxOutputTokens)

overflow = count >= usable
```

실제 상황 (Claude 200K 기준):

| 항목 | 값 |
|---|---|
| `model.limit.input` | 200,000 |
| `maxOutputTokens` | 32,000 |
| `reserved` | min(20,000, 32,000) = **20,000** |
| `usable` | 200,000 - 20,000 = **180,000** |
| 마지막 step `count` | **185,000** |
| 판정 | 185K >= 180K → **overflow** |

#### compaction 전 messages (LLM에 나가는 형태)

`toModelMessages()`가 DB의 flat 구조를 interleaved 구조로 변환한 결과:

```json
[
  { "role": "system", "content": "...(base prompt)..." },
  { "role": "system", "content": "...(env + skills + instructions)..." },

  // ── Turn 1: 에러 핸들링 개선 (순차 tool call → interleaved) ──
  { "role": "user", "content": "에러 핸들링 개선해줘" },
  { "role": "assistant", "content": [{ "type": "tool-call", "toolCallId": "call_01", "toolName": "glob", ... }] },
  { "role": "tool",      "content": [{ "type": "tool-result", "toolCallId": "call_01", "result": "handler.go\n..." }] },
  { "role": "assistant", "content": [{ "type": "tool-call", "toolCallId": "call_02", "toolName": "read", ... }] },
  { "role": "tool",      "content": [{ "type": "tool-result", "toolCallId": "call_02", "result": "(120 lines)" }] },
  { "role": "assistant", "content": [{ "type": "tool-call", "toolCallId": "call_03", "toolName": "edit", ... }] },
  { "role": "tool",      "content": [{ "type": "tool-result", "toolCallId": "call_03", "result": "Edit applied." }] },
  { "role": "assistant", "content": [{ "type": "text", "text": "개선했습니다..." }] },

  // ── Turn 2: 테스트 (truncated output) ──
  { "role": "user", "content": "테스트 돌려봐" },
  { "role": "assistant", "content": [{ "type": "tool-call", "toolCallId": "call_04", "toolName": "bash", ... }] },
  { "role": "tool",      "content": [{ "type": "tool-result", "toolCallId": "call_04", "result": "(2000줄 truncated)" }] },
  { "role": "assistant", "content": [{ "type": "text", "text": "모든 테스트 통과..." }] },

  // ── Turn 3~12: 추가 read/edit/bash 10턴 이상 (동일 패턴) ──
  // ...

  { "role": "user", "content": "미들웨어도 같은 패턴으로 수정해줘" }
]
```

> 총 ~185,000 tokens → usable 180,000 초과

#### compaction LLM 호출

별도 agent("compaction")로 요약을 생성한다. tool 없음, system prompt 없음.

```json
{
  "messages": [
    "... (기존 대화 전체를 toModelMessages()로 변환, stripMedia: true) ...",
    {
      "role": "user",
      "content": "Provide a detailed prompt for continuing our conversation above.\nFocus on information that would be helpful for continuing the conversation...\n\nWhen constructing the summary, try to stick to this template:\n---\n## Goal\n[What goal(s) is the user trying to accomplish?]\n\n## Instructions\n- [What important instructions did the user give you that are relevant]\n\n## Discoveries\n[What notable things were learned...]\n\n## Accomplished\n[What work has been completed, what work is still in progress...]\n\n## Relevant files / directories\n[Construct a structured list of relevant files...]\n---"
    }
  ],
  "tools": {},
  "system": []
}
```

요약 결과는 `summary: true`인 assistant message로 DB에 저장된다. overflow compaction인 경우, 마지막 user message를 분리해두었다가 compaction 후 자동으로 replay하여 작업을 이어간다.

#### compaction 후 messages

```json
[
  { "role": "system", "content": "...(base prompt)..." },
  { "role": "system", "content": "...(env + skills + instructions)..." },
  {
    "role": "user",
    "content": [{ "type": "text", "text": "What did we do so far?" }]
  },
  {
    "role": "assistant",
    "content": [{ "type": "text", "text": "## Goal\nImprove error handling in src/api/handler.go\n\n## Instructions\n- Use fmt.Errorf with %w for error wrapping\n\n## Discoveries\n- handler.go uses bare http.Error() without wrapping\n- middleware.go has the same pattern\n- All 35 tests passing after handler.go fix\n\n## Accomplished\n- Wrapped errors with fmt.Errorf in handler.go\n- Tests confirmed passing (go test ./...)\n- Still in progress: middleware.go needs same treatment\n\n## Relevant files / directories\n- /project/src/api/handler.go (modified)\n- /project/src/api/middleware.go (pending)\n- /project/src/api/handler_test.go" }]
  },
  {
    "role": "user",
    "content": [{ "type": "text", "text": "미들웨어도 같은 패턴으로 수정해줘" }]
  }
]
```

> 이전 대화 전체가 summary anchor로 대체되어, ~5,000 tokens(system ~3K + compaction pair ~2K + 새 user ~200)만 사용한다. context window의 ~180K를 다시 사용할 수 있게 된다.

#### prune 동작 (compaction과 별개)

loop 종료 시 비동기로 `prune()`가 실행된다. compaction 먼저, prune 나중.

상수: `PRUNE_PROTECT = 40,000` (최근 보호), `PRUNE_MINIMUM = 20,000` (최소 절약량), `PRUNE_PROTECTED_TOOLS = ["skill"]`

prune의 핵심은 **DB의 output은 보존하면서, LLM에 나가는 payload에서만 output을 비우는 것**이다. DB에 `compacted` timestamp를 찍어두면, 다음 replay 시 `toModelMessages()`가 output을 placeholder로 대체한다.

**prune 전 — LLM에 나가는 tool result:**

```json
{ "role": "assistant", "content": [
  { "type": "tool-call", "toolCallId": "call_02", "toolName": "read",
    "args": { "filePath": "/project/src/api/handler.go" } }
]},
{ "role": "tool", "content": [
  { "type": "tool-result", "toolCallId": "call_02",
    "result": "<path>/project/src/api/handler.go</path>\n<type>file</type>\n<content>\n1: package api\n2: \n3: import (\n4:     \"fmt\"\n5:     \"net/http\"\n...\n120: }\n(End of file - total 120 lines)\n</content>" }
]}
```

**prune 후 — LLM에 나가는 tool result:**

```json
{ "role": "assistant", "content": [
  { "type": "tool-call", "toolCallId": "call_02", "toolName": "read",
    "args": { "filePath": "/project/src/api/handler.go" } }
]},
{ "role": "tool", "content": [
  { "type": "tool-result", "toolCallId": "call_02",
    "result": "[Old tool result content cleared]" }
]}
```

> **tool call은 그대로, output만 사라진다.** 에이전트는 "handler.go를 read한 적 있다"는 사실은 알지만, 파일 내용은 모른다. 필요하면 다시 read해야 한다.

**DB에서 일어나는 것**: output 자체는 지우지 않고 `compacted` timestamp만 추가한다. `toModelMessages()`가 이 플래그를 보고 replay 시 placeholder로 대체한다.

```
DB 변경: state.time.compacted = null → 1710648100000
DB 변경: state.output = (변경 없음 — 원본 120줄 그대로)
```

이 설계 덕분에 DB에서 과거 tool output을 포렌식할 수 있고, prune을 "취소"하는 것도 timestamp를 null로 되돌리면 된다.

### Turn 4: compaction 이후 새 작업

사용자가 "router.go의 404 핸들러도 개선해줘"라고 추가 요청.

#### → LLM에 나가는 messages

`filterCompacted()`가 DB에서 최신 완료된 compaction boundary를 찾아 그 이전 prefix를 제거한다. 전송 직전에 `ProviderTransform.message()`가 적용된다:

- Anthropic: 빈 content 필터링, toolCallId 정규화 (`/[^a-zA-Z0-9_-]/g` → `_`), system 첫 2개 + 마지막 2개 메시지에 `cacheControl: { type: "ephemeral" }` 설정
- Mistral: toolCallId를 alphanumeric 9자로 정규화, tool→user 사이에 "Done." assistant 삽입

```json
[
  { "role": "system", "content": "...(base prompt)..." },
  { "role": "system", "content": "...(env + skills + instructions)..." },
  { "role": "user", "content": [{ "type": "text", "text": "What did we do so far?" }] },
  { "role": "assistant", "content": [{ "type": "text", "text": "## Goal\nImprove error handling...\n\n## Accomplished\n- handler.go fixed...\n\n## Relevant files\n- /project/src/api/handler.go..." }] },
  { "role": "user", "content": [{ "type": "text", "text": "미들웨어도 같은 패턴으로 수정해줘" }] },
  { "role": "assistant", "content": ["(middleware.go 수정 tool calls + text)"] },
  { "role": "tool", "content": ["(tool results — 최근 것은 output 유지, 오래된 것은 cleared)"] },
  { "role": "user", "content": [{ "type": "text", "text": "router.go의 404 핸들러도 개선해줘" }] }
]
```

#### ← Stream events

```
tool-call:   read({ "filePath": "/project/src/api/router.go" })
tool-result: "<path>/project/src/api/router.go</path>...(85 lines)"

tool-call:   edit({ "filePath": "/project/src/api/router.go", "oldString": "http.NotFound(w, r)", "newString": "http.Error(w, fmt.Sprintf(\"route not found: %s %s\", r.Method, r.URL.Path), http.StatusNotFound)" })
tool-result: "Edit applied successfully."

text:   "router.go의 404 핸들러를 개선했습니다..."
finish: stop
```

### 이 예시에서 관찰할 수 있는 설계 특성

1. **tool result가 토큰의 대부분을 차지한다**: 코드 파일을 read할 때마다 수백-수천 토큰이 누적된다. 10턴 만에 200K context의 대부분을 소진할 수 있다.

2. **truncation은 예방적, compaction/prune는 사후적이다**: truncation은 개별 tool output이 생성되는 시점에 즉시 적용된다. compaction은 전체 history가 한계를 넘었을 때 발동하고, prune는 loop 종료 시 비동기로 실행된다.

3. **truncation은 한 방향 절단이다**: "앞+뒤" 보존이 아니라, head 또는 tail 한쪽만 보존한다. 기본값 head이므로 bash output의 뒷부분(에러 메시지 등)이 잘릴 수 있다. 이를 보완하기 위해 saved path를 Read/Grep/Task로 접근하도록 안내한다.

4. **prune는 토큰 예산 기반이다**: 최근 40K 토큰의 tool output을 보호하고, 그 이전의 것들만 prune한다. 최소 20K 토큰을 절약할 수 있을 때만 실행한다. skill tool output은 항상 보호된다.

5. **DB와 LLM 입력이 분리된 이유**: DB에는 원본이 보존되고, `compacted` timestamp 플래그 하나로 replay 시 output을 비운다. 원본을 유지하므로 UI에서는 전체 대화를 볼 수 있고, LLM에는 가공된 형태만 전달된다.

6. **compaction은 별도 LLM 호출이다**: 현재 대화 전체를 넣고 structured template로 요약을 요청한다. tool은 제공하지 않으며, system prompt도 비어있다. 요약 결과는 `summary: true`로 표시된 assistant message로 저장된다.

7. **overflow compaction은 중단 작업을 자동 재개한다**: context overflow로 trigger된 compaction은 마지막 user turn을 분리해두었다가, compaction 후 자동으로 replay하여 작업을 이어간다.

### 소스 참조

| 파일 | 역할 |
|---|---|
| `packages/opencode/src/session/llm.ts` | `LLM.stream()`, streamText() 호출, system message 최종 조립 |
| `packages/opencode/src/session/system.ts` | system prompt 조립 (provider별 base prompt 분기) |
| `packages/opencode/src/session/prompt.ts` | `SessionPrompt.loop()` 외부 루프, overflow→compaction 흐름 |
| `packages/opencode/src/session/message-v2.ts` | MessageV2, ToolPart, `toModelMessages()`, `filterCompacted()` |
| `packages/opencode/src/tool/truncation.ts` | `Truncate.output()` (MAX_LINES=2000, MAX_BYTES=50KB) |
| `packages/opencode/src/session/compaction.ts` | `isOverflow()`, `prune()`, `process()` |
| `packages/opencode/src/provider/transform.ts` | `ProviderTransform.message()` (replay 변환, cache hint, 정규화) |
| `packages/opencode/src/tool/{read,edit,bash,glob,grep}.ts` | tool parameter schemas |

---

## 11. Subagent 처리

### Tool description을 통한 호출 유도

`task` tool의 description은 `task.txt` 템플릿에서 **`{agents}` placeholder를 실제 agent 목록으로 동적 치환**하여 조립된다.

```typescript
// task.ts — init() 시점
const agents = await Agent.list().then(x => x.filter(a => a.mode !== "primary"))
const description = DESCRIPTION.replace("{agents}", agents.map(a =>
  `- ${a.name}: ${a.description ?? "..."}`
).join("\n"))
```

LLM이 보는 실제 tool description:

```
Launch a new agent to handle complex, multistep tasks autonomously.

Available agent types and the tools they have access to:
- explore: Fast agent for exploring codebases (built-in)
- general: General-purpose agent for complex tasks (built-in)
- my-reviewer: 우리 팀 코드 리뷰 규칙에 맞게 리뷰 (custom)

When to use the Task tool:
- When you are instructed to execute custom slash commands...

When NOT to use the Task tool:
- If you want to read a specific file path, use the Read or Glob tool instead...

Usage notes:
1. Launch multiple agents concurrently whenever possible...
2. Each agent invocation starts with a fresh context unless you provide task_id...
```

**custom agent 추가**: config(`opencode.json`)의 `agent` 섹션에 선언하면 `Agent.list()`에 포함되고, task tool description에 자동 나열된다. built-in에 없는 이름이면 `native: false`로 새로 생성, 있는 이름이면 기존 agent를 override한다.

**호출 유도 설계**:

| 설계 요소 | 효과 |
|---|---|
| "When to use" / "When NOT to use" | 불필요한 호출 방지 (단순 read/glob은 직접 하라) |
| agent 목록을 description에 인라인 | LLM이 "어떤 agent가 있는지"를 매 turn 볼 수 있음 |
| "proactively" 언급 | agent description에 proactive 호출 유도 가능 |
| few-shot 예시 2개 | 코드 작성 후 review, 인사에 joke 등 패턴 학습 |
| "concurrently" 강조 | 여러 task를 한 메시지에서 병렬 호출 유도 |

**skill과의 차이**: skill은 system prompt + tool description에 **이중 노출**하지만, custom agent는 **task tool description에만** 노출. skill은 "instruction 로드"이고, agent는 "독립 실행 위임"이라는 역할 차이 때문이다.

### 생성

LLM이 `task` tool을 호출하면 같은 프로세스 내에서 새 session이 생성되고 `SessionPrompt.prompt()`로 실행된다.

```json
// → task tool call
{
  "name": "task",
  "arguments": {
    "description": "Search API endpoints",
    "prompt": "src/ 아래에서 HTTP handler를 모두 찾아서 목록을 만들어줘",
    "subagent_type": "explore"
  }
}

// ← tool result
"task_id: sess_01J... (for resuming to continue this task if needed)\n\n<task_result>\nsrc/api/handler.go - GET /api/users\nsrc/api/orders.go - POST /api/orders\n...</task_result>"
```

### Context surface

| 항목 | 부모 → subagent |
|---|---|
| 대화 히스토리 | **전달 안 됨** — fresh context로 시작 |
| System prompt | agent별 전용 prompt (예: explore → `PROMPT_EXPLORE`) |
| Tools | tool definition은 **부모와 동일하게 전부 LLM에 전달**됨. 실행 시 agent permission으로 차단 (explore가 edit 호출 → `PermissionRejectedError`). deny인 tool을 definition에서 미리 제거하면 context를 줄일 수 있으나 현재 그렇게 하지 않음 — `ToolRegistry`(모델 호환성)와 `PermissionNext`(실행 권한)가 분리되어 있고, `resolveTools()`에서 합쳐지지 않는 구조적 결과로 보임 |
| todowrite/todoread | permission에서 **deny** (subagent에서 호출 시 거부) |
| task tool (재귀) | 기본 deny — `hasTaskPermission` agent만 허용 |

### 실행

**부모는 블로킹된다** — `await SessionPrompt.prompt()`로 subagent 완료를 기다린다.

```
부모 LLM 호출 #N:
  ← tool-call: task("파일 찾아줘")
    AI SDK가 execute 콜백 호출
      → 새 session 생성
      → SessionPrompt.prompt() 실행 (subagent의 전체 agentic loop)
      → subagent 완료
      ← 마지막 text 응답 반환
  AI SDK가 tool result를 messages에 추가
  → LLM 재호출
```

**병렬 실행**: LLM이 한 응답에서 여러 `task` tool call을 동시에 호출하면, AI SDK가 여러 execute 콜백을 동시에 실행하므로 병렬 가능. 하지만 OpenCode가 명시적으로 `Promise.all`을 쓰는 것은 아니고, AI SDK의 tool call 처리에 의존한다.

### 결과 통합

subagent의 **마지막 text 응답만** 부모에게 tool result로 돌아온다. 중간 과정(tool calls, 에러, 수정 시도 등)은 보이지 않는다.

```
부모가 보는 것:                     subagent 내부에서 실제로 일어난 것:

task_id: sess_01J...                glob("src/**/*.go") → 15 files
                                    read("src/api/handler.go") → 120 lines
<task_result>                       read("src/api/orders.go") → 85 lines
src/api/handler.go - GET /users     grep("http.Handle") → 5 matches
src/api/orders.go - POST /orders    (마지막 text 응답만 전달 ↓)
...</task_result>
```

**session 재개**: `task_id`를 전달하면 이전 subagent session을 이어갈 수 있다. 이 경우 이전 대화 히스토리가 유지된다.

**subagent session의 가시성**: subagent session은 `parent_id`가 설정된 상태로 DB에 저장된다. UI/CLI의 session 목록은 `Session.list({ roots: true })`로 호출하여 `parent_id`가 null인 session만 표시하므로, **subagent session은 목록에 보이지 않는다.** DB에는 존재하지만 사용자가 직접 선택하여 대화를 이어가는 것은 의도되지 않은 구조다. 재개는 부모 LLM이 `task_id`를 통해서만 가능하다.

### 제한사항

| 항목 | 제한 |
|---|---|
| 재귀 | 기본 1단계 — agent에 task permission이 있어야 하위 subagent 생성 가능 |
| Max steps | agent별 `steps` 필드 (기본 Infinity) |
| Permission | agent마다 `permission` 배열로 tool 접근 제어 |
| 부모 블로킹 | await 기반이므로 subagent 완료까지 부모 turn 정지 |

> **소스 참조**: `packages/opencode/src/tool/task.ts`, `packages/opencode/src/agent/agent.ts`

---

## 참고 링크

- [OpenCode GitHub](https://github.com/anomalyco/opencode)
- 원본 비교 분석: `컨텍스트-엔지니어링-비교-codex-opencode-openclaw-2026-03-14.md`
- 핵심 소스 파일:
  - `packages/opencode/src/session/system.ts` -- system prompt 조립
  - `packages/opencode/src/session/prompt.ts` -- `SessionPrompt.loop()` 외부 루프
  - `packages/opencode/src/session/processor.ts` -- `SessionProcessor.process()` 내부 루프
  - `packages/opencode/src/session/llm.ts` -- LLM 호출 및 system message 최종 조립
  - `packages/opencode/src/session/instruction.ts` -- instruction 파일 로딩

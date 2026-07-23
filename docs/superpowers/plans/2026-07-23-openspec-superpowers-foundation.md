# OpenSpec-cn 与 Superpowers 地基实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenCode 上游源码仓库内完成 OpenSpec-cn 的 Codex/OpenCode 双适配，并建立与 Superpowers 协同工作的项目规则和执行提示词。

**Architecture:** OpenSpec-cn 以全局 CLI 提供生成与校验能力，项目内的 `openspec/` 是规范与变更历史的事实来源。Codex 与 OpenCode 分别消费各自目录下生成的 OpenSpec skills；Superpowers 继续提供设计、计划、TDD、调试和验证纪律，两者通过项目工作流文档和 `AGENTS.md` 规则衔接。

**Tech Stack:** Node.js 24.15.0、npm 11.12.1、OpenSpec-cn 1.6.0、Codex project skills、OpenCode project skills/commands、Markdown、YAML、Git。

## Global Constraints

- 基线为 `anomalyco/opencode` 的 `dev` 分支，实施分支为 `openspec-foundation`。
- 不修改根 `package.json` 和 `bun.lock`。
- 不删除或覆盖上游 `.opencode/skills/effect/SKILL.md`、agent、command、plugin、tool 或主题配置。
- 使用 OpenSpec-cn 1.6.0 的 custom profile 和完整 12 项工作流，同时生成 `codex,opencode` 两套适配。
- OpenSpec 管规范制品；Superpowers 管执行纪律；用户最新指令优先。

---

### Task 1: 安装并初始化 OpenSpec-cn 双工具适配（初始实现，后被 Task 4 取代）

**Files:**
- Create: `openspec/config.yaml`
- Create: `.codex/skills/openspec-propose/SKILL.md`
- Create: `.codex/skills/openspec-explore/SKILL.md`
- Create: `.codex/skills/openspec-apply-change/SKILL.md`
- Create: `.codex/skills/openspec-sync-specs/SKILL.md`
- Create: `.codex/skills/openspec-update-change/SKILL.md`
- Create: `.codex/skills/openspec-archive-change/SKILL.md`
- Create: `.opencode/skills/openspec-propose/SKILL.md`
- Create: `.opencode/skills/openspec-explore/SKILL.md`
- Create: `.opencode/skills/openspec-apply-change/SKILL.md`
- Create: `.opencode/skills/openspec-sync-specs/SKILL.md`
- Create: `.opencode/skills/openspec-update-change/SKILL.md`
- Create: `.opencode/skills/openspec-archive-change/SKILL.md`
- Create: `.opencode/commands/opsx-propose.md`
- Create: `.opencode/commands/opsx-explore.md`
- Create: `.opencode/commands/opsx-apply.md`
- Create: `.opencode/commands/opsx-sync.md`
- Create: `.opencode/commands/opsx-update.md`
- Create: `.opencode/commands/opsx-archive.md`

**Interfaces:**
- Consumes: Node.js `>=20.19.0`、npm 全局包目录、当前 Git 工作树。
- Produces: `openspec-cn` CLI 和 Codex/OpenCode 可发现的 OpenSpec skills/commands。

- [x] **Step 1: 安装固定版本 CLI**

Run: `npm install -g @studyzy/openspec-cn@1.6.0`

Expected: npm 以退出码 0 完成安装。

- [x] **Step 2: 验证 CLI 版本**

Run: `openspec-cn --version`

Expected: 输出 `1.6.0`。

- [x] **Step 3: 初始化 core profile 和双工具适配（初始实现，后被 Task 4 取代）**

Run: `$env:OPENSPEC_TELEMETRY='0'; openspec-cn init --tools codex,opencode --profile core`

Expected: 当时创建 core profile 的 6/6/6 生成项；这是初始实现，后被 Task 4 的 custom 12/12/12 取代。

- [x] **Step 4: 检查生成结果和上游文件共存**

Run: `Test-Path openspec/config.yaml; Test-Path .codex/skills/openspec-propose/SKILL.md; Test-Path .opencode/skills/openspec-propose/SKILL.md; Test-Path .opencode/commands/opsx-propose.md; Test-Path .opencode/skills/effect/SKILL.md`

Expected: 五项均输出 `True`。

- [x] **Step 5: 提交生成的基础文件**

Run: `git add -- openspec .codex .opencode; git commit -m "chore: initialize openspec workflows"`

Expected: 提交成功，且提交不包含 `package.json` 或 `bun.lock`。

### Task 2: 配置项目上下文与双流程协作约定

**Files:**
- Modify: `openspec/config.yaml`
- Modify: `AGENTS.md`
- Create: `docs/workflows/openspec-superpowers.md`

**Interfaces:**
- Consumes: Task 1 生成的 `openspec/config.yaml` 和仓库现有 `AGENTS.md`。
- Produces: 每个 OpenSpec change 自动继承的项目上下文，以及所有项目 agent 可读取的协作顺序。

- [x] **Step 1: 写入 OpenSpec 项目上下文**

用以下完整内容替换 `openspec/config.yaml`：

```yaml
schema: spec-driven

context: |
  项目基于 anomalyco/opencode 的 dev 分支开发，使用 TypeScript、Bun 和 monorepo。
  最终架构固定为：Web 对话窗口与飞书智能体作为用户层；Agent 层包含 Memory、规划、LLM 路由、执行、Skill、MCP Client 和业务查询工具；业务层使用 Nginx + Vue、Tomcat + Spring Boot；数据层为从用友 SQL Server 2008 迁移到云 MySQL。
  交付采用并行策略：一期先打通飞书 -> Agent -> Skill -> 业务查询工具 -> MySQL；业务系统同步开发；后续补充 Web 入口和 Agent -> MCP Client -> Spring Boot 链路。
  飞书负责用户准入与授权，智能体项目不建设或复核用户权限系统，也不默认脱敏。项目只消费飞书适配器传递的已验证接入上下文；上下文缺失、过期、伪造或不可验证时必须 fail closed，不得进入数据库工具。
  数据库工具使用数据库侧最高权限并支持完整 CRUD（增、删、改、查）。每个数据库 change 必须用 gold cases 量化业务意图、SQL、执行结果和回答解释四层准确率：写操作与高风险用例 100% 通过，读取类总体默认不低于 95%；门槛调整必须在 spec 中明确批准，未达门槛不得归档或发布。
  遵守根 AGENTS.md 的上游开发规则。测试不得从仓库根目录运行；在对应 package 目录运行测试和 bun typecheck。
  OpenSpec 是需求、行为规范、变更状态与归档历史的事实来源；Superpowers 用于 brainstorming、计划、TDD、系统化调试和完成前验证。

rules:
  proposal:
    - 明确业务价值、范围外事项、并行开发依赖和可独立验收的里程碑
    - 不改变已固定的最终架构，除非用户明确批准新的架构变更
    - 数据库变更明确最高数据库权限、完整 CRUD、飞书受信接入上下文边界和准确率发布门槛
  specs:
    - 每项需求必须包含可验证场景和明确预期结果
    - 数据库相关需求必须覆盖歧义输入、事务失败、影响行数、写后复核或回滚、schema 漂移
    - 数据库 gold cases 必须分别度量业务意图、SQL、执行结果和回答解释；写操作与高风险用例 100%，读取类总体默认不低于 95%
    - 飞书接入上下文缺失、过期、伪造或不可验证时必须 fail closed，且项目不得自行建设或复核用户权限
  design:
    - 明确组件边界、数据流、错误处理、准确率机制和后续业务接入替换点
    - 优先使用 OpenCode 原生 Agent、Skill、MCP、Plugin、Server 和 SDK 扩展点，减少核心源码分叉
    - 数据库工具必须使用数据库侧最高权限并支持完整 CRUD，且只能在飞书适配器受信接入上下文验证有效后调用
  tasks:
    - 每项任务必须包含精确文件路径、验证命令和预期结果
    - 实现任务遵循 Superpowers TDD 和 verification-before-completion
    - 数据库任务必须包含四层 gold cases、准确率统计、失败关闭证据和未达门槛时阻止归档或发布的检查
```

- [x] **Step 2: 添加协作说明文档**

创建 `docs/workflows/openspec-superpowers.md`，内容如下：

```markdown
# OpenSpec 与 Superpowers 协作流程

## 所有权

- OpenSpec：proposal、行为 specs、design、tasks、同步和归档历史。
- Superpowers：需求探索、替代方案比较、计划拆解、TDD、系统化调试和完成前验证。

## 每个变更的顺序

1. 使用 `superpowers:brainstorming` 澄清需求并取得设计批准。
2. 使用 OpenSpec propose 创建或更新 `openspec/changes/<change>/` 制品。
3. 审阅 proposal、specs、design 和 tasks，解决矛盾后再实施。
4. 使用 `superpowers:writing-plans` 细化实施步骤。
5. 使用 TDD 实施；异常进入 `superpowers:systematic-debugging`。
6. 使用 `superpowers:verification-before-completion` 检查真实命令输出。
7. 使用 `openspec-verify-change` skill（OpenCode `/opsx:verify`）检查实现与制品一致性，然后 archive；它不是 CLI 命令。

## 规则

- 用户最新指令优先；已批准的 OpenSpec specs 是项目行为事实来源。
- 不手工编辑生成的 `.codex/skills/openspec-*`、`.opencode/skills/openspec-*` 和 `.opencode/commands/opsx-*`；升级后运行 `openspec-cn update`。
- Superpowers 发现规范与实现冲突时，先更新并重新批准 OpenSpec 制品，不静默修改意图。
- 归档前必须有测试或其他可重复验证证据，并完成 `openspec-verify-change` 工作流。
```

- [x] **Step 3: 在 AGENTS.md 追加项目工作流规则**

在现有文件末尾追加以下内容，不改动前文：

```markdown

## OpenSpec and Superpowers Workflow

- For feature work and behavior changes, use OpenSpec and Superpowers together.
- Treat approved artifacts under `openspec/` as the source of truth for product intent and behavior.
- Use Superpowers for brainstorming, implementation planning, TDD, systematic debugging, and verification.
- Follow `docs/workflows/openspec-superpowers.md` for the required sequence and conflict handling.
- Do not manually edit generated OpenSpec skills or commands; refresh them with `openspec-cn update`.
```

- [x] **Step 4: 校验配置和差异**

Run: `openspec-cn validate --all; git diff --check; git diff -- package.json bun.lock`

Expected: 若当前没有 change/spec，校验输出只表示“当前没有可验证制品”，不是成功证据；无空白错误；依赖文件无差异。

- [x] **Step 5: 提交项目上下文与规则**

Run: `git add -- openspec/config.yaml AGENTS.md docs/workflows/openspec-superpowers.md; git commit -m "docs: define openspec superpowers workflow"`

Expected: 提交成功，仅包含指定文件。

### Task 3: 提供执行提示词并完成地基验收

**Files:**
- Create: `docs/workflows/execution-prompts.md`
- Modify: `docs/superpowers/plans/2026-07-23-openspec-superpowers-foundation.md`

**Interfaces:**
- Consumes: Task 1 的 OpenSpec 命令/skills 和 Task 2 的工作流规则。
- Produces: 用户可直接复制的项目启动、需求探索、提案、实现、验证和归档提示词，以及可审计的完成状态。

- [x] **Step 1: 编写执行提示词**

创建 `docs/workflows/execution-prompts.md`，包含以下可复制模板：

```markdown
# Agent 执行提示词

## 项目总启动

请读取根 AGENTS.md、openspec/config.yaml 和 docs/workflows/openspec-superpowers.md。先确认 OpenSpec-cn 1.6.0、custom profile 和完整 12 项工作流。后续同时使用 OpenSpec 与 Superpowers：先用 Superpowers 澄清和验证设计，再把已批准内容固化为 OpenSpec proposal/specs/design/tasks；实现时使用 TDD，完成前运行真实验证命令和 `openspec-verify-change` skill（OpenCode `/opsx:verify`）。它不是 CLI 命令，不要运行不存在的 `openspec-cn verify`。不得改变既定最终架构，除非我明确批准。

## 飞书数据库智能体一期

请同时使用 OpenSpec 与 Superpowers，为“飞书 -> Agent -> Skill -> 业务查询工具 -> 云 MySQL”创建第一期变更。数据库工具使用数据库侧最高权限并支持完整 CRUD。项目不建设或复核用户权限，只验证飞书适配器传递的受信接入上下文；缺失、过期、伪造或不可验证时 fail closed。用四层 gold cases 验收，写操作和高风险用例 100%，读取类总体默认不低于 95%；覆盖歧义输入、事务失败、影响行数、写后复核或回滚、schema 漂移，未达门槛不得归档或发布。先完成并展示 proposal、specs、design、tasks，不要在我批准前实现。

## 普通变更

请先使用 superpowers:brainstorming 探索以下变更，然后使用 OpenSpec propose 固化批准后的 proposal、specs、design 和 tasks：<在这里写需求>。检查它是否符合 openspec/config.yaml 和既定最终架构，展示制品摘要并等待批准后再实施。

## 继续实施

请读取当前 OpenSpec change 的全部制品和未完成 tasks，使用 superpowers:writing-plans 形成可验证实施计划，再按 TDD 执行。遇到失败必须使用 systematic-debugging 查明根因；不要绕过测试或静默改变 spec。

## 准确率验收

请对当前变更运行双重验收：先使用 superpowers:verification-before-completion 执行相关测试、类型检查和静态检查，再使用 `openspec-verify-change` skill（OpenCode `/opsx:verify`）检查完整性、正确性和一致性。列出四层 gold cases 和飞书受信上下文 fail-closed 的实现与测试证据，不用主观判断替代命令输出。

## 归档

请确认所有 OpenSpec tasks 完成、严格单 change 校验通过、测试通过、`openspec-verify-change` 无关键问题且质量门槛达标；随后同步增量 specs 并 archive 当前 change。空 `validate --all` 的 `0 items` 只是中性结果。最后报告归档路径、主 specs 变化、验证命令和提交记录。
```

- [x] **Step 2: 验证生成文件数量和关键文件**

Run: `(Get-ChildItem .codex/skills -Directory -Filter 'openspec-*').Count; (Get-ChildItem .opencode/skills -Directory -Filter 'openspec-*').Count; (Get-ChildItem .opencode/commands -File -Filter 'opsx-*.md').Count`

Expected: OpenSpec-cn 1.6.0 custom profile 对 Codex 和 OpenCode 各生成 12 个 skills，对 OpenCode 生成 12 个 commands。历史上此步骤曾验收 core 6/6/6；这是初始实现，后被 Task 4 取代。

- [x] **Step 3: 运行最终静态验收**

Run: `openspec-cn --version; openspec-cn validate --all; git diff --check; git status --short`

Expected: 版本为 1.6.0；空校验仅报告“当前没有可验证制品”；无空白错误；只剩计划勾选和执行提示词的预期改动。

- [x] **Step 4: 更新计划勾选状态并提交**

Run: `git add -- docs/workflows/execution-prompts.md docs/superpowers/plans/2026-07-23-openspec-superpowers-foundation.md; git commit -m "docs: add agent execution prompts"`

Expected: 提交成功，工作树干净。

## Task 4: 修复完整工作流、宿主映射与准确率验收边界

**Files:**
- Create: `script/openspec-foundation.test.mjs`
- Create: Codex/OpenCode 的 `new`、`continue`、`ff`、`bulk-archive`、`verify`、`onboard` skills/commands
- Modify: `AGENTS.md`
- Modify: `openspec/config.yaml`
- Modify: `docs/workflows/openspec-superpowers.md`
- Modify: `docs/workflows/execution-prompts.md`
- Modify: `docs/superpowers/specs/2026-07-23-openspec-superpowers-foundation-design.md`
- Modify: `docs/superpowers/plans/2026-07-23-openspec-superpowers-foundation.md`

- [x] **Step 1: RED — 添加适配器完整性测试并确认当前 core profile 失败**

测试必须检查 Codex skills、OpenCode skills、OpenCode commands 的 12 项完整清单，以及生成文件内引用的 `openspec-*` skill 和 `/opsx:*` command 都有实际目标。

Run from `script/`: `node --test openspec-foundation.test.mjs`

Expected: 因当前仅有 6/6/6，测试按预期失败并指出缺失的 `new/continue/ff/bulk-archive/verify/onboard`。

- [x] **Step 2: GREEN — 使用官方 custom profile 生成全部 12 项工作流**

Run:

```powershell
openspec-cn config set profile custom
openspec-cn config set workflows '[\"propose\",\"explore\",\"new\",\"continue\",\"apply\",\"update\",\"ff\",\"sync\",\"archive\",\"bulk-archive\",\"verify\",\"onboard\"]'
openspec-cn init --tools 'codex,opencode' --profile custom
openspec-cn update
```

Expected: 不手改生成文件；Codex skills、OpenCode skills、OpenCode commands 均为 12 项。

- [x] **Step 3: 固化宿主工具映射、最高权限边界和量化准确率门槛**

要求：

- 将生成模板中的 `AskUserQuestion`、`TodoWrite`、`Task tool`、`Skill tool` 和 `/opsx:*` 视为宿主抽象名，并映射到 Codex/OpenCode 当前可用的等价能力。
- 明确 `openspec-verify-change`（OpenCode `/opsx:verify`）是工作流，而不是不存在的 `openspec-cn verify` CLI 命令。
- 数据库工具使用最高数据库权限并支持完整 CRUD；项目不实现或复核用户权限，只消费飞书适配器传递的已验证接入上下文。接入上下文缺失、过期、伪造或不可验证时 fail closed，不进入数据库工具。
- 每个数据库 change 定义 gold cases 和业务意图、SQL、执行结果、回答解释四层指标。写操作和高风险用例要求 100% 通过；读取类总体门槛默认不低于 95%，调整必须在 spec 中明确批准。
- 覆盖歧义输入、事务失败、影响行数、写后复核/回滚、schema 漂移；未达门槛不得归档或发布。
- 空的 `validate --all` 只表述为“当前没有可验证制品”；首个真实 change 后使用严格的单 change 校验。
- 日常入口记录 CLI 1.6.0 和完整 custom profile 前置条件，不引入 monorepo 依赖。

- [x] **Step 4: GREEN — 运行完整性测试与静态验证**

Run from `script/`: `node --test openspec-foundation.test.mjs`

Run from repo root: `openspec-cn --version; openspec-cn config list --json; openspec-cn doctor --json; openspec-cn templates --schema spec-driven --json; openspec-cn validate --all --strict --json; git diff --check`

Expected: 测试通过；版本为 1.6.0；profile 为 custom 且含 12 个 workflows；doctor/config/templates 可解析；空 validate 明确为 0 items；依赖文件无变化。

- [x] **Step 5: 提交修复并重新独立审查**

Run: `git commit -m "fix: complete openspec workflow foundation"`

Expected: 提交成功，工作树干净；Critical/Important 审查意见全部关闭。

# OpenSpec-cn 与 Superpowers 地基实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenCode 上游源码仓库内完成 OpenSpec-cn 的 Codex/OpenCode 双适配，并建立与 Superpowers 协同工作的项目规则和执行提示词。

**Architecture:** OpenSpec-cn 以全局 CLI 提供生成与校验能力，项目内的 `openspec/` 是规范与变更历史的事实来源。Codex 与 OpenCode 分别消费各自目录下生成的 OpenSpec skills；Superpowers 继续提供设计、计划、TDD、调试和验证纪律，两者通过项目工作流文档和 `AGENTS.md` 规则衔接。

**Tech Stack:** Node.js 24.15.0、npm 11.12.1、OpenSpec-cn 1.6.0、Codex project skills、OpenCode project skills/commands、Markdown、YAML、Git。

## Global Constraints

- 基线为 `anomalyco/opencode` 的 `dev` 分支，实施分支为 `openspec-foundation`。
- 不修改根 `package.json` 和 `bun.lock`。
- 不删除或覆盖上游 `.opencode/skills/effect/SKILL.md`、agent、command、plugin、tool 或主题配置。
- 使用 OpenSpec-cn 1.6.0 的 core profile，同时生成 `codex,opencode` 两套适配。
- OpenSpec 管规范制品；Superpowers 管执行纪律；用户最新指令优先。

---

### Task 1: 安装并初始化 OpenSpec-cn 双工具适配

**Files:**
- Create: `openspec/config.yaml`
- Create: `.codex/skills/openspec-propose/SKILL.md`
- Create: `.codex/skills/openspec-explore/SKILL.md`
- Create: `.codex/skills/openspec-apply-change/SKILL.md`
- Create: `.codex/skills/openspec-sync-specs/SKILL.md`
- Create: `.codex/skills/openspec-archive-change/SKILL.md`
- Create: `.opencode/skills/openspec-propose/SKILL.md`
- Create: `.opencode/skills/openspec-explore/SKILL.md`
- Create: `.opencode/skills/openspec-apply-change/SKILL.md`
- Create: `.opencode/skills/openspec-sync-specs/SKILL.md`
- Create: `.opencode/skills/openspec-archive-change/SKILL.md`
- Create: `.opencode/commands/opsx-propose.md`
- Create: `.opencode/commands/opsx-explore.md`
- Create: `.opencode/commands/opsx-apply.md`
- Create: `.opencode/commands/opsx-sync.md`
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

- [x] **Step 3: 初始化 core profile 和双工具适配**

Run: `$env:OPENSPEC_TELEMETRY='0'; openspec-cn init --tools codex,opencode --profile core`

Expected: 创建 `openspec/`、`.codex/skills/openspec-*`、`.opencode/skills/openspec-*` 和 `.opencode/commands/opsx-*.md`，退出码为 0。

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
  飞书负责用户准入与授权，智能体项目不重复建设用户权限系统，也不默认脱敏。
  数据库工具需要支持完整增删改查。核心质量指标是业务语义、SQL、执行结果和回答解释的准确率。
  遵守根 AGENTS.md 的上游开发规则。测试不得从仓库根目录运行；在对应 package 目录运行测试和 bun typecheck。
  OpenSpec 是需求、行为规范、变更状态与归档历史的事实来源；Superpowers 用于 brainstorming、计划、TDD、系统化调试和完成前验证。

rules:
  proposal:
    - 明确业务价值、范围外事项、并行开发依赖和可独立验收的里程碑
    - 不改变已固定的最终架构，除非用户明确批准新的架构变更
  specs:
    - 每项需求必须包含可验证场景和明确预期结果
    - 数据库相关需求必须覆盖查询、写入、事务失败、结果复核和歧义输入
  design:
    - 明确组件边界、数据流、错误处理、准确率机制和后续业务接入替换点
    - 优先使用 OpenCode 原生 Agent、Skill、MCP、Plugin、Server 和 SDK 扩展点，减少核心源码分叉
  tasks:
    - 每项任务必须包含精确文件路径、验证命令和预期结果
    - 实现任务遵循 Superpowers TDD 和 verification-before-completion
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
7. 使用 OpenSpec verify 检查实现与制品一致性，然后 archive。

## 规则

- 用户最新指令优先；已批准的 OpenSpec specs 是项目行为事实来源。
- 不手工编辑生成的 `.codex/skills/openspec-*`、`.opencode/skills/openspec-*` 和 `.opencode/commands/opsx-*`；升级后运行 `openspec-cn update`。
- Superpowers 发现规范与实现冲突时，先更新并重新批准 OpenSpec 制品，不静默修改意图。
- 归档前必须有测试或其他可重复验证证据，并完成 OpenSpec verify。
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

Expected: OpenSpec 校验成功；无空白错误；依赖文件无差异。

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

请读取根 AGENTS.md、openspec/config.yaml 和 docs/workflows/openspec-superpowers.md。后续同时使用 OpenSpec 与 Superpowers：先用 Superpowers 澄清和验证设计，再把已批准内容固化为 OpenSpec proposal/specs/design/tasks；实现时使用 TDD，完成前运行真实验证命令和 OpenSpec verify。不得改变既定最终架构，除非我明确批准。

## 飞书数据库智能体一期

请同时使用 OpenSpec 与 Superpowers，为“飞书 -> Agent -> Skill -> 业务查询工具 -> 云 MySQL”创建第一期变更。飞书负责准入授权；项目不重复做用户权限和默认脱敏。数据库工具支持增删改查，设计重点是业务语义、SQL、执行结果与回答解释的准确率，并为后续 Web、MCP Client 和 Spring Boot 接入保留稳定边界。先完成并展示 proposal、specs、design、tasks，不要在我批准前实现。

## 普通变更

请先使用 superpowers:brainstorming 探索以下变更，然后使用 OpenSpec propose 固化批准后的 proposal、specs、design 和 tasks：<在这里写需求>。检查它是否符合 openspec/config.yaml 和既定最终架构，展示制品摘要并等待批准后再实施。

## 继续实施

请读取当前 OpenSpec change 的全部制品和未完成 tasks，使用 superpowers:writing-plans 形成可验证实施计划，再按 TDD 执行。遇到失败必须使用 systematic-debugging 查明根因；不要绕过测试或静默改变 spec。

## 准确率验收

请对当前变更运行双重验收：先使用 superpowers:verification-before-completion 执行相关测试、类型检查和静态检查，再使用 OpenSpec verify 检查完整性、正确性和一致性。列出每项业务场景对应的实现与测试证据，不用主观判断替代命令输出。

## 归档

请确认所有 OpenSpec tasks 完成、测试通过且 verify 无关键问题；随后同步增量 specs 并 archive 当前 change。最后报告归档路径、主 specs 变化、验证命令和提交记录。
```

- [x] **Step 2: 验证生成文件数量和关键文件**

Run: `(Get-ChildItem .codex/skills -Directory -Filter 'openspec-*').Count; (Get-ChildItem .opencode/skills -Directory -Filter 'openspec-*').Count; (Get-ChildItem .opencode/commands -File -Filter 'opsx-*.md').Count`

Expected: OpenSpec-cn 1.6.0 core profile 对 Codex 和 OpenCode 各生成 6 个 skills，对 OpenCode 生成 6 个 commands（包含 `update-change` 工作流）。

- [x] **Step 3: 运行最终静态验收**

Run: `openspec-cn --version; openspec-cn validate --all; git diff --check; git status --short`

Expected: 版本为 1.6.0；校验成功；无空白错误；只剩计划勾选和执行提示词的预期改动。

- [x] **Step 4: 更新计划勾选状态并提交**

Run: `git add -- docs/workflows/execution-prompts.md docs/superpowers/plans/2026-07-23-openspec-superpowers-foundation.md; git commit -m "docs: add agent execution prompts"`

Expected: 提交成功，工作树干净。

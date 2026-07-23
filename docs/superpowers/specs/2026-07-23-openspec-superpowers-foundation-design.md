# OpenSpec-cn 与 Superpowers 协作地基设计

## 目标

在 `anomalyco/opencode` 的 `dev` 分支基础上建立中文规范驱动开发地基，同时支持 Codex 与 OpenCode。最终业务智能体架构保持既定版本不变；本次只引入研发流程、规范制品和执行入口。

## 约束

- 保留上游 `AGENTS.md`、`.opencode/` 结构和 Bun monorepo 依赖，不覆盖既有规则。
- OpenSpec-cn 不加入根 `package.json`，避免无关的 `bun.lock` 变更。
- 同时生成 Codex 与 OpenCode 的项目级 skills；OpenCode 额外生成项目级 commands。
- OpenSpec-cn 固定为 1.6.0，使用含 12 项工作流的 custom profile。
- OpenSpec 是需求、行为规范、变更状态和归档历史的唯一事实来源。
- Superpowers 是探索、设计评审、计划、TDD、系统化调试和完成前验证的执行纪律。

## 方案比较

### 方案 A：全局 CLI + 项目内双工具适配（采用）

全局安装 `@studyzy/openspec-cn`，在仓库根目录以 `codex,opencode` 初始化。优点是遵循官方安装方式，不污染业务依赖，且两个智能体入口共享同一套 `openspec/` 制品。

### 方案 B：作为 monorepo 开发依赖

把 OpenSpec-cn 加入根 `package.json`。虽然版本可由锁文件固定，但会修改上游依赖图和 Bun 锁文件，并把研发流程工具混入产品构建，因此不采用。

### 方案 C：独立 OpenSpec Store

把规范放进单独仓库，适合未来跨多个业务仓库共享需求。目前 Store 仍为 beta，且当前只有一个代码仓库，因此不采用。

## 文件布局

- `openspec/`：主规范、活动变更、归档和项目上下文。
- `.codex/skills/openspec-*/`：Codex 的 OpenSpec skills。
- `.opencode/skills/openspec-*/`：OpenCode 的 OpenSpec skills，与上游现有 `effect` skill 并存。
- `.opencode/commands/opsx-*.md`：OpenCode 的 OPSX 命令。
- `docs/workflows/openspec-superpowers.md`：两套方法的协作规则与操作说明。
- `docs/workflows/execution-prompts.md`：可直接复制的启动、变更、实现和验证提示词。

生成的 OpenSpec skill 与 command 文件由 `openspec-cn update` 维护，不手工修改。

三个目标的清单均为 12 项：`propose`、`explore`、`new`、`continue`、`apply`、`update`、`ff`、`sync`、`archive`、`bulk-archive`、`verify`、`onboard`。对应 Codex/OpenCode skill 名称由官方生成器提供，OpenCode commands 使用 `/opsx:*` 逻辑入口。

## 宿主适配

官方模板中的 `AskUserQuestion`、`TodoWrite`、`Task tool` 和 `Skill tool` 是宿主抽象名，由项目规则映射到 Codex/OpenCode 当前可用的提问、计划、获授权委派和 skill 调用能力。`/opsx:*` 在 OpenCode 中调用 slash command，在 Codex 中调用对应 `openspec-*` skill，不能当作 shell 命令。

一致性验证使用 `openspec-verify-change` skill；OpenCode 等价入口为 `/opsx:verify`。它不是 CLI 子命令，不存在 `openspec-cn verify`。

## 标准工作流

1. 使用 Superpowers brainstorming 理清目标、约束和替代方案。
2. 用 OpenSpec propose 为变更创建 proposal、specs、design 和 tasks。
3. 人工确认 OpenSpec 制品后，使用 Superpowers writing-plans 把任务细化为可执行步骤。
4. 实现阶段使用 Superpowers TDD；遇到异常使用 systematic-debugging。
5. 完成前先运行 Superpowers verification-before-completion，再运行 `openspec-verify-change` 检查实现与制品的一致性。
6. 验证通过后使用 OpenSpec archive，把增量规范同步到主 specs 并保留变更历史。

OpenSpec 制品与 Superpowers 文档发生冲突时，以用户最新指令和已批准的 OpenSpec 行为规范为准；Superpowers 负责推动修正设计或实现，而不静默覆盖规范。

## 数据库与质量边界

- 数据库工具使用数据库侧最高权限并支持完整 CRUD。
- 项目不建设或复核用户权限，只验证飞书适配器提供的受信接入上下文；缺失、过期、伪造或不可验证时 fail closed。
- 每个数据库 change 使用 gold cases 分别量化业务意图、SQL、执行结果和回答解释。写操作与高风险用例要求 100%，读取类总体默认不低于 95%，调整必须由 spec 明确批准。
- 验收覆盖歧义输入、事务失败、影响行数、写后复核或回滚和 schema 漂移。未达门槛不得归档或发布。

## 初始化内容

- 克隆上游 `dev` 分支并在独立分支 `openspec-foundation` 工作。
- 安装 OpenSpec-cn 1.6.0。
- 使用 custom profile 和完整 12 项工作流初始化 `codex,opencode`。
- 在 `openspec/config.yaml` 写入当前技术栈、固定终态架构、并行交付策略和准确率优先原则。
- 增加项目级协作约定与执行提示词。

历史说明：Task 1 最初使用 core profile，只生成 6/6/6 项；这是初始实现，后被 Task 4 的 custom 12/12/12 配置取代。

## 验证

- `openspec-cn --version` 返回预期版本。
- `openspec-cn config list --json` 显示 custom profile 和完整 12 项工作流。
- `openspec-cn doctor --json` 与 `openspec-cn templates --schema spec-driven --json` 可解析。
- `openspec-cn validate --all --strict --json` 的空 `0 items` 仅作为“当前没有可验证制品”的中性结果；真实 change 使用严格单 change 校验。
- Codex skills、OpenCode skills 和 OpenCode commands 均为 12 项，且生成文件内的 workflow/command 引用都有真实目标。
- 上游原有 `.opencode/skills/effect/SKILL.md` 和其他配置保持存在。
- `git diff --check` 无空白错误，且 `package.json`、`bun.lock` 未被修改。

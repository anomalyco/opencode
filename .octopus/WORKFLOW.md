# Octopus 开发工作流

> AI 虚拟团队 + E2E 开发流程。单文档，所有 Agent 唯一真相来源。
> 覆盖：Agent 团队 / Phase-by-Phase R&R / Checklist / 工作产品 / LLM Panel / Git 约定 / Skill 分配 / opencode 配置。

---

## 一、Agent 团队

### 1.1 概览

| Agent | Mode | 模型 | 色码 | 简述 |
|-------|------|------|------|------|
| **analyst** | primary | DeepSeek V4 Pro | `#FF8800` | 需求发现 — 澄清模糊 idea、拆解为 Issue（P0） |
| **orchestrator** | primary | DeepSeek V4 Flash | `#FF4444` | 流程编排 — 分派、汇总、门控、发布审批（P1-P10） |
| architect | subagent | DeepSeek V4 Pro | `#DD3333` | 架构审定 — 设计评审、PR 审批、技术 RCA |
| core-dev | subagent | DeepSeek V4 Pro | `#4488FF` | 核心开发 — Effect 服务、Drizzle schema、包依赖拓扑 |
| release | subagent | DeepSeek V4 Pro | `#AA44FF` | 发布管理 — 版本发布、回滚、Hotfix、RCA 复盘 |
| platform | subagent | DeepSeek V4 Flash | `#3366FF` | 平台基础设施 — CI/CD、构建管线、Docker、Nix |
| feature-dev | subagent | DeepSeek V4 Flash | `#44CC88` | 功能开发 — UI/App、扩展、文档、i18n |
| qa | subagent | DeepSeek V4 Flash | `#FFAA00` | 质量保障 — 测试、质量门、Canary 监控、质量否决 |
| security | subagent | DeepSeek V4 Flash | `#CC4444` | 安全合规 — 审计、Secrets 管理、bundle size |
| compat | subagent | DeepSeek V4 Flash | `#8866FF` | 兼容性 — 迁移、deprecation、MIGRATION.md |
| triage | subagent(hidden) | GPT-5.4-nano | — | Issue 自动分类 |
| duplicate-pr | subagent(hidden) | Claude Haiku 4.5 | — | 重复 PR 检测 |

> **执行模式**：analyst 是用户第一个接触的 Agent（P0 Discovery）。Discovery 完成后，analyst 将结果交给 orchestrator，由 orchestrator 接管 P1→P10。orchestrator 通过 opencode Task tool 调用 subagent 执行具体任务。所有 Agent markdown 定义文件统一放在 `.opencode/agents/`，通过 frontmatter `mode: primary|subagent` 区分。

### 1.2 analyst — DeepSeek V4 Pro（primary）

```
色码: #FF8800  上下文文件: ~30  模式: primary

核心文件: AGENTS.md, .octopus/WORKFLOW.md, 所有 discovery 文档, CHANGELOG.md, package.json（包拓扑）
```

| Phase | 职责 | 工作产品 |
|-------|------|----------|
| P0 | 与用户对话澄清模糊需求 → 探索代码库判定范围 → 查重 → 拆解为 1~N 个 Issue | Discovery 文档 |

**去重规则**:
- P0 开始时先查已有 `.octopus/discovery/` 文档、CHANGELOG、GitHub Issues，判断 idea 是否全新或已有覆盖
- 发现重复 → 告知用户已有方案，建议复用或放弃
- 去重结果写入 Discovery 文档 "查重结果" 章节

**核心原则**:
- 通过多轮对话理解用户真实意图（5 Whys 方法）
- 探索问题空间时不做技术深度分析，只做范围判定
- 拆解 Issue 时遵循 INVEST 原则（Independent / Negotiable / Valuable / Estimable / Small / Testable）
- 一个 Discovery 文档可产出多个关联 Issue，标注依赖关系

### 1.3 orchestrator — DeepSeek V4 Flash（primary）

```
色码: #FF4444  上下文文件: ~10  模式: primary

核心文件: AGENTS.md, .octopus/WORKFLOW.md
```

| Phase | 职责 | 工作产品 |
|-------|------|----------|
| P1 | 变更分级 + 决定进当前版本/下一版本/Fast-track | 标签 + 分派 |
| P2 | 收集候选 Issue → 去重 → 冲突检测 → 排序 → 制定版本计划 + 并发控制 | 版本计划 |
| P3 | **分派 Agent 做领域分析，汇总形成需求文档**（不做分析） | 需求分析报告 |
| P4 | 发起 LLM Panel 评审需求报告，Go/No-Go 决策 | 评审记录 + Milestone |
| P5 | 协调 subagent 完成设计，分派 LLM Panel 评审，最终批准 | 批准/退回意见 |
| P6 | **监控不执行** — 由 subagent 执行编码 | — |
| P7 | 按变更类型分级审批 Merge，调用 QA subagent 执行质量门 | Merge 批准 |
| P8 | Canary Go/No-Go 最终审批 | 发布绿灯 |
| P9 | CHANGELOG 审核，调用 Release subagent 执行发布 | 审核意见 |
| P10 | RCA 指导，改进措施→Issue | 改进 Issue |

> **编排模式**：orchestrator 是 orchestrator 阶段的用户入口。用户与 orchestrator 对话，orchestrator 通过 `@agent-name` 调用 subagent 执行具体任务，收集结果，做出决策。用户从 analyst mode 切换到此。

### 1.4 architect — DeepSeek V4 Pro（subagent）

```
色码: #DD3333  上下文文件: ~15  模式: subagent

核心文件: AGENTS.md, Effect rules, 技术设计文档模板
```

| Phase | 职责 | 工作产品 |
|-------|------|----------|
| P2 | 审查版本计划的依赖排序、架构一致性 | 审查意见 |
| P5 | 技术设计审定（架构合理性、接口契约、Effect 服务设计） | 批准/退回意见 |
| P7 | 技术 PR 审批（`feat:`/`refactor:`/`feat!:`） | Merge 批准 |
| P10 | 技术根因分析（系统层面，非个人失误） | RCA 技术章节 |

**审批规则**

| 类型 | architect 角色 |
|------|---------------|
| `feat:` / `refactor:` | 必须审批 |
| `feat!:`（Breaking） | 必须审批 + 评估架构影响 |
| `chore:` / `docs:` / `fix:` | 按需 |

> architect 不做流程管理、不写代码、不执行测试。仅负责技术决策。由 orchestrator 在 P2/P5/P7/P10 时调用。

### 1.5 platform — DeepSeek V4 Flash（subagent）

```
色码: #3366FF  上下文文件: ~40

核心文件: turbo.json, .github/workflows/*.yml, script/*.ts, Dockerfile, flake.nix, nix/*.nix
```

| Phase | 职责 | 工作产品 |
|-------|------|----------|
| P1 | CI 相关变更预评估 | 预评估意见 |
| P3 | CI/CD 影响分析 | 影响分析 |
| P5 | 构建/发布管线设计 | CI 设计方案 |
| P6 | workflow 维护 / script 开发 / Docker/Nix | 配置变更 |
| P7 | Turborepo 任务图验证 | 验证报告 |

### 1.6 core-dev — DeepSeek V4 Pro（subagent）

```
色码: #4488FF  上下文文件: ~200

核心文件: packages/core/, packages/octopus/src/, packages/llm/, packages/enterprise/, packages/function/, packages/plugin/, packages/http-recorder/
```

| Phase | 职责 | 工作产品 |
|-------|------|----------|
| P3 | 核心代码影响分析 | 涉及包/文件清单 |
| P5 | 架构/数据模型/接口契约设计 | 技术设计文档 |
| P6 | Effect 服务 / Drizzle schema / ServiceTag / Import / 包名 | 源代码、测试 |
| P6 | 自动化批量替换脚本 | 脚本 |
| P7 | Code Review（核心代码） | Review 意见 |

### 1.7 feature-dev — DeepSeek V4 Flash（subagent）

```
色码: #44CC88  上下文文件: ~150

核心文件: packages/app/, packages/ui/, packages/web/, packages/desktop/, packages/console/, packages/slack/, packages/storybook/, sdks/vscode/, packages/extensions/zed/, packages/identity/, i18n/*, docs/*
```

| Phase | 职责 | 工作产品 |
|-------|------|----------|
| P3 | UI/应用影响分析 | UI 影响清单 |
| P5 | UI 组件/扩展设计 | UI 设计方案 |
| P6 | SolidJS / Astro / VS Code / Zed / 主题 | 源代码 |
| P6 | 文档更新 / i18n 键替换 / 翻译 | 文档变更 |
| P7 | Code Review（展示层） | Review 意见 |

### 1.8 qa — DeepSeek V4 Flash（subagent）

```
色码: #FFAA00  上下文文件: ~15

核心文件: 测试套件, 质量门定义, Canary 配置
```

| Phase | 职责 | 工作产品 |
|-------|------|----------|
| P3 | 验收标准可测试性审查 | 审查意见 |
| P5 | 测试策略设计 | 测试方案 |
| P7 | bun turbo test:ci / Playwright / HttpApi / 冒烟 | 测试报告 |
| P7 | 按变更级别执行分级质量门 | 质量门报告 |
| P8 | Canary 灰度监控 + Go/No-Go 质量否决 | Canary 报告 |
| P9 | 发布后 24h 监控 | 监控报告 |

### 1.9 security — DeepSeek V4 Flash（subagent）

```
色码: #CC4444  上下文文件: ~10

核心文件: .gitleaksignore, CI secrets 清单, bun audit 基线, bundle size 基线
```

| Phase | 职责 | 工作产品 |
|-------|------|----------|
| P3 | 安全风险评估 | 安全风险清单 |
| P5 | 安全合规审查（P3 发现需追踪时） | 审查意见 |
| P6 | bun audit / bundle size 检查 | 审计报告 |
| P7 | Secrets 双轨制验证 | 安全验证报告 |
| P8 | Canary 安全扫描 | 扫描报告 |

### 1.10 compat — DeepSeek V4 Flash（subagent）

```
色码: #8866FF  上下文文件: ~10

核心文件: 迁移代码, fallback 逻辑, deprecation 时间线, 环境变量映射表
```

| Phase | 职责 | 工作产品 |
|-------|------|----------|
| P5 | 兼容策略设计（Breaking Change 时） | 兼容方案 |
| P6 | 环境变量双轨 / 配置迁移代码 / CLI alias / npm deprecation | 兼容代码 |
| P7 | 兼容性验证 | 兼容验证报告 |
| P9 | MIGRATION.md 编写 | MIGRATION.md |

### 1.11 release — DeepSeek V4 Pro（subagent）

```
色码: #AA44FF  上下文文件: ~10

核心文件: script/release, publish.yml, 7 条发布路径文档
```

| Phase | 职责 | 工作产品 |
|-------|------|----------|
| P5 | 发布策略审定（Breaking Change 标注 + 兼容窗口） | 发布计划 |
| P8 | Canary → 正式 Promote | 发布命令 |
| P9 | 版本号/Tag/构建/npm/AUR/Homebrew/Docker 发布 | 发布产物 |
| P9 | Hotfix 发布 / 紧急回滚 | Hotfix 版本 |
| P10 | RCA 复盘报告编写 | RCA 报告 |

---

## 二、变更分级

| 级别 | 文件数 | 流程路径 |
|------|--------|----------|
| XS | <10 | Fast-Track: P1→P3(快速)→P6→P7→P9 |
| S | 10-50 | Fast-Track: P1→P3(快速)→P6→P7→P9 |
| M | 50-150 | 全流程: P1→P3→P4(LLM)→P5→P6→P7→P9 |
| L | 150-500 | 全流程+Canary: +P8 |
| XL | >500 | 全流程+Canary+复盘: +P8+P10 |
| Hotfix | <50 | Hotfix: P1→P6→P9 |

---

## 三、Phase-by-Phase

---

### P0: Discovery — 原始需求发现与拆解

> 用户第一个接触的 Agent 是 analyst。analyst 与用户多轮对话澄清模糊需求，探索代码库判定范围，查重，拆解为一个或多个结构化 Issue 草稿。

| 角色 | 职责 | 工作产品 |
|------|------|----------|
| **analyst** | 与用户对话澄清 → 探索代码库 → 查重 → 拆解 Issue | Discovery 文档 |
| 用户 | 描述原始 idea（一句话或自然语言均可） | — |

**工作产品**

| 产出物 | 存储 | 模板 |
|--------|------|------|
| Discovery 文档 | `.octopus/discovery/<date>-<slug>.md` | `templates/discovery-template.md` |

**查重规则**

analyst 在 P0 开始时必须执行：
1. 搜索已有 `.octopus/discovery/` 文档
2. 搜索 CHANGELOG.md 中已发布的类似功能
3. 搜索 GitHub Issues（open + closed）中语义相似的 Issue
4. 发现重复 → 告知用户，建议复用或放弃
5. 去重结果写入 Discovery 文档 "查重结果" 章节

**Issue 拆解原则**

- 遵循 INVEST 原则
- 标注 Issue 间依赖关系（blocked-by / blocks）
- 标注可并行执行的 Issue 组
- 每个 Issue 应可独立交付价值
- 评估每个 Issue 的预估文件数（供 P1 分级使用）

**Checklist**
- [ ] 用户意图已澄清（原始 idea → 清晰问题陈述）
- [ ] 查重已完成并记录
- [ ] 代码库影响范围已初步判定（涉及的包/模块）
- [ ] 已拆解为 1~N 个 Issue 草稿，标注依赖/并行关系
- [ ] Discovery 文档已归档

---

### P1: Issue 创建与分流

> P0 Discovery 产出的 Issue 草稿在此正式创建为 GitHub Issue。orchestrator 不做分析，只分流 + 分派 Agent。

| 角色 | 职责 | 工作产品 |
|------|------|----------|
| 用户 | 描述问题/需求/idea | GitHub Issue |
| triage Bot | 模板验证，自动分类 | 合规判定 |
| duplicate-pr Bot | 查重 | 重复标记 |
| **orchestrator** | 变更分级 + 判定影响包范围 + 分派 domain agent（M+ 级 ≥2 agent） | 标签 + 分派 |

**冲突检测（P1 执行）**

orchestrator 在分级时查询当前所有 `In Progress` 状态 Issue 的影响范围，交叉比对文件/包清单。有同文件冲突则标记为 blocked。

**Checklist**
- [ ] 变更级别标签已设置（`size:xs|s|m|l|xl`）
- [ ] 影响包范围已初判
- [ ] M+ 级：≥2 domain agent 已分配
- [ ] 与当前 In Progress Issue 无同文件冲突（有冲突→标记 blocked）

---

### P2: 版本计划制定

> orchestrator 周期性执行（通常在上一版本 P7 期间启动）。P2 从已通过 P1 分级的 Issue 池中收集候选 Issue，经过去重、冲突检测、排序后制定版本计划。P2 输出的版本计划是本版本执行的蓝图——策略层面决定执行顺序，并发控制作为运行时的执行保障。

| 角色 | 职责 | 工作产品 |
|------|------|----------|
| **orchestrator** | 收集候选 Issue → 去重 → 冲突检测 → 排序 → 制定版本计划 | 版本计划草案 |
| **architect** | 审查技术可行性、依赖排序、架构一致性 | 审查意见 |
| **qa** | 审查版本范围与测试容量匹配度 | 审查意见 |

**工作产品**

| 产出物 | 存储 | 模板 |
|--------|------|------|
| 版本计划 | `.octopus/version-plans/vX.Y.Z.md` | `templates/version-plan-template.md` |

**去重规则**

orchestrator 在入池时必须执行：
1. 交叉比对所有候选 Issue 的影响范围（包/文件清单）
2. 语义级去重——不同 Issue 描述同一目标 → 合并为单个 Issue
3. 排除已在过往版本发布的 Issue（CHANGELOG 已包含）
4. 排除已有关联 PR 已 merge 的 Issue
5. 去重记录写入版本计划 "去重说明" 章节

**冲突检测与排序**

orchestrator 执行：
1. 收集所有候选 Issue（已通过 P1 分级，标签完备、影响包已初判）
2. 对涉及同包的 Issue 强制串行排序
3. 识别跨包依赖（如 core API 变更 → ui 需适配）
4. 标识 Fast-track 候选（XS/S + 无同包冲突）
5. 生成 P6 执行序列

**入队规则**: 版本计划通过后，范围内 Issue 锁定——仅 Hotfix 和批准的版本修订可破门。

**Checklist**
- [ ] 去重已完成并记录（语义去重 + 影响范围交叉比对）
- [ ] 候选 Issue 均已通过 P1 分级（标签完备、影响包已初判）
- [ ] 同包冲突已检测并排序（同包串行、异包并行）
- [ ] 跨包依赖已识别并正确排序
- [ ] Fast-track 候选已标识
- [ ] 版本范围与 Agent 容量匹配（每个 Agent ≤ 3 个 M+ Issue）
- [ ] **LLM Panel 评审通过**（≥5/7，评审记录→`.octopus/review/vX.Y-version-plan.md`）

**LLM Panel 评审维度**: 版本范围合理性、Issue 排序正确性、冲突检测完整性、风险识别

#### P2 执行保障：多 Issue 并发控制

> 版本计划定义了蓝图，并发控制确保蓝图执行不冲突。

**Issue 优先级**

| 级别 | 定级条件 | 抢占 |
|------|---------|:---:|
| P0 | Hotfix、安全漏洞、CI 全红阻断 | 立即抢占 |
| P1 | 阻塞其他 Issue 的前置依赖 | 排在 P0 后 |
| P2 | 常规 M/L 级 Feature | FIFO |
| P3 | XS/S 级 + chore/docs | 空闲穿插 |

**WIP 限制**

| 约束 | 值 |
|------|----|
| 单 Agent 同时处理 Issue | **1** |
| 同包并行 Issue | **1**（禁止） |
| 同文件并行 Issue | **0**（强制串行） |

**Agent 上下文暂存**

P0/Hotfix 抢占当前 Agent 时：
1. 写入上下文快照到 `.octopus/context/<issue-id>-<agent>.md`
2. `git stash` 或 commit WIP
3. 切换处理紧急 Issue
4. 恢复时加载上下文快照

**运行时入队规则**

```
新 Issue → P1 分级 → 冲突检测
  ├── 无冲突 + Agent 空闲 → 立即开始
  ├── 无冲突 + Agent 忙碌 → 排队
  ├── 有同文件冲突 → 等待前序 merge
  └── P0/Hotfix → 抢占 → 上下文暂存
```

---

### P3: 需求分析与定义（ALL 级别）★ 核心 Phase

> **orchestrator 不自己做分析**——根据问题领域分派给专业 Agent。每个 Agent 在领域内做深度分析，orchestrator 汇总形成统一需求文档。

**Agent 分派规则**

| Issue 领域 | 必须参与 Agent | 触发条件 |
|-----------|---------------|---------|
| XS/S（typo, trivial fix） | orchestrator 独立 | — |
| 核心代码 | **core-dev** | packages/core, opencode, llm, enterprise, function, plugin |
| UI/展示层 | **feature-dev** | app, ui, web, desktop, docs, i18n, 扩展 |
| CI/构建 | **platform** | workflow, script, Docker, Nix |
| 安全相关 | **security** | auth, secrets, 依赖, gitleaks |
| Breaking Change | 上述 + **compat** | 用户接口/配置格式变化 |
| 验收标准 | **qa** | 所有 M+ 级 |

**各 Agent P3 职责**

| Agent | 分析内容 |
|-------|---------|
| orchestrator | 分派 + 汇总各 Agent 分析 → 统一需求文档 |
| core-dev | 技术可行性、架构影响、代码范围、估算文件数 |
| feature-dev | UX/UI 影响、i18n 范围、文档变更量 |
| platform | CI/CD 影响、workflow 变更、Nix/Docker 影响 |
| security | 安全风险、依赖漏洞、Secrets 变更 |
| compat | Breaking Change 判定、迁移成本、兼容窗口 |
| qa | 验收标准可测试性（Given/When/Then） |

**工作产品**

| 产出物 | 存储 |
|--------|------|
| 需求分析报告 | `.octopus/research/<issue-id>.md`（模板见 templates/research-template.md） |

**Checklist**
- [ ] 需求已澄清（原始 idea → 结构化需求描述）
- [ ] M+ 级：≥2 domain agent 完成领域分析
- [ ] Breaking Change 已判定（compat 已参与）
- [ ] 验收标准（Given/When/Then 格式）已定义
- [ ] 工作量等级已确定
- [ ] 需求分析报告已归档

---

### P4: 需求评审（ALL 级别）

> LLM Panel 评审 P3 输出的需求分析报告——确保需求本身的质量，而非等到 P5 设计阶段才发现需求有问题。

| 级别 | 评审方式 | 通过阈值 | 评审记录 |
|------|---------|---------|---------|
| XS/S | orchestrator 自审 | 自审即可 | — |
| M/L/XL | 7 方 LLM Panel | ≥4/7 Go | `.octopus/review/<issue-id>-p4.md` |

**LLM Panel 评审维度**: 需求完整性、技术可行性准确度、验收标准可测试性、工作量合理性

**共识规则**: ≥4/7 一致 → 采纳。≥4/7 批评 → 退回 P3 修正后重审。最多 3 轮。分歧→orchestrator 裁定。

**Checklist**
- [ ] XS/S: orchestrator 自审通过
- [ ] M+: LLM Panel ≥4/7 Go → 创建 GitHub Milestone
- [ ] 评审记录已归档

---

### P5: 方案设计与开发计划（仅 M/L/XL 级）

| 角色 | 职责 | 工作产品 |
|------|------|----------|
| **core-dev** | 架构/数据模型/接口契约设计 | 技术设计文档（核心部分） |
| **feature-dev** | UI/扩展/文档设计 | 技术设计文档（展示层部分） |
| **platform** | 构建/发布管线设计 | 技术设计文档（CI 部分） |
| **qa** | 测试策略设计 | 测试方案 |
| **compat** | 兼容策略设计（Breaking Change 时） | 兼容方案 |
| **release** | 发布策略审定 | 发布计划 |
| **architect** | 方案审定，任务拆解 | 任务拆解清单 |

> **同行评审（LLM Panel）**：技术设计文档 + 任务拆解清单完成后，orchestrator 组织正式同行评审。通过 opencode CLI 并行调用 7 方 LLM 评估。评审维度：架构合理性、接口契约完整性、测试策略覆盖度、发布风险。共识规则：≥5/7 一致同意则通过；有反对意见则退回修改，直至无反对意见。评审记录归档到 `.octopus/review/<issue-id>-p5.md`。

**工作产品**

| 产出物 | 格式 | 存储 |
|--------|------|------|
| 技术设计文档 | Markdown | `.octopus/design/<issue-id>.md` |
| 任务拆解清单 | GitHub Tasks | GitHub Issue |
| 测试策略 | Section in 设计文档 | 同上 |
| Name Policy Table | Table（仅重构/迁移类） | 设计文档内 |
| 发布策略 | Section in 设计文档 | 同上 |

**Checklist**
- [ ] 设计符合 AGENTS.md + Effect rules
- [ ] 接口契约明确（输入/输出/错误处理、Schema 定义）
- [ ] 数据库变更含 Drizzle Migration 计划（`bun run db generate --name <slug>`）
- [ ] Breaking Change 标注 + 兼容方案（compat Agent 已参与）
- [ ] XL 任务拆解为多个 ≤L 的子 Phase
- [ ] 子任务满足 INVEST 原则
- [ ] 每个子任务有唯一负责人和验收标准
- [ ] 测试策略获得 QA Agent 批准

---

### P6: 编码与单元测试（所有级别）

| 角色 | 职责 | 工作产品 |
|------|------|----------|
| **core-dev** | 核心代码实现 + Effect 服务 | 源代码、测试 |
| **feature-dev** | UI/扩展/文档/i18n 实现 | 源代码、测试、文档 |
| **platform** | CI/workflow/script/Docker/Nix 变更 | 配置变更 |
| **security** | 安全审计 + bundle size 检查 | 审计报告 |
| **compat** | 环境变量双轨 / 配置迁移 / CLI alias | 兼容代码 |

**工作产品**

| 产出物 | 格式 | 存储 |
|--------|------|------|
| 源代码 | TypeScript | `packages/*/` |
| 单元测试 | bun test | `packages/*/test/` |
| 数据库迁移 | Drizzle SQL | `packages/octopus/migration/` |
| Commit | Git | Conventional Commits |
| 自动化替换脚本 | TypeScript | `script/`（重构类任务） |

**自检门（所有 Agent 提交前必须通过）**
- [ ] `oxlint` 零错误
- [ ] `tsgo --noEmit` 零错误
- [ ] `bun test` 全通过（从包目录运行）
- [ ] `prettier --check .` 无差异

**代码规范 Checklist**
- [ ] 符合 AGENTS.md 风格指南（无 `any`、无 `try/catch`、使用 `const`）
- [ ] Effect 代码遵循 Effect rules（`Effect.gen` / `Effect.fn` / `Schema.TaggedErrorClass`）
- [ ] Drizzle schema 字段使用 snake_case
- [ ] Commit 遵循 Conventional Commits：`<type>(<scope>): <subject>`
  - type: `feat` / `fix` / `refactor` / `chore` / `test` / `docs`
  - scope: 影响的包名（`core`、`tui`、`sdk`、`desktop`、`app` 等）

**安全门**
- [ ] `bun audit` 通过
- [ ] bundle size 无异常增长
- [ ] CI Secrets 变更使用双轨制（新增→过渡→删除旧）

---

### P7: 集成与 E2E 测试（所有级别）

| 角色 | 职责 | 工作产品 |
|------|------|----------|
| **qa** | 集成测试、E2E、HttpApi、冒烟、质量门执行 | 测试报告 |
| **core-dev** | Code Review（核心代码部分） | Review 意见 |
| **feature-dev** | Code Review（展示层部分） | Review 意见 |
| **platform** | Code Review（CI/构建部分） | Review 意见 |
| **security** | Secrets 双轨验证 | 安全验证报告 |
| **compat** | 兼容性验证 | 兼容验证报告 |
| **architect** | 技术 PR 审批 | Merge 批准 |

**工作产品**

| 产出物 | 格式 | 存储 |
|--------|------|------|
| CI 测试报告 | JUnit XML | `.artifacts/unit/junit.xml` |
| E2E 测试报告 | JUnit XML | CI Artifacts |
| HttpApi 测试报告 | Console | CI Logs |
| 冒烟测试报告 | PR Comment | GitHub |
| Code Review 意见 | PR Review Comments | GitHub |

**质量门（按变更级别分级触发）**

| 层级 | 检查项 | XS/S | M | L/XL |
|------|--------|:---:|:---:|:---:|
| 静态层 | typecheck（受影响包） | ✓ | — | — |
| 静态层 | typecheck（全量） | — | ✓ | ✓ |
| 静态层 | oxlint | ✓ | ✓ | ✓ |
| 静态层 | prettier | ✓ | ✓ | ✓ |
| 构建层 | 全量 build | — | ✓ | ✓ |
| 构建层 | npm pack | — | ✓ | ✓ |
| 运行时 | bun turbo test:ci（受影响） | ✓ | — | — |
| 运行时 | bun turbo test:ci（全量） | — | ✓ | ✓ |
| 运行时 | HttpApi test | — | ✓ | ✓ |
| 运行时 | Playwright E2E | — | — | ✓ |
| 运行时 | CLI smoke | — | ✓ | ✓ |
| 运行时 | SDK smoke | — | — | ✓ |
| 安全 | bun audit | ✓ | ✓ | ✓ |
| 安全 | bundle size | — | — | ✓ |

**PR 分级审批**

| 类型 | 审批要求 | 示例 |
|------|----------|------|
| `chore:` / `docs:` | 1 人 | 文档修正 |
| `fix:` | 1 人（含 orchestrator 或 architect 任一） | bug 修复 |
| `feat:` / `refactor:` | 1 人（必须 architect） | 新功能、重构 |
| `feat!:`（Breaking） | 2 人（architect + qa） | 破坏性变更 |

---

### P8: Canary 灰度发布（仅 L/XL 级）

| 角色 | 职责 | 工作产品 |
|------|------|----------|
| **release** | Canary 部署（灰度 10%/1h） | 部署记录 |
| **qa** | 核心功能冒烟 + 错误率监控 | Canary 监控报告 |
| **security** | Canary 安全扫描 | 安全扫描报告 |
| **qa** (A) | **Go/No-Go 决策（质量否决权）** | Go/No-Go 判定 |
| **orchestrator** (A) | 最终审批 | 发布绿灯 |

**准入条件 Checklist**
- [ ] 核心功能冒烟通过（CLI 启动、SDK 导入、API 连通）
- [ ] 错误率 < 基线 × 1.2
- [ ] 无新 P0 安全漏洞
- [ ] 灰度 1h 内无异常

**否决 → 回滚路径**：QA → Release Agent → `git revert` → Hotfix 发布

---

### P9: 版本发布

| 角色 | 职责 | 工作产品 |
|------|------|----------|
| **orchestrator** | CHANGELOG 审核 | 审核意见 |
| **compat** | MIGRATION.md 编写（Breaking Change） | MIGRATION.md |
| **release** | 版本号/Tag/构建/npm/AUR/Homebrew/Docker 发布 | 发布产物 |
| **platform** | CI 发布管线支持 | 发布流水线 |
| **qa** | 发布后 24h 监控 | 监控报告 |

**工作产品**

| 产出物 | 格式 | 存储 |
|--------|------|------|
| 版本标签 | Git Tag | `vX.Y.Z` |
| CHANGELOG | CHANGELOG.md | 根目录 |
| 迁移指南 | MIGRATION.md | 根目录（如有 Breaking Change） |
| Release Notes | GitHub Release | GitHub |
| npm 包 | npm Registry | npm |

**Checklist**
- [ ] 全量 `bun turbo typecheck` 通过
- [ ] 全量 `bun turbo test:ci` 通过
- [ ] HttpApi 测试全绿
- [ ] CHANGELOG.md 已更新并人工审核
- [ ] 如有 Breaking Change：MIGRATION.md 已编写
- [ ] npm 发布成功
- [ ] 构建产物可执行（至少验证 Linux）
- [ ] 版本号符合语义化版本规范

---

### P9 Hotfix: Hotfix 发布

> Hotfix 是 P9 的子路径：P1→P6→P9，跳过 P2-P8。

| 角色 | 职责 | 工作产品 |
|------|------|----------|
| core-dev 或 feature-dev | 紧急修复编码（P1→P6 fast-path） | Hotfix 代码 |
| **release** | Hotfix 发布 / 回滚（如需） | Hotfix 版本 |

**Checklist**
- [ ] 修复经过自检门（oxlint/typecheck/test）
- [ ] Hotfix Tag 格式：`hotfix/vX.Y.Z`
- [ ] 已通知 architect

---

### P10: 复盘（P0/P1 问题触发）

| 角色 | 职责 | 工作产品 |
|------|------|----------|
| **release** | RCA 编写（5 Whys + 时间线） | RCA 报告 |
| **orchestrator** | 改进措施审定 → 转化 Issue | 改进 Issue |

**工作产品**

| 产出物 | 格式 | 存储 |
|--------|------|------|
| 复盘报告 | Markdown | `.octopus/postmortem/<date>-<slug>.md` |

**RCA 模板**
```
# 复盘: <简述>
## 时间线（发现/定位/修复时间）
## 根因（5 Whys）
## 影响范围
## 改进措施
## 责任人
```

---

## 四、Git 约定

> 核心目标：**每个 Phase 的变更隔离到最小爆炸半径，回滚代价最小化。**

### 4.1 工作产品与 Git 关系

| 分类 | 产物 | 提交？ | 存储路径 |
|------|------|:---:|------|
| 持久归档 | Discovery / 版本计划 / 研究 / 设计 / 评审 / 复盘 | ✓ | `.octopus/*.md` |
| 临时快照 | Agent 上下文暂存 | ✗ | `.octopus/context/` |
| CI 产物 | 测试报告 / Canary 监控 / bundle size | ✗ | `.artifacts/` |

**`.gitignore` 条目**：
```
.octopus/context/
.artifacts/
```

### 4.2 分支策略与 Phase 映射

```
main ───────────────────────────────────────── ● tag vX.Y.Z ───
                                               │
dev  ──●──●──●──●────────────────────●─────────●────●──
       │  │  │  │                    │         │    │
       │  │  │  │  feature/<id> ──●──┘         │    │
       │  │  │  │     (P6 code)   squash       │    │
       │  │  │  │                              │    │
       │  │  │  │           release/vX.Y.Z ──●─┘    │
       │  │  │  │              (P8 canary)    tag    │
       │  │  │  │                                   │
       │  │  │  │  hotfix/vX.Y.Z ───────────────────●──→ backmerge to dev
       │  │  │  │     (P9 hotfix)
       │  │  │  │
  P0 doc  P2 doc  P3 doc  P5 doc  P10 doc
```

| Phase | 分支 | 产物 | 提交方式 | 回滚代价 | 回滚方式 |
|-------|------|------|---------|:---:|------|
| P0 | `dev` | Discovery 文档 | `docs(discovery): <slug>` | **零** | 编辑/覆盖文档 |
| P1 | — (GitHub) | Issue 标签 + 分派 | — | **零** | 重新标记 |
| P2 | `dev` | 版本计划 | `docs(plan): vX.Y.Z` | **零** | 编辑文档 |
| P3 | `dev` | 研究/分析报告 | `docs(research): <issue-id>` | **零** | 编辑文档 |
| P4 | `dev` | 评审记录 | `docs(review): <issue-id>-p4` | **零** | 编辑文档 |
| P5 | `dev` | 设计文档 | `docs(design): <issue-id>` | **零** | 编辑文档 |
| P6 | `feature/<issue-id>` | 源代码 + 测试 | 常规 commit → PR | **低** | 关闭 PR，删除分支 |
| P7 | PR → `dev` | Merge | squash merge | **中** | `git revert -m1 <merge-sha>` |
| P8 | `release/vX.Y.Z` | Canary 部署 | cherry-pick / merge | **低** | `git revert` on release branch 或放弃分支 |
| P9 | `release/vX.Y.Z` → `main` | Tag + 发布 | tag → merge to main | **高** | Hotfix 发布（见 P9 Hotfix） |
| P10 | `dev` | 复盘报告 | `docs(postmortem): <date>-<slug>` | **零** | 编辑文档 |

### 4.3 回滚路径详解

**P0-P5 文档回滚**（代价零）
- 文档 markdown 直接编辑或 `git revert` 即可，无代码耦合

**P6 编码回滚**（代价低）
- 代码仅在 `feature/<issue-id>` 分支上
- 未 merge → 关闭 PR，删除分支，零影响
- 已 merge（P7 后）→ `git revert -m1 <merge-sha>` 在 dev 上

**P8 Canary 回滚**（代价低，关键设计）
- Canary 在专用 `release/vX.Y.Z` 分支上运行，不在 dev 也不在 main
- 异常回滚路径：
  1. QA 否决 → Release agent `git revert` 在 release 分支上 → 重新部署 canary
  2. 严重问题 → 放弃 `release/vX.Y.Z` 分支，修复后从 dev 重新切
  3. `release/vX.Y.Z` 分支上的任何操作**不影响 dev 也不影响 main**
- 这就是 P8 作为 P9 前置门的意义：在独立分支上验证，最大程度隔离爆炸半径

**P9 Hotfix 回滚**（代价中）
- 代码在 `hotfix/vX.Y.Z` 分支上（从 `main` 最新 tag 切出）
- 回滚路径：`git revert` on main → 新 hotfix tag → backmerge 到 dev
- 比常规 P9 回滚（代价高）轻，因为 hotfix 变更小

**P9 正式发布回滚**（代价高）
- 已打 tag 并发布到 npm/registry
- 回滚路径：P9 Hotfix 流程（发布新版本或回滚版本号）
- 不可逆操作：npm unpublish 受限、用户已下载旧版本
- **因此 P8 Canary 必须严格执行**，确保 P9 不回滚

### 4.4 Commit 规范

| 产物类型 | Prefix | 示例 |
|---------|--------|------|
| Discovery 文档 | `docs(discovery):` | `docs(discovery): add dark mode exploration` |
| 版本计划 | `docs(plan):` | `docs(plan): v1.5.0 scope and ordering` |
| 研究/分析 | `docs(research):` | `docs(research): #42 core impact analysis` |
| 评审记录 | `docs(review):` | `docs(review): #42-p4 LLM panel verdict` |
| 设计文档 | `docs(design):` | `docs(design): #42 dark mode architecture` |
| 复盘报告 | `docs(postmortem):` | `docs(postmortem): 2026-05-11-ci-outage` |
| 源代码（P6） | 常规 Conventional Commits | `feat(core): add dark mode service` |
| Merge（P7） | squash merge 保留 PR 标题 | `feat(core): add dark mode support (#42)` |

### 4.5 分阶段 Commit 时机

| Phase | 何时 Commit | 谁 Commit |
|-------|-----------|----------|
| P0 | Discovery 文档完成后立即提交 | **analyst** |
| P2 | 版本计划通过 LLM Panel 后提交 | **orchestrator** |
| P3 | 各 Agent 分析完成、需求报告汇总后 | **orchestrator** |
| P4 | 评审结束后，记录归档 | **orchestrator** |
| P5 | 设计文档 + 任务拆解通过 LLM Panel 后 | **orchestrator** |
| P6 | 每完成一个独立变更单元 commit；全完成后 PR | domain agent |
| P7 | 质量门通过后 squash merge | **orchestrator**（审批 merge） |
| P8 | Canary 每轮部署 commit 部署配置 | **release** |
| P9 | Tag 打标 + CHANGELOG commit | **release** |
| P10 | RCA 复盘完成后 | **release** |

---

## 五、LLM Panel 同行评审机制

### 5.1 方法

通过 opencode CLI 并行调用 7 方 LLM 对工作产品进行独立评估。

**评审模型**：Claude Opus 4.7、GPT-5.5、Gemini 3.1 Pro、DeepSeek V4 Pro、Qwen 3.6 Plus、Kimi K2.6、GLM 5.1

**执行方式**：
```bash
opencode run -m <model> --format json "$review_prompt" 2>/dev/null
```

### 5.2 共识规则

| 一致度 | 决策 | 典型情况 |
|--------|------|---------|
| ≥5/7 一致 | **强制采纳** | 所有评审指出同一缺陷，必须修正 |
| 4/7 一致 | **默认采纳**，architect 可覆写 | 多数评审意见，architect 有否决权 |
| <4/7 一致 | **architect 裁定** | 分歧较大，architect 根据上下文做最终决策 |

### 5.3 评审维度矩阵

| Phase | 评审对象 | 评审维度 | 通过阈值 | 归档路径 |
|-------|---------|---------|---------|---------|
| P2 | 版本计划 | 范围合理性、排序正确性、冲突检测完整性、Fast-track 判定准确性、风险识别完整度 | ≥5/7 | `.octopus/review/vX.Y-version-plan.md` |
| P4 | 需求分析报告 | 需求完整性、技术可行性准确度、验收标准可测试性、工作量合理性 | ≥4/7 | `.octopus/review/<issue-id>-p4.md` |
| P5 | 技术设计 + 任务拆解 | 架构合理性、接口契约完整、测试覆盖、发布风险 | ≥5/7 | `.octopus/review/<issue-id>-p5.md` |

### 5.4 迭代规则

- 第一轮评审后，若有 ≥4/7 批评意见，修正后发起第二轮
- 第二轮评审后，若仍有 ≥4/7 新意见，修正后发起第三轮
- 第三轮后仍有分歧 → architect 裁定，记录分歧理由
- 每轮评审报告与修正记录一起归档

---

## 六、Skill 分配

```
.opencode/skills/<name>/SKILL.md   ← skill tool 按需加载
```

| Skill | Agent | 关键知识 |
|-------|-------|---------|
| `workflow` | orchestrator | 变更分级表、Phase 门控、PR 审批规则 |
| `discovery` | analyst | 需求澄清方法、查重规则、Issue 拆解原则 |
| `effect` | core-dev, feature-dev | Effect.gen/fn/Schema/TaggedErrorClass |
| `monorepo` | platform, core-dev | turbo 任务图、catalog、workspace:* |
| `ci-cd` | platform | GHA、Secrets 双轨 |
| `automation` | core-dev | sed/rg 批处理、git mv、依赖重建 |
| `typescript` | core-dev | no any、no try-catch、no destructure、自导出模式 |
| `drizzle` | core-dev | snake_case、migration generate、per-folder test |
| `i18n` | feature-dev | 4 目录 i18n、flat vs nested key、612 MDX、glossary |
| `testing` | qa, feature-dev | bun test、Playwright、HttpApi exerciser |
| `security` | security | bun audit、bundle size 基线、Secrets 双轨 |
| `release` | release | 发布路径、回滚 SOP |
| `peer-review` | orchestrator | 7方LLM并行评审、共识规则、迭代归档 |
| `code-review` | architect, core-dev, feature-dev, platform | 按变更类型分级的 review checklist |
| `llm` | core-dev, platform | provider 集成、streaming、token 管理、prompt 策略 |
| `observability` | platform, core-dev | 结构化日志、Canary 监控指标、会话回放 |
| `cli` | feature-dev, core-dev | 终端兼容性、PTY 管理、信号处理、进度显示 |

---

## 七、opencode 配置结构

```
.opencode/
├── agents/                ← 10 Agent markdown 定义（2 primary + 8 subagent）
│   ├── analyst.md         ← 用户第一个入口（P0 Discovery）
│   ├── orchestrator.md    ← 用户第二个入口（P1-P10 流程编排）
│   ├── architect.md       ← `@architect`
│   ├── platform.md        ← `@platform`
│   ├── core-dev.md        ← `@core-dev`
│   ├── feature-dev.md     ← `@feature-dev`
│   ├── qa.md              ← `@qa`
│   ├── security.md        ← `@security`
│   ├── compat.md          ← `@compat`
│   ├── release.md         ← `@release`
│   ├── triage.md          ← 保留（Bot）
│   └── duplicate-pr.md    ← 保留（Bot）
├── commands/              ← 14 命令
│   ├── discover.md        ← /discover（analyst 入口）
│   ├── plan.md            ← /plan
│   ├── review.md          ← /review
│   ├── peer-review.md     ← /peer-review
│   ├── canary.md          ← /canary
│   ├── release.md         ← /release
│   └── (ai-deps,changelog,commit,issues,learn,rmslop,spellcheck,translate)
├── skills/                ← 17 技能
│   ├── discovery/SKILL.md
│   ├── workflow/SKILL.md
│   ├── effect/SKILL.md
│   ├── code-review/SKILL.md ← 新增
│   ├── llm/SKILL.md        ← 新增
│   ├── observability/SKILL.md ← 新增
│   ├── cli/SKILL.md        ← 新增
│   └── (monorepo, ci-cd, automation, typescript, drizzle, i18n, testing, security, release)
├── opencode.jsonc
├── tool/ glossary/ plugins/ themes/ tui.json package.json (保留)
```

---

## 八、Phase 门控速查

| Phase | 分支 | 进入条件 | 退出标准 | 评审 |
|-------|------|---------|---------|------|
| P0 | `dev` | 用户提出原始 idea | Discovery 文档 + Issue 草稿完成 | — |
| P1 | — (GitHub) | P0 Issue 草稿 | 变更级别已判定 + Agent 已分派 + 无同文件冲突 | Bots 自动 |
| P2 | `dev` | P1 分级完成 / 上一版本 P7 期间 | 版本计划通过（≥5/7） | LLM Panel |
| P3 | `dev` | P2 通过 | 需求分析报告完成（M+: ≥2 Agent 分析） | — |
| P4 | `dev` | P3 完成 | M+: LLM Panel ≥4/7 Go | LLM Panel |
| P5 | `dev` | P4 Go（仅 M+） | 技术设计+任务拆解通过（≥5/7） | LLM Panel |
| P6 | `feature/<id>` | 任务已分配 | 自检门全绿 + PR | 分级审批 |
| P7 | PR → `dev` | P6 PR ready | 质量门通过 + squash merge | CI + QA |
| P8 | `release/vX.Y.Z` | L/XL 质量门通过 | Canary 1h 无异常 | QA 否决 |
| P9 | `release/vX.Y.Z` → `main` | Canary 通过 / P7 通过 (XS/S/M) | 发布成功 + 24h OK | Release |
| P10 | `dev` | P0/P1 问题触发 | RCA + 改进 Issue | Release→architect |
| Hotfix | `hotfix/vX.Y.Z` | 紧急修复 | merge to main + backmerge to dev | Release |

---

## 九、合理性自检

| 维度 | 评估 |
|------|------|
| **上下文内聚** | 10 agent 各 ≤200 文件 |
| **Phase 覆盖** | 每 Phase 有明确 R/A，工作产品和 Checklist——无空白 |
| **模型匹配** | 4×DeepSeek V4 Pro（高推理: analyst/architect/core-dev/release）+ 6×DeepSeek V4 Flash（高性价比: orchestrator/platform/feature-dev/qa/security/compat） |
| **升级路径** | QA→architect(质量否决)，Compat→architect(争议)，Release→architect(失败) |
| **与 opencode 兼容** | 2 primary + 8 subagent + 2 hidden bot |
| **Git 隔离** | 文档在 dev（零回滚成本），代码在 feature（低回滚成本），canary 在 release（独立分支隔离），hotfix 在 hotfix（从 main 切出） |

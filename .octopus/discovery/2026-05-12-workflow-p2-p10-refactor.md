# Discovery: P2/P9/P10 工作流重构

## 问题陈述

当前工作流存在两个结构性问题：

**问题 A**：P2「版本计划」过早承诺版本号。P2 在 Issue 完成需求分析（P3）和方案设计（P5）之前就锁定了版本号 `vX.Y.Z` 和发布范围。实际执行中经常出现 P3 分析后范围爆炸、P4 评审退回，导致版本计划名存实亡。

**问题 B**：P10「复盘」仅在出现事故时触发，丢失了迭代回顾的价值。复盘应当成为持续改进引擎——不仅在事故后做 RCA，更应在每次发布后系统性审计流程/Agent/知识体系，驱动效率和质量的不断提升。

## 用户原始表达

1. "通过版本计划启动一轮迭代时，却未必会走到发布阶段，版本计划这个概念在流程中的卡位不合适"
2. "可以在完成一个或多个迭代开发之后才决定是否发布版本，而不是在迭代开发之前就做决定"
3. "通过复盘优化开发流程（角色职责、checklist、工作产品模板等）和 Agents 体系配置（tools、skill 等）"
4. "实现开发效率和质量的不断提升"

## 迭代澄清记录

| 轮次 | 问题 | 回答 |
|------|------|------|
| 1 | 版本计划卡位不合适的原因？ | P2 同时承担"工作规划"和"版本承诺"，后者应后移 |
| 2 | 同意 P2→P9 重构方向？ | 同意：P2 改为迭代计划，P9 增加发布决策，Phase 编码不变 |
| 3 | P10 复盘的目的？ | 优化流程 + Agent 体系，不只是事故 RCA |
| 4 | 方案是否组织 Brainstorm？ | 是，7 方 LLM Panel Brainstorm 已完成 |
| 5 | 是否接受激进方案？ | 拒绝（不稳定/抖动），采用标准方案 |
| 6 | 产出顺序？ | 先写 Discovery → 同行评审通过 → 再拆 Issue |

## 根本需求（5 Whys）

1. **表层需求**: P2 太早定版本号，P10 复盘太窄
2. **Why**: 版本号提前锁定 → 计划与实际偏差大 → 计划失去权威性
3. **Why**: P2/P9 职责边界不清——P2 做了发布决策的活，P9 没有决策能力
4. **Why**: P10 只是"救火"没做"体检"，流程/Agent 问题没有被系统化审计
5. **根本原因**: 三个 Phase 的职责分配有问题——**决策前置（P2）、执行缺位（P9）、反思缺位（P10）**

修复方向：**P2 只计划不管发、P9 先决策后执行、P10 系统性持续改进**

## 查重结果

| 来源 | 结果 | 判定 |
|------|------|------|
| `.octopus/discovery/` | 3 个已有文档（迁移/品牌/视觉），均不涉及工作流重构 | 无重复 |
| `CHANGELOG.md` | v0.1.0–v0.3.0，无类似工作流变更 | 无重复 |
| `.octopus/version-plans/` | v0.1.0–v0.3.0 版本计划，不涉及流程变更 | 无重复 |
| GitHub Issues | 无网络访问 | 跳过 |

**重复判定**: ☑ 全新需求

## 影响范围初判

### 核心文件

| 文件 | 当前行数 | 变更描述 | 预估改动 |
|------|:---:|------|:---:|
| `.octopus/WORKFLOW.md` | ~940 | P2/P9/P10 章节重写 + 门控表 + Git 约定 | ~200 行 |
| `.opencode/skills/workflow/SKILL.md` | ~90 | P2/P9/P10 描述同步更新 | ~30 行 |

### Agent 定义

| 文件 | 当前行数 | 变更描述 |
|------|:---:|------|
| `.opencode/agents/orchestrator.md` | ~75 | P2 迭代计划 + P9 发布决策 + P10 汇总职责 |
| `.opencode/agents/architect.md` | ~30 | 新增 P10 层2/层6 owner |
| `.opencode/agents/analyst.md` | ~70 | 新增 P10 层3/层7 owner |
| `.opencode/agents/feature-dev.md` | ~35 | 新增 P10 层4 owner |
| `.opencode/agents/platform.md` | ~25 | 新增 P10 层5 owner |
| `.opencode/agents/release.md` | ~30 | P10 汇总关闭职责更新 |

### 目录与模板

| 路径 | 操作 | 预估文件数 |
|------|------|:---:|
| `.octopus/version-plans/` → `.octopus/iteration-plans/` | 重命名目录 + 迁移 3 文件 | 3 |
| 新 `.octopus/iteration-plans/` 模板 | 新建 P2 迭代计划模板（去版本号） | 1 |
| 新 `.octopus/postmortem/` 模板 | 新建 P10 复盘模板（7 层） | 1 |
| 新 `.octopus/metrics/` | 新建指标目录 + schema | 1 |

### 不处理

| 类别 | 原因 |
|------|------|
| CI/构建脚本 | 指标采集暂不做（先定义 schema，采集脚本后续 Issue） |
| CHANGELOG 生成逻辑 | 不在此次范围 |

## 方案空间

### 方案矩阵

| 维度 | 保守 | **标准** ✓ | 激进 |
|------|------|:---:|------|
| P2 处理 | 仅改名为"迭代计划" | 改名 + 去版本号 + 版本号后移到 P9 | 删除 P2，合并到 P1 |
| P9 处理 | 不改 | 增"发布决策"子步骤 + 发布前自问 | P9 拆为 P9a/P9b 两个 Phase |
| P10 触发 | 仅事故（现状） | 信号驱动选择深度 | 每次发布全量复盘 |
| P10 范围 | 流程 + Agent（2层） | 7 层（+行为健康 +知识熵） | 7 层 + AI 自动改系统 |
| P10 产出 | 复盘报告 + Issue | 指标 + 报告 + Issue + 改进 PR | AI 自动生成修复 PR |

### Brainstorm 结论（7 方 LLM Panel，7/7 通过）

- 新增维度 #6「Agent 行为健康」：审查者注意力衰减、协作摩擦、上下文丢失
- 新增维度 #7「知识/系统熵」：文档腐烂、工具遗忘、静默指标、单点知识风险
- 产出升级：在 Issue 之外增加"改进 PR"（Skill/模板/Checklist 的人工审批修改）
- 前置预判（轻量版）：P9 发布前 30 秒自问 3 题，不做 AI 预测
- 拒绝激进方案：自动改系统、影子 Agent、混沌注入 → 不稳定/抖动

### 选定方案：标准方案

```
P0 Discovery → P1 Issue分流 → P2 迭代计划 → P3 需求分析 → P4 需求评审
                                                              ↓
                         P5 方案设计 → P6 编码 → P7 集成测试 → P8 Canary
                                                              ↓
                                              P9 发布（决策 + 执行）→ P10 复盘
```

## Issue 拆解（草稿，评审通过后定稿）

### 依赖拓扑

```
Issue 1 (WORKFLOW.md 重构)
  ├── Issue 2 (Agent 定义更新)
  ├── Issue 3 (P2 模板 + 目录迁移)
  ├── Issue 4 (P10 模板 + 指标 schema)
  └── Issue 5 (现有产物迁移)  ← 依赖 Issue 3（需要 iteration-plans/ 目录就绪）
```

### Issue 列表

| # | Issue 标题 | 预估文件数 | 级别 | 依赖 | 可并行 |
|:--:|-----------|:---:|:---:|------|:---:|
| 1 | **WORKFLOW.md + workflow skill 重构** | 2 | S | — | — |
| 2 | **Agent 定义更新** (6 个 agent) | 6 | S | Issue 1 | #3, #4, #5 |
| 3 | **P2 迭代计划模板 + 目录迁移** | 4 | XS | Issue 1 | #2, #4, #5 |
| 4 | **P10 复盘模板 + 指标 schema** | 2 | XS | Issue 1 | #2, #3, #5 |
| 5 | **现有 version-plans 迁移** | 3+ | XS | Issue 3 | #2, #4 |

### Issue 1: WORKFLOW.md + workflow skill 重构 [S]

**描述**: 重写 P2/P9/P10 章节，同步更新门控表、Git 约定、变更分级表。同时更新 `.opencode/skills/workflow/SKILL.md`。

**WORKFLOW.md 变更点**:
- §P2 (行 300-389): "版本计划" → "迭代计划"，去版本号，保留冲突检测/排序/WIP，存址改为 `.octopus/iteration-plans/<date>-<slug>.md`
- §P9 (行 612-642): 增加"发布决策"子步骤（审视 dev 合并范围 → 定版本号 → P9 自问）+"发布执行"
- §P10 (行 662-684): 完全重写为 7 层信号驱动复盘 + 前置预判（发布前自问）
- §二 变更分级表 (行 217-225): 确认无变更
- §八 Phase 门控速查 (行 912-927): P9 进入条件 + P10 条件更新
- §四 Git 约定 (行 688-801): P2 文档前缀 `docs(plan):` 不变，目录名更新

**workflow skill 变更点**:
- Phase 总览图中 P2/P9/P10 描述同步
- P2 去重规则微调

**验收标准**:
- [ ] P2 标题为"迭代计划制定"，全文无"版本计划"提及（除历史说明）
- [ ] P2 不再出现版本号 `vX.Y.Z`
- [ ] P9 包含"发布决策"和"发布执行"两个子步骤
- [ ] P9 包含"发布前自问"3 题
- [ ] P10 包含 7 层维度表 + 信号触发规则 + 指标基线说明
- [ ] P10 产出包含"指标 + 报告（按需）+ Issue + 改进 PR"
- [ ] 门控表 P9/P10 行正确

### Issue 2: Agent 定义更新 [S]

**描述**: 更新 6 个 Agent markdown 文件中的 P10 职责。

**各 Agent 变更**:

| Agent | 新增职责 |
|-------|---------|
| orchestrator | P2 迭代计划（去版本号）；P9 发布决策（审视+定版号+自问）；P10 汇总各层 owner 报告 |
| architect | P10 层2（Agent 体系）+ 层6（Agent 行为健康）owner |
| analyst | P10 层3（信息知识）+ 层7（知识/系统熵）owner |
| feature-dev | P10 层4（对外影响）owner |
| platform | P10 层5（经济性）owner |
| release | P10 汇总关闭（从各 owner 收片段+输出报告） |

**验收标准**:
- [ ] 6 个 Agent 文件的 Phase 职责表包含正确的 P10 条目
- [ ] orchestrator 的 P2 职责描述不含"版本"二字
- [ ] orchestrator 的 P9 职责包含"发布决策"

### Issue 3: P2 迭代计划模板 + 目录迁移 [XS]

**描述**: 创建新的 P2 迭代计划模板（不含版本号），将现有 `version-plans/` 目录重命名为 `iteration-plans/`，迁移 3 个已有文件。

**模板要点**（`templates/iteration-plan-template.md`）:
- 标题: `# 迭代计划: <主题>`（不带 vX.Y.Z）
- 保留: 去重说明 + 冲突检测 + 排序 + WIP
- 移除: 版本号字段 / `实际发布` 字段 / 里程碑编号
- 新增: 迭代主题 + 预计迭代数

**验收标准**:
- [ ] `.octopus/iteration-plans/` 目录存在，含 v0.1.0/v0.2.0/v0.3.0 三个文件
- [ ] `.octopus/version-plans/` 目录已删除
- [ ] `templates/iteration-plan-template.md` 不含 `vX.Y.Z` 模式
- [ ] 项目内所有 `version-plans` 路径引用已更新（WORKFLOW.md、skill 文件等）

### Issue 4: P10 复盘模板 + 指标 schema [XS]

**描述**: 创建新的 P10 复盘模板（7 层体系），定义指标数据 schema。

**模板要点**（`templates/postmortem-template.md`）:
- 标题: `# P10 复盘: vX.Y.Z`
- 章节: 发布前自问结果 → 信号清单 → 触发层 → 各层分析 → 改进措施 → 上一版闭环追踪
- 保留: 时间线 / 做得好的 / 可改进的 / 改进措施表格
- 新增: 7 层维度清单 / 信号触发日志 / 改进闭环率

**指标 schema**（`.octopus/metrics/schema.json`）:
```json
{
  "version": "vX.Y.Z",
  "timestamp": "ISO8601",
  "signals": {
    "review_rounds": {"p2": 1, "p4": 1, "p5": 1},
    "hotfix_or_rollback": false,
    "scope_deviation_pct": 0,
    "token_delta_pct": 0,
    "ci_time_delta_pct": 0,
    "agent_queue_max_m_plus": 0,
    "layer6_review_uptick": false,
    "layer7_tool_zero_usage": [],
    "layer7_skill_stale_versions": 0
  },
  "baseline": {
    "wall_clock_p0_to_p9": "minutes",
    "total_files_changed": 0,
    "total_issues": 0,
    "llm_panel_calls": 0,
    "agent_context_switches": 0
  }
}
```

**验收标准**:
- [ ] `templates/postmortem-template.md` 包含完整 7 层维度章节
- [ ] 模板包含信号触发日志章节
- [ ] `.octopus/metrics/schema.json` 存在且格式有效

### Issue 5: 现有 version-plans 迁移 [XS]

**描述**: 将 `.octopus/version-plans/` 下 3 个文件迁移到 `.octopus/iteration-plans/`，更新内部标题和引用。全局搜索并替换 `version-plans` 路径引用。

**范围**:
- `.octopus/version-plans/v0.1.0.md` → `.octopus/iteration-plans/v0.1.0.md`
- `.octopus/version-plans/v0.2.0.md` → `.octopus/iteration-plans/v0.2.0.md`
- `.octopus/version-plans/v0.3.0.md` → `.octopus/iteration-plans/v0.3.0.md`
- 全局路径引用更新: `version-plans` → `iteration-plans`

**验收标准**:
- [ ] `rg 'version-plans' .octopus/ .opencode/` 零结果
- [ ] 3 个迁移文件可正常访问
- [ ] 迁移后 Git 历史保留（`git mv`）

## 建议的变更级别

**M** — 总体涉及 ~20 文件。拆为 5 个 Issue（1×S + 1×S + 1×XS + 1×XS + 1×XS），最大单个 Issue 6 文件。5 个 Issue 之间有依赖链（1→2,3,4→5），但 Issue 2/3/4 可完全并行。

## 同行评审

| 模型 | 维1 | 维2 | 维3 | 总评 |
|------|:---:|:---:|:---:|:---:|
| Claude Opus 4.7 | Go | Go | Go | Go |
| GPT 5.5 | Go | Go | Go | Go |
| Gemini 3.1 Pro | Go | Go | Go | Go |
| DeepSeek V4 Pro | Go | NoGo | Go | NoGo |
| QWen 3.6 Plus | Go | Go | Go | Go |
| Kimi K2.6 | Go | Go | Go | Go |
| MiniMax M2.7 | Go | NoGo | Go | NoGo |

**共识: 5/7 Go ≥5/7 → 通过**

NoGo 意见及修正:
- DeepSeek: 依赖拓扑 ASCII 图与表格不一致 → 已修正 ASCII 图
- MiniMax: Issue5 应依赖 Issue3+Issue4 → 维持仅依赖 Issue3（Issue5 只搬文件不需要 P10 模板就绪），补充说明
- MiniMax: Issue2 (6 Agent 文件) 应为 M 级 → 维持 S 级（6 文件 < S 级上限 50）

## 决策

☑ 同行评审通过 → 拆解正式 Issue

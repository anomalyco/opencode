---
name: workflow
description: Octopus project E2E workflow - phase codes, change classification, gates, review rules
---

# Workflow

此 Skill 仅供 orchestrator Agent 使用。orchestrator 的所有决策都依赖对工作流的准确理解。

## Phase 总览

```
P0 Discovery (analyst) → P1 Issue创建&分流 → P2 迭代计划 → P3 需求分析 → P4 需求评审
                                                                            ↓ Go
                                                          P5 方案设计 → P6 编码 → P7 集成测试 → P8 Canary → P9 发布(决策+执行)
                                                                                                            ↓ 信号驱动
                                                                                                         P10 复盘
```

## 变更分级

| 级别   | 文件数  | P3 Agent 分派     | 流程路径                  |
| ------ | ------- | ----------------- | ------------------------- |
| XS     | <10     | orchestrator 独立 | P1→P3(快速)→P6→P7→P9      |
| S      | 10-50   | orchestrator 独立 | P1→P3(快速)→P6→P7→P9      |
| M      | 50-150  | ≥2 domain agent   | P1→P3→P4(LLM)→P5→P6→P7→P9 |
| L      | 150-500 | ≥2 domain agent   | +P8                       |
| XL     | >500    | ≥2 domain agent   | +P8+P10                   |
| Hotfix | <50     | —                 | P1→P6→P9                  |

## P3 Agent 分派规则

| Issue 领域      | 必须参与 Agent                 |
| --------------- | ------------------------------ |
| XS/S            | orchestrator 独立              |
| 核心代码        | orchestrator + **core-dev**    |
| UI/展示层       | orchestrator + **feature-dev** |
| CI/构建         | orchestrator + **platform**    |
| 安全相关        | orchestrator + **security**    |
| Breaking Change | 上述 + **compat**              |
| 验收标准        | **qa**（所有 M+）              |

> **关键**: orchestrator 自己不做分析——只分派 Agent + 汇总。需求质量由 P4 LLM Panel 评审保证。

## P2 去重规则

orchestrator 在 P2 收集候选 Issue 时必须执行去重：

1. 交叉比对所有候选 Issue 的影响范围（包/文件清单）
2. 语义级去重——不同 Issue 描述同一目标 → 合并为单个 Issue
3. 排除已在过往版本发布的 Issue（CHANGELOG 已包含）
4. 排除已有关联 PR 已 merge 的 Issue
5. 去重记录写入迭代计划 "去重说明" 章节

## Phase 门控

| Phase  | 分支                      | 进入条件                       | 退出标准                                     | 评审              |
| ------ | ------------------------- | ------------------------------ | -------------------------------------------- | ----------------- |
| P0     | `dev`                     | 用户提出原始 idea              | Discovery 文档 + Issue 草稿完成              | —                 |
| P1     | — (GitHub)                | P0 Issue 草稿                  | 变更级别已判定 + Agent 已分派 + 无同文件冲突 | Bots 自动         |
| P2     | `dev`                     | P1 分级完成 / 上一迭代 P7 期间 | 迭代计划通过（≥5/7）                         | LLM Panel         |
| P3     | `dev`                     | P2 通过                        | 需求分析报告完成（M+: ≥2 Agent 分析）        | —                 |
| P4     | `dev`                     | P3 完成                        | M+: LLM Panel ≥4/7 Go                        | LLM Panel         |
| P5     | `dev`                     | P4 Go（仅 M+）                 | 技术设计+任务拆解通过（≥5/7）                | LLM Panel         |
| P6     | `feature/<id>`            | 任务已分配                     | 自检门全绿 + PR                              | 分级审批          |
| P7     | PR → `dev`                | P6 PR ready                    | 质量门通过 + squash merge                    | CI + QA           |
| P8     | `release/vX.Y.Z`          | L/XL 质量门通过                | Canary 1h 无异常                             | QA 否决           |
| P9     | `release/vX.Y.Z` → `main` | Canary 通过 / P7 通过 (XS/S/M) | 发布成功 + 24h OK                            | Release           |
| P10    | `dev`                     | P9 发布完成                     | 指标基线 + 复盘报告(按需) + 改进 Issue       | Release→architect |
| Hotfix | `hotfix/vX.Y.Z`           | 紧急修复                       | merge to main + backmerge to dev             | Release           |

## PR 审批规则

| 类型            | 审批                   |
| --------------- | ---------------------- |
| chore/docs      | 1 人                   |
| fix             | 1 人（含 architect）   |
| feat/refactor   | 1 人（必须 architect） |
| feat!(Breaking) | 2 人（architect + qa） |

## 参考

`.octopus/WORKFLOW.md`

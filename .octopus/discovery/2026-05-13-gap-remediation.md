# Discovery: v0.1.0–v0.4.0 全量审计缺口修复

## 问题陈述

对 5 份 Discovery 文档（D1–D5）和 35 个已 Close Issue 做全量交叉审计，发现 3 类缺口：

- **类别 A**: Discovery 3（视觉形象）7 个 Issue 从未 P1 分流，部分工作已非正式完成但未闭环
- **类别 B**: 4 个已 Close Issue（#10/#15/#16/#33）实现不完整，残留未清
- **类别 C**: `packages/identity/mark.svg`（旧 OpenCode mark）未删除

## 审计来源

| 发现文档 | Issues | 审计时间 | 缺口数 |
|----------|:------:|----------|:------:|
| D1 品牌迁移 | 9 | 2026-05-13 | 0 |
| D2 代码清洗 | 3+ | 2026-05-13 | 1 |
| D3 视觉形象 | 7 | 2026-05-13 | 6 |
| D4 残留清理 | 6 | 2026-05-13 | 3 |
| D5 工作流重构 | 5 | 2026-05-13 | 0 |

## 查重结果

| 来源 | 结果 | 判定 |
|------|------|------|
| `.octopus/discovery/` | D3 已有完整 Issue 拆解但未 P1 | 本 doc 是 D3 的 P1 入口，不是重复 |
| CHANGELOG.md | 无类似修复记录 | 新需求 |
| GitHub Issues | #10/#15/#16/#33 已标记 CLOSED 但实现不完整 | 需重新打开或新建补充 Issue |

**重复判定**: ☑ 全新需求（审计驱动的缺口修复）

## 审计证据

关键发现（详见对话中的交叉核对）：

| 检查项 | 预期 | 实际 |
|--------|------|------|
| `logo.tsx` | 章鱼 mark | O-ring 几何方块 |
| CLI ASCII | "OCTOPUS" 或章鱼图案 | 拼写 "OPCODE" |
| README 数量 | 2（en + zh） | 22（20 个翻译未删） |
| i18n JSON | `opencode` 零残留 | 每文件 8 处 |
| GitHub Actions | `opencode` 仅模型 ID | 8 个 workflow 有品牌引用 |
| 测试文件 | `opencode` 零残留 | ~20 文件仍有 ~100 处 |
| 桌面图标/通道 | ~90 | 20 |
| Social share 图片 | 含章鱼 | 5/11 日期（VI 之前） |
| Brand kit (`/brand`) | 章鱼资产 | 28 个 opencode 文件 |
| `mark.svg` | 已删除 | 仍存在 |

## Issue 提纲

以下为 P1 Orchestrator 的输入，仅包含标题 + 价值 + 预估文件数。验收标准、依赖拓扑、并行策略、变更级别 → 由 Orchestrator 在 P1 制定。

### 类别 A: 视觉形象闭环（参考 D3）

| # | 标题 | 价值 | 预估文件 |
|:--|------|------|:--:|
| A1 | Web, UI & Favicon 章鱼集成 | 用户在所有 Web 触点看到章鱼而非 O-ring | ~25 |
| A2 | Console Brand Kit 迁移 | `/brand` 下载页提供章鱼品牌资产包 | ~40 |
| A3 | Desktop App Icons 重新生成 | Dock/任务栏图标显示章鱼 | ~270 |
| A4 | Marketing Assets 更新 | 社交分享卡和邮件显示章鱼 logo | ~6 |
| A5 | CLI ASCII Octopus 重写 | TUI 启动屏显示章鱼主题，不再拼写 "OPCODE" | ~2 |
| A6 | CSS Brand Palette Refresh | 品牌色 token 与章鱼 artwork 色调协调 | ~3 |

### 类别 B: 已 Close Issue 实现补完

| # | 标题 | 价值 | 预估文件 |
|:--|------|------|:--:|
| B1 | README 多语言删除 & opencode 清洗 | 根目录只保留中英双语文档，减少维护负担 | ~22 |
| B2 | i18n JSON opencode 清洗 | 16 个 locale 文件的品牌文本统一为 Octopus | ~16 |
| B3 | CI/CD workflow opencode 残留清洗 | 8 个 workflow 文件品牌引用清理 | ~8 |
| B4 | 测试文件 opencode 残留清洗 | ~20 个测试文件 clean，避免测试名/路径歧义 | ~20 |

### 类别 C: 资产清理

| # | 标题 | 价值 | 预估文件 |
|:--|------|------|:--:|
| C1 | 删除旧 OpenCode mark.svg | `packages/identity/` 仅含章鱼品牌文件，消除歧义 | ~2 |

## 决策

☑ 11 个 Issue 提纲 → 交接给 Orchestrator 进入 P1（创建 Issue + 判定级别 + 冲突检测 + 编入迭代计划）

☑ 类别 A 的完整规格参考 D3 原始文档（`.octopus/discovery/2026-05-12-octopus-visual-identity.md`），Orchestrator 应将其作为 P1 输入

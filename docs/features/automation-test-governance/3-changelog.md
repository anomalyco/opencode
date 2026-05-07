---
feat-id: automation-test-governance
status: done
related: ./3-changelog.md
---

# 3-changelog — 自动化测试治理规范固化

## 起源

user 2026-05-07 决策"以后尽量全部自动化测试"作为 DeskFox 长期方向。Claude 综合调研 Tauri 2 GUI 测试方案 + 与 user 讨论后:

1. 在 OPENCODE-PLAN 仓需求池写了 5 期分级长期规划
2. user 选 "B 先定治理决策" 后给出 5 个待拍板决策
3. user 拍板 `1A 2B 3A 4A 5B`(全部按 Claude 推荐方案)
4. 本 feat 固化决策,**不启动第 1 期实施**(实施时机另行决定)

## 改动清单

### 新文件

- `docs/governance/自动化测试规范.md`(~280 行)
  - 元原则(对齐 CLAUDE.md "稳定 > 简洁")
  - 5 条核心决策(逐条 + 例外 + 操作流程)
  - 操作流程(写新 feat / 修 bug / flaky 处理)
  - 测试基础设施清单(6 项)
  - CI 集成渐进路径(4 阶段)
  - 失败处理("绝不 retry / skip 掩盖")
  - 长期 KPI(核心:人工 QA 时间 / 总开发时间 ≤ 5%)
  - 与 R1-R4 现有规范的边界

### 修改

- `CLAUDE.md`:
  - "硬约束(写代码前必读)"段加 R5 测试纪律(精简版,详细引 governance 文档)
  - "规范修订记录"段加 v3(2026-05-07)条目

## 5 条决策固化

| # | 决策 | 选择 | 落地点 |
|---|---|---|---|
| 1 | 写进 CLAUDE.md 硬约束? | A 是 | CLAUDE.md R5 第一条 + governance 决策 1 |
| 2 | 测试覆盖率门槛 | B 关键模块 | governance 决策 2 + 关键模块清单(初版 4 文件) |
| 3 | 单测/e2e 比例 | A 70/20/10 | governance 决策 3 + 比例失衡警告规则 |
| 4 | 修 bug 必须先写复现测试 | A 强制 | CLAUDE.md R5 第二条 + governance 决策 4 + commit message 标 `[bug-repro: ...]` |
| 5 | 谁审核测试 | B Claude 自审起步 | governance 决策 5 + Phase A/B/C 升级路径 |

## 关键模块清单(初版,user 可调)

| 文件 | 理由 |
|---|---|
| `packages/app/src/utils/markdown-editor-extensions.ts` | 编辑器核心,改动频繁 |
| `packages/app/src/components/dialog-settings.tsx` | 用户高频接触,版本牌+i18n+多平台 |
| `packages/app/src/pages/session/file-tabs.tsx` | 文件查看器,选区/右键菜单/编辑态多次出 bug |
| `packages/app/src/utils/md-export-docx.ts` | Word 导出,新 dep,边界条件多 |

## 与现有规范的关系

- **不冲突 R1-R4** — 测试纪律是新增维度,横切于规模分级 / FORK marker / hardcode 禁令 / 黑名单
- **叠加 Tiny/Medium/Large 分级** — 原分级管"文档要求",新增"测试要求"按相同分级追加
- **新增 [bug-repro: ...] commit tag** — 与既有 [feat: ...] / [override-blacklist: ...] / [large-diff: ...] 同级

## 当前状态

| | |
|---|---|
| 治理纪律 | ✅ 已固化生效(从此 commit 起) |
| pre-push hook 测试守门 | ⏳ 第 1 期实施时接入(暂未做) |
| 第 1 期实施(写真测试) | ⏸ user 决定时机,需求池长期规划暂搁 backlog |
| OPENCODE-PLAN 规划文档第七章 | 待回填"已决"(本 feat 收尾时同步处理) |

## 影响

- **从此刻起**:任何新 feat / bug fix 都按 R5 走(Tiny 例外清单内的不强制)
- **过往 feat 不追溯**:已 ship 的代码不强制补测试,但作者(Claude / user)可以按需补
- **第 1 期触发条件**:user 主动启动 / 出 1-2 个本可被测试拦下的回归

## 规模 / R 标记

- 规模:Medium(~300 行净增 / 2 文件 / 治理规范类)
- R2 FORK marker:不适用(纯新增 fork-only docs)
- R3 黑名单:无
- R4 override:无
- R5 测试纪律本身:本 feat **就是规范的元 feat**,不需要测试覆盖自己
- 上游侵入:0(全 fork-only)

## 下一步(本 feat 收尾后)

- ⏳ OPENCODE-PLAN 仓 `自动化测试-长期规划.md` 第七章治理决策表加"已决于 2026-05-07"标
- ⏸ 等 user 决定第 1 期启动时机(可能性:立即 / 1 个月后 / 1.0 ship 前)

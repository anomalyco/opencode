---
description: 代码审查当前 PR 变更
agent: orchestrator
---

你正在审查当前 PR 的代码变更。

## 检查清单

1. **代码风格** — 符合 AGENTS.md（无 any、无 try/catch、使用 const）
2. **类型安全** — 无 `any` 类型，类型导出完整
3. **测试覆盖** — 核心路径和错误路径均有测试，不 mock 业务逻辑
4. **Effect 规范** — Effect.gen/Effect.fn/Context.Service 正确使用

## 变更级别与审批要求

- chore/docs → 1人审批
- fix → 1人（含 architect）
- feat/refactor → 1人（必须 architect）
- feat!(Breaking) → 2人（architect + qa）

使用 `!`git diff --stat`` 和 `!`git diff`` 查看变更。

输出：审查通过/不通过 + 建议

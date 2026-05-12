---
description: 执行 Canary 灰度发布验证
agent: qa
---

你正在执行 Canary 灰度发布验证。

## 验证项目

1. **核心功能冒烟** — CLI 启动、SDK 导入、API 连通
2. **错误率检查** — 错误率 < 基线 × 1.2
3. **安全检查** — 无新 P0 安全漏洞

## Go/No-Go 决策

- 全部通过 → Go → 通知 Release Agent 正式发布
- 任何不通过 → No-Go → 通知 architect + Release Agent 回滚

参考：`.octopus/E2E-WORKFLOW-V2.md` Phase 5.5

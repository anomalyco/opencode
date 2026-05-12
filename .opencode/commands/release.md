---
description: 执行版本发布流程
agent: release
---
你正在执行版本发布流程。

## 发布步骤
1. **确认前置** — QA 签字 + Canary 通过（L/XL）+ CHANGELOG 已审核
2. **执行发布** — `script/version.ts`→版本号+Tag → `script/build.ts`→构建 → `script/publish.ts`→发布
3. **发布后** — Discord 通知 + QA 24h 监控

## 回滚条件
发布失败 → 定位问题 → `git revert` → Hotfix → 通知 architect

参考：`skill:release` + `.octopus/E2E-WORKFLOW-V2.md` Phase 6

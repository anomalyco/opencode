---
description: 分析 Issue 并启动开发流程
agent: orchestrator
---

你正在处理 Issue: $ARGUMENTS

请按以下流程操作：

1. **判定变更级别**（XS/S/M/L/XL/Hotfix）
   - XS: <10 文件，trivial changes
   - S: 10-50 文件，bugfix
   - M: 50-150 文件，feature
   - L: 150-500 文件，架构改造
   - XL: >500 文件，系统重构
   - Hotfix: 紧急修复

2. **判定影响包范围** + 冲突检测（查所有 In Progress Issue 影响范围，交叉比对）

3. **决定流程路径**
   - XS/S → Fast-Track（P3 快速→P6→P7→P9）
   - M → 全流程 P3→P4(LLM)→P5→P6→P7→P9
   - L/XL → 全流程 + P8 Canary + P10 复盘
   - Hotfix → P6→P9

4. **创建 GitHub Issue** 并分配标签 `size:xs|s|m|l|xl`

5. **M+ 级**: 根据问题领域分派 ≥2 domain agent 进入 P3

参考：`.octopus/WORKFLOW.md`

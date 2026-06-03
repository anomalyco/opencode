---
description: Lingxi Harness 全链路自动化（概要设计 → 详细设计 → 代码编写 → 单元测试）
---

你正在执行 Lingxi Harness 全链路自动化 Pipeline。

四个阶段将在当前 session 中按 PRD → Design → Code → Test 顺序执行，但系统会按 Step 渐进注入。
每次只执行当前注入的 Step，不要自行跳到后续 Step 或后续阶段。
所有配置已从 lingxi_harness_config.json 预加载，请严格按照注入的 CURRENT_STEP_INSTRUCTION 执行。

⚠️ 关键规则：
1. 每个阶段的 Step_0 不调用 question 工具，配置值已预填
2. 所有阶段共用同一个 featureId
3. 每个 Step 完成后必须调用 update-step 更新 Step 进度
4. 只有阶段最后一个 Step 完成并收到系统提示后，才调用 update-progress 进入下一阶段
5. 非最后 Step（例如 PRD Step_0）完成后严禁调用 update-progress

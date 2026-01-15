---
name: fullstack-integrator
description: 把 Gemini Build 产出的纯前端项目导入并改造成可上线的全栈结构：接入 db/storage/auth/llm service，抽离 API 层，补齐 env/config、错误处理与可观测性。
---

# Fullstack Integrator

## 核心原则
- 不直接在组件里写 fetch：必须抽 services/api 层
- 所有外部依赖通过 env + config 注入
- 后端 contract 先写接口文档/类型，再改实现
- 任何“看起来能跑”但不可测/不可维护的东西都要重构

## 交付物
- 目录结构调整建议（web/ + server/ 或 apps/web + apps/server）
- API contract（types + endpoints）
- Auth/DB/Storage/LLM 的接入点（占位也要有）
- 最小可跑脚本：dev/test/build

## 风险提示
如果用户没提供后端细节：先做 adapter 层（Mock → Real），保持替换成本低。

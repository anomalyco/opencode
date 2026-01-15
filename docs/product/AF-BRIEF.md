# Agent Foundry 项目介绍（Project Overview）

## Overview

Agent Foundry 是一个 **AI-native 的应用层平台**：让“用自然语言创建/运行/分发 AI App”变成一条可重复的产品化流水线。  
核心理念是 **“分发结果，而不是分发应用列表（Distribute the Result, not the App）”**：App 的输出被标准化为 **Artifact**，并绑定可一键复用的 **Intent**，在 Feed 中以内容形态获得分发与增长，再反哺创作与产品化。

> 一句话：Agent Foundry = “TikTok for AI Apps” × “Prompt-to-App Studio”，用 Artifact Feed 聚合注意力，用 Runtime/Gateway 承载差异化供给。

---

## Goals / Non-goals

### Goals
- **Prompt → App → Artifact → Feed → Intent → Remix** 的闭环跑通
- 多模型/多云的 **LLM Gateway + Tooling**（provider-agnostic）
- 统一 **Artifact / Intent / ReplayManifest** 等生态级 schema，形成分发与复用的“协议层”
- 支持多端：Web / iOS（WKWebView Shell）/ Desktop（未来）

### Non-goals（短期不做）
- 不追求做一个“通用 IDE 替代品”
- 不在 MVP 阶段做复杂的商业化分账/创作者市场治理
- 不在 MVP 阶段强行实现“完全隔离的沙箱执行”（先以权限与审计为主）

---

## Assumptions
1. Build Console 将优先服务“创建者侧”（Creator Loop），分发侧（Feed）为 Phase 2 重点。
2. App 形态以 **React Mini-App** 为主，可嵌入 iOS Shell 的 `WebAppContainer`（Native-first）。
3. 产物优先以 **视频/图片/音频/可回放 replay** 等为主（便于 Feed 消费）；小游戏类 app 默认支持 play/replay 模式，且在 GameStore 保留 replay manifest。
4. Runtime/Gateway 负责鉴权、存储、队列/渲染、模型路由等“系统集成”能力；packages 内包含 replay-server（Node.js + Puppeteer），在阿里云 Function Container 运行，接收 replay manifest 并录制浏览器生成 mp4。
5. “导出代码到本地”不是主路径；主路径是托管运行 + 一键发布（形成不可替代性）。:contentReference[oaicite:10]{index=10}

---

## Architecture

### Core Components（平台分层）
- **Builder Console（Creator UI）**：Prompt-to-App、模板、调试、预览、发布、工件管理
- **Runtime Apps（Web Mini-Apps）**：按 Intent 运行，产出 Artifact
- **iOS Shell（Native-first）**：Feed/Create/Me 等核心 UI 在 SwiftUI；Mini-App 只在 `WebAppContainer` 内运行，通过 Bridge 回传 Artifact。
- **BFF / API Gateway**：统一对 Console / iOS / Web 暴露接口，cookie 优先、token fallback
- **Artifact Service**：artifact 元数据、manifest、版本、权限、存储引用（storage_ref）
- **Storage Backend**：本地/对象存储/CDN（含视频/HLS）
- **Feed / Replay Service**：FeedItem + ReplayManifest；可录制/可回放/可抽高光
- **LLM Gateway / Tooling**：多 provider 路由、工具网关、策略与成本控制

### Closed Loop（价值飞轮）
1) Create：Prompt → App（代码 + manifest + intents）  
2) Productize：注入 Intent/Artifact schema、权限与配额  
3) Run：执行 Intent，生成 Artifact（视频/图片/音频/replay）  
4) Distribute：Artifact 上 Feed，绑定 Intent 一键复用  
5) Learn：Prompt→Run→Use→Remix 的全链路遥测，优化模板/路由/分发

---

## Key Concepts

### Artifact（分发单元）
- 可被播放/分享/缓存/导出
- 典型类型：video / audio / image_set / replay
- 关键字段：hero、poster、duration、tags、storage_ref、manifest

### Intent（复用单元）
- 绑定在 Artifact 上的一键动作：Remix / Continue / Fork / Run intent
- 输入 schema + 输出类型（关联 artifact 类型）

### ReplayManifest（可回放描述）
- 记录交互事件流 + 媒体资源引用
- 用于 Preview/Engage/Resume 三态（Feed 优化与继续创作）

---

## Security & Keys
- Provider keys 只走 env/secret manager
- Console 侧不直连 provider；统一走 LLM Gateway（可审计、可限流）
- Tool 执行按 agent 权限控制（allow/deny/ask）+ 事件审计

---

## Performance & Cost
- Feed 首帧目标：200–500ms（poster/hero 预取 + cache）
- 大头成本：视频渲染/多模态推理 → 通过队列、缓存命中、模型路由降本
- 关键指标：artifact render 成功率、平均渲染时延、缓存命中率、intent 转化率

---

## Observability
- 全链路事件：build.start/build.finish、intent.run、artifact.created、publish.succeeded、feed.impression、intent.click、remix.start
- 必备字段：workspaceId、appId、artifactId、sessionId、provider/model、latency、cost_estimate、error_code

---

## Rollout Plan
- Phase 1（MVP）：Creator Loop 跑通（Build Console + Runtime + Artifact）
- Phase 2：Feed 分发 + Intent 转化闭环
- Phase 3：生态智能（自动路由、模板自优化、治理）

---

## TODO Checklist（MVP）
- [ ] 定义统一 schema：Artifact / Intent / ReplayManifest（JSON schema + 校验）
- [ ] Build Console：Prompt-to-App、预览、发布、artifact 管理
- [ ] Runtime Gateway：run intent、上传 artifact、生成 feed item
- [ ] iOS Shell：WebAppContainer + Bridge 回传 artifact.created 跑通
- [ ] Telemetry：事件打通 + 最小仪表盘

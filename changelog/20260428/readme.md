# 2026-04-28 — Workflow trace 里程碑

## 概要

在 OpenCode 服务端 HTTP 工作流中引入 **workflow trace**：按请求生成结构化 JSON，便于排查会话、模型流与耗时。

## 主要能力

- **落盘位置**：与日志同级，例如 `~/.local/share/opencode/trace/`（随 `Global.Path.trace`）。
- **文件命名**：`trace_<request_id>_<iso-timestamp>.json`，**一请求一文件**（可配置/路径例外见下）。
- **内容**：
  - HTTP 元数据、`events` 时间线（`opencode.<business>.<method>=<ms>|k=v`）。
  - **`chat`**：`user_input`、`model_stream_text`（流式正文拼接）、`part_deltas`（与 UI 一致的 `message.part.delta` 粒度）、`assistant_output`、`model` 等。
- **Effect 贯通**：`WorkflowTraceSessionRef` 将 trace session 传入 `AppRuntime.runPromise`（ALS 无法穿透 Effect）。
- **`prompt_async`**：204 返回后 prompt 仍在后台执行，trace **推迟到 `runRequest.finally`** 再持久化，避免只有 `user_input`、无模型回复。
- **性能**：
  - 流式场景禁止对 growing string 反复 `+=`（曾导致近似 O(n²) 卡死）；改为分块数组 + 一次 `join`。
  - 持久化经 `setImmediate` 异步调度，避免阻塞 HTTP 收尾。
- **默认范围**：仅对 `POST /session/:id/message|prompt_async|command|shell` 写 trace；`OPENCODE_WORKFLOW_TRACE=all` 或请求头 `x-opencode-workflow-trace: 1` 可扩大范围。

## 相关代码（入口）

相对本文件 `changelog/20260428/readme.md` 的路径，可在 IDE / GitHub 中点击跳转。

- [`packages/opencode/src/server/workflow-trace.ts`](../../packages/opencode/src/server/workflow-trace.ts) — 中间件、`scheduleWorkflowTracePersist`、`traceRecordLlmStreamEvent` 等。
- [`packages/opencode/src/server/routes/instance/trace.ts`](../../packages/opencode/src/server/routes/instance/trace.ts) — `runRequest` + `WorkflowTraceSessionRef`。
- [`packages/opencode/src/session/prompt.ts`](../../packages/opencode/src/session/prompt.ts) — `traceChatInitFromUserMessage`。
- [`packages/opencode/src/session/processor.ts`](../../packages/opencode/src/session/processor.ts) — 流事件与 `traceChatFinalizeAssistant`。
- [`packages/core/src/global.ts`](../../packages/core/src/global.ts) — `Path.trace`。
- [`packages/opencode/src/server/routes/instance/session.ts`](../../packages/opencode/src/server/routes/instance/session.ts) — `prompt_async` 推迟 `scheduleWorkflowTracePersist`。

## 事故与备忘

根目录 [**`WORKFLOW-TRACE-PERF.md`**](../../WORKFLOW-TRACE-PERF.md) 记录了「流式 trace 字符串拼接导致全局卡顿」的根因与自检清单，评审时可对照。

## 里程碑反思（提醒自己还能做得更好）

这一条不只是「功能合入」，更是一轮 **设计纠偏**：先按 SDK `fullStream` 逐事件落盘（`llm_stream` / `stream_packages`），后来发现与 **UI / bus 实际展示的粒度** 不一致，排查时对不上号，还加重了热路径与体积。收敛为 **`part_deltas`**（与 `session.updatePartDelta` / `message.part.delta` 一一对应）后，trace 才成为「和用户看到的一样」的可靠回放。

**可以记下来的原则：**

- **观测与产品同构**：调试数据优先对齐用户可见的通道与分片，而不是对齐任意一层 SDK 抽象。
- **热路径先量后加**：流式场景默认假设「事件极多」；任何 `+=`、大块 `JSON.stringify`、同步写盘都要当作红灯。
- **少即是多**：能用一个字段讲清故事，就不要维护两套语义相近的流（减少解析心智与维护成本）。

**后续仍可改进的方向（备忘，非承诺）：** 采样/开关更细粒度、trace 与隐私/体积的平衡、与外部可观测性（trace id、导出格式）的统一——需要时再拆任务。

## 环境变量（节选）

| 变量 | 含义 |
|------|------|
| `OPENCODE_WORKFLOW_TRACE` | `all` / `1`：对所有未跳过路由写 trace |
| `OPENCODE_TRACE_MAX_USER_CHARS` | `user_input` 上限 |
| `OPENCODE_TRACE_MAX_STREAM_CHARS` | `model_stream_text` 上限 |
| `OPENCODE_TRACE_MAX_ASSISTANT_CHARS` | `assistant_output` 上限 |
| `OPENCODE_TRACE_MAX_PART_DELTAS` | `part_deltas` 最大条数 |
| `OPENCODE_TRACE_PART_DELTA_CAP` | 单条 `part_deltas[].delta` 字符上限 |

---

*本目录用于按日期归档重要变更；本条为 workflow trace 里程碑：含首次合入、性能事故教训，以及「与 UI 对齐的 `part_deltas`」这一设计转向，便于日后翻回来看「当时为什么这样选」。*

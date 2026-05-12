---
name: llm
description: LLM provider integration patterns, streaming, token management, prompt strategies
---

# LLM Integration

此 Skill 供 core-dev 和 platform 在涉及 LLM 相关代码时使用。

## Provider 集成模式

### 统一抽象

项目通过 Effect Service 抽象多 provider。新增 provider 时：
- 实现标准 Service 接口（`chat`, `stream`, `countTokens`）
- 响应格式统一为内部 Message 类型，不直接暴露 provider 原生格式
- provider 特有参数通过 ServiceTag 配置注入，不硬编码

### 错误处理

LLM 调用的常见错误模式：
- **Rate Limit** (429) → 指数退避重试，最大 3 次
- **Context Length Exceeded** → 触发 compaction，不直接报错
- **Model Unavailable** → fallback 到 `small_model` 或降级模型
- **Stream Interruption** → 保留已接收的部分 tokens，标记为 incomplete

> 错误类型使用 `Schema.TaggedErrorClass` 定义，不在 Effect 中 throw。

## Streaming

### 模式
- 使用 `Effect.fn` + `AsyncIterator` 实现 streaming source
- 每个 chunk 立即通过 Effect pipeline 处理，不缓冲整个响应
- 对长时间 stream（>30s）设置定期 heartbeat 检查

### Backpressure
- 下游消费慢时，使用 Effect Queue（bounded）控制内存
- Queue 满时暂停 stream 读取，而非丢弃

### Abort/Cancel
- 用户取消时，Effect fiber 自动 propagate cancellation
- provider 请求通过 `AbortSignal` 取消
- 避免在 finally 中做重操作（Effect 用 `Effect.onInterrupt`）

## Token 管理

### 计数
- 使用 `tiktoken` 或 provider 原生 API 做 token 计数
- 每次请求前预估 token 用量（system prompt + context + expected output）

### 预算
- Session 级别的 token 预算通过 `Storage` 持久化
- 接近上限时触发 compaction，而非直接截断
- compaction 后保留关键上下文（用户意图、最近文件操作、错误信息）

### 模型选择

模型选择优先级：
1. Agent frontmatter 中显式指定的 `model`
2. `opencode.jsonc` 中 `agent.<name>.model` 的值
3. 全局 `model` 配置
4. Provider 的默认模型

不同任务的模型配比：
- 高推理任务（P0 Discovery、P5 设计） → Pro 模型
- 流程编排（P1-P10） → Flash 模型
- 测试/文档/配置 → Flash 模型
- 代码生成 → Pro 模型

## Prompt 策略

### System Prompt 构建
- 分层组织：核心规则 → Agent 角色 → 具体任务 → 工具使用说明
- 避免在 system prompt 中硬编码路径或环境特定信息
- 大段说明放在独立的 `.md` 文件中，用 `{file:}` 引用

### Context 注入
- 只注入与当前任务直接相关的文件和代码
- 文件内容 > 1000 行时只注入相关函数/类片段
- 优先注入接口定义和类型声明，而非实现细节

### Compaction 策略
- Compaction 时保留：用户意图、错误信息、最近 5 轮工具调用结果
- 丢弃：中间的思考过程、已解决的错误、重复的日志
- Compaction 后追加一句 "Context was compacted. Key state: ..." 作为锚点

## 参考
- `packages/llm/` — provider 集成代码
- `packages/octopus/src/session/` — session + compaction + prompt 管理

---
name: observability
description: Structured logging, error tracking, and debugging patterns for autonomous agents
---

# Observability

此 Skill 供 platform 和 core-dev 使用。确保自治 Agent 的行为可观测、可追溯。

## 核心原则

- **自主运行 ≠ 黑盒运行**：Agent 的每一步决策和工具调用都应可追溯
- **分级日志**：DEBUG（开发调试）、INFO（关键决策点）、WARN（非预期但可恢复）、ERROR（中断性错误）
- **结构化日志**：使用 JSON 格式的 key=value，不依赖正则 grep 日志

## 日志规范

### 必须记录的事件

| 事件 | 级别 | 记录内容 |
|------|:---:|------|
| Session 创建/销毁 | INFO | session_id, project_id, agent_name |
| LLM 请求/响应 | INFO | provider, model, input_tokens, output_tokens, latency_ms |
| 工具调用 | INFO | tool_name, args_summary, result_summary, duration_ms |
| 文件修改 | INFO | file_path, operation(write/edit/patch), lines_changed |
| Shell 命令执行 | INFO | command_summary, exit_code, duration_ms |
| Context Compaction | WARN | tokens_before, tokens_after, compression_ratio |
| Rate Limit 命中 | WARN | provider, retry_count, wait_ms |
| 工具调用失败 | ERROR | tool_name, error_type, error_message |
| LLM 调用失败 | ERROR | provider, model, error_type, status_code |
| 未处理异常 | ERROR | error_type, stack_trace, session_state_summary |

### 日志格式

```json
{
  "ts": "2026-05-11T10:30:00.000Z",
  "lvl": "INFO",
  "msg": "llm_request",
  "sid": "sess_abc123",
  "provider": "openai",
  "model": "gpt-5",
  "input_tokens": 1234,
  "output_tokens": 567,
  "latency_ms": 2340
}
```

关键字段缩写：`ts`(timestamp), `lvl`(level), `msg`(message), `sid`(session_id). 其余字段按事件类型扩展。

### 敏感信息

- **绝不能记录**：API key, user token, secret 内容
- **脱敏记录**：文件路径（仅记录相对路径）、命令参数（脱敏 flag values）、prompt 内容（截断至前 100 字符）

## Error Tracking

### 错误分类

| 类型 | 示例 | 处理策略 |
|------|------|---------|
| 瞬时错误 | Rate Limit, Network Timeout | 自动重试（指数退避），达到上限后升级为 ERROR |
| 业务错误 | Schema 校验失败, 依赖缺失 | 记录 ERROR，返回用户友好的错误信息 |
| 系统错误 | 磁盘满, OOM, DB corrupt | 记录 ERROR + 写入诊断文件，尝试安全关闭 |

### P8 Canary 监控指标

| 指标 | 阈值 | 计算方式 |
|------|:---:|------|
| 错误率 | < 基线 × 1.2 | ERROR 事件数 / 总请求数 |
| P95 延迟 | < 基线 × 1.5 | LLM 请求 latency_ms 的 P95 |
| Token 消耗率 | < 基线 × 1.3 | input_tokens / session |
| Compaction 频率 | < 基线 × 2 | compaction 事件数 / session |

> 基线取最近 7 天同期的移动平均值。

## Debugging

### 会话回放
- 关键会话保留完整日志（ERROR 事件 > 3 次）
- 回放时按 timeline 顺序重放事件，重建 Agent 决策链

### 根因定位步骤
1. 检索 session_id → 查看该 session 的所有事件
2. 定位第一个 ERROR/WARN 事件的时间点
3. 回溯该时间点前 10 个事件，找出触发条件
4. 如涉及 LLM 调用，检查 prompt（截断版）和 response

## 参考
- `.octopus/WORKFLOW.md` P8 Canary 监控
- `packages/octopus/src/session/` — session 管理

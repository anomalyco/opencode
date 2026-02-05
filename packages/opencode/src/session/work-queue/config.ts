// 默认超时配置（毫秒）
export const DEFAULT_TIMEOUT = {
  LLM: 120_000, // LLM 调用 2 分钟
  TOOL: 60_000, // 工具执行 1 分钟
  SUBTASK: 300_000, // 子任务 5 分钟
  HEARTBEAT: 10_000, // 心跳间隔 10 秒
  IDLE: 50, // 空闲检查间隔 50ms
} as const

// 任务优先级
export const PRIORITY = {
  CRITICAL: 100,
  HIGH: 80,
  MEDIUM: 50,
  LOW: 20,
  IDLE: 0,
} as const

// 最大并发数
export const MAX_CONCURRENCY = 20

// 任务最大重试次数
export const MAX_RETRIES = 3

// 重试延迟（毫秒）
export const RETRY_DELAY = 1000

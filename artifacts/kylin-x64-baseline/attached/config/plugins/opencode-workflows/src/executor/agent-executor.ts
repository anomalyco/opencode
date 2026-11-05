/**
 * OpenCode Workflows —— Agent_Executor（Agent 执行器）。
 *
 * Agent_Executor 负责单个子 Agent 的**完整生命周期**：并发准入（Semaphore）、
 * Agent 总数安全阀、子 session 创建/销毁、系统提示注入（SystemInjector）、
 * 阻塞式 `session.prompt()`、结构化输出（透传 SDK 原生 format:json_schema，R6.6/R6.9）、
 * 单 Agent 超时（R4.13/R13.7）。
 *
 * 职责边界（与 Orchestration_API/task 11.3 的分工）：
 * - **本模块**：执行单个 {@link AgentTask}，返回 {@link AgentResult} 或 `null`（超时/失败）；
 *   绑定 sessionID → run/phase（供全局 before-tool 分发器经 {@link ExtensionSystemPort.getBinding}
 *   路由），注入系统提示，透传结构化输出 format。
 * - **不在本模块**：agentIndex 分配、before-agent/after-agent Hook、Journal 落盘、
 *   预算记录与阶段归属——这些由 Orchestration_API 在调用 `execute` 前后接线。
 *
 * 超时与失败语义（R4.13/R13.7）：
 * - 单 Agent 超时（默认 **不限制**；可经 `config.agentTimeout` 正数或 `task.opts.timeout` 启用）
 *   → 超时则 `session.abort()` 终止子 session，`execute` 返回 `null`（由 Orchestration_API
 *   据此记录超时事件到 Journal）。
 * - 结构化输出经 SDK 原生重试（retryCount）仍不通过（`info.structured` 缺失）→ 降级返回 `null`
 *   （P3-A，R6.1/R6.2/R6.3），不再抛 `SCHEMA_VALIDATION_ERROR`，使 schema 失败语义与其它失败一致。
 * - Agent 总数达 `maxAgents`（默认 1000）→ 抛 {@link WorkflowError}（`AGENT_LIMIT_EXCEEDED`）。
 * - 其余 SDK 调用失败 → 返回 `null`（视为该 Agent 失败，不中断整个 workflow）。
 *
 * SDK 依赖：通过结构化端口 {@link OpenCodeClientPort} 解耦真实 `@opencode-ai/sdk` 的
 * `OpencodeClient`（其 `session.create/prompt/abort` 形状与本端口兼容），便于单元测试
 * （task 8.4）注入 Mock client。token 回传已由 task 1.3 risk gate 验证为
 * VERIFIED-AVAILABLE（`info.tokens.{input,output}`），无需降级。
 *
 * @see .kiro/specs/opencode-workflows/design.md — 4. Agent_Executor / 结构化输出（原生 format:json_schema）
 * @see __tests__/integration/sdk-capability-spike.test.ts — token 回传 / per-call system override
 * Requirements: 4.1, 4.3, 4.4, 4.13, 6.1, 6.4, 6.9, 6.10, 13.7, 14.7
 */

import { cpus } from "node:os"

import { WorkflowError, isWorkflowError } from "../errors"
import { WORKFLOW_EVENT_CODES } from "../logging/event-codes"
import type { WFLogger } from "../logging/wf-logger"
import { coerceLogger } from "../logging/wf-logger"
import type { AgentOptions, AgentResult, JsonSchema } from "../types"
import type { Semaphore } from "./semaphore"
import { createSemaphore } from "./semaphore"
import type { SystemInjector } from "./system-injector"
import { FORBID_SEND_USER_MESSAGE, plainTextInstruction } from "./system-injector"

// ============================================================================
// 默认常量
// ============================================================================

/** 单 Agent 默认超时（ms）。 */
export const DEFAULT_AGENT_TIMEOUT_MS = 300_000
/** 单 Workflow Agent 调用总数默认上限（防失控循环安全阀）。 */
export const DEFAULT_MAX_AGENTS = 1000
/** 结构化输出 Schema 验证失败默认重试上限。 */
export const DEFAULT_SCHEMA_RETRIES = 2
/** 瞬时错误（Transient_Error）默认重试次数（P5-A / R5.3）；共 DEFAULT_RETRIES+1 次尝试。 */
export const DEFAULT_RETRIES = 3

// ============================================================================
// SDK 结构化端口（解耦真实 @opencode-ai/sdk，便于 Mock 测试）
// ============================================================================

/** SDK 请求返回的统一信封（ThrowOnError=false 时 `{ data?, error? }`）。 */
export interface SdkResult<T> {
  data?: T
  error?: unknown
}

/** `session.create()` 返回的会话信息（仅取 id）。 */
export interface CreatedSession {
  id: string
}

/** `session.prompt()` 返回的助手消息体（仅取本模块所需字段）。 */
export interface PromptInfo {
  /** token 用量（task 1.3 已验证回传，R14.1） */
  tokens?: { input?: number; output?: number }
  modelID?: string
  providerID?: string
  /**
   * 结构化输出结果（SDK 原生 format:json_schema 校验通过后回填，R6.6/R6.9）。
   * 命中 schema 且校验通过时为已校验对象；未命中 schema 或校验失败时为 undefined。
   */
  structured?: unknown
  /** 助手消息错误（如被 abort、长度超限、StructuredOutputError）；存在即视为本次 prompt 失败 */
  error?: unknown
}

/** `session.prompt()` 返回的消息片段（仅取文本片段的 text）。 */
export interface PromptPart {
  type: string
  text?: string
  synthetic?: boolean
}

/** `session.prompt()` 的返回体。 */
export interface PromptResponseBody {
  info: PromptInfo
  parts: PromptPart[]
}

/**
 * OpenCode SDK 客户端的结构化端口——仅声明 Agent_Executor 实际使用的三个会话方法。
 *
 * 本端口以 `{ path:{id}, body }` 形态表达调用——**与 OpenCode plugin host 注入的 v1 SDK
 * 客户端形态一致**（v1 `client.session.*` 即 `{ path:{id}, body }` 嵌套参数）。`index.ts` 的
 * `adaptClient` 适配层近乎直通地把端口调用转发给 v1 client；单元测试可直接提供满足本端口形态的
 * 轻量 Mock。注意 `format`（结构化输出）字段服务端支持、但冻结的 v1 SDK 类型未暴露，由适配层
 * 局部断言透传（详见 `adaptClient` 内说明）。
 */
export interface OpenCodeClientPort {
  session: {
    create(options: { body?: { title?: string; parentID?: string } }): Promise<SdkResult<CreatedSession>>
    prompt(options: {
      path: { id: string }
      body?: {
        parts: Array<{ type: "text"; text: string }>
        system?: string
        model?: { providerID: string; modelID: string }
        agent?: string
        /** 结构化输出：透传给 SDK 原生 StructuredOutput（强制工具调用 + 服务端重试，R6.6/R6.9）。 */
        format?: { type: "json_schema"; schema: Record<string, unknown>; retryCount?: number }
      }
    }): Promise<SdkResult<PromptResponseBody>>
    abort(options: { path: { id: string } }): Promise<unknown>
  }
}

// ============================================================================
// 扩展系统端口（Agent_Executor 仅需 session 绑定能力，避免反向依赖整体 ExtensionSystem）
// ============================================================================

/** sessionID → run/phase/约束规则 的绑定记录（与 Extension_System 的 SessionBinding 同形）。 */
export interface SessionBindingInfo {
  sessionID: string
  runId: string
  phase: string
  constraints?: unknown
}

/**
 * Agent_Executor 对 Extension_System 的最小依赖端口：仅需绑定/解绑子 session，
 * 使全局 `tool.execute.before` 分发器能凭 sessionID 路由到该 run 的 before-tool Hooks。
 */
export interface ExtensionBindingPort {
  bindSession(binding: SessionBindingInfo): void
  unbindSession(sessionID: string): void
}

// ============================================================================
// 配置、任务、接口
// ============================================================================

/** Agent_Executor 配置（对应 design.md「AgentExecutorConfig」）。 */
export interface AgentExecutorConfig {
  /** 最大并发 Agent 数（默认 min(16, cpu-2)，最小 1）；与外部共享 Semaphore 时可省略 */
  maxConcurrency?: number
  /** 单 Workflow Agent 调用上限，默认 1000 */
  maxAgents?: number
  /** 单 Agent 超时（ms）。默认 `null`（不限制运行时间）；正数启用超时，`null`/`<=0` 关闭。 */
  agentTimeout?: number | null
  /** Schema 验证失败重试上限，默认 2 */
  schemaRetries?: number
  /**
   * 瞬时错误（Transient_Error）重试次数（P5-A / R5.3）。默认 3（共 4 次尝试）；
   * 工厂中钳制为非负整数（`Math.floor`，非法/缺省回退 {@link DEFAULT_RETRIES}）。
   */
  retries?: number
  /**
   * 可选：退避等待钩子（P5-A）。默认真实 `setTimeout`；单测可注入假时钟以避免真实等待并
   * 断言退避序（1s/2s/4s）。
   */
  sleep?: (ms: number) => Promise<void>
  /** OpenCode SDK client（结构化端口） */
  client: OpenCodeClientPort
  /** 系统提示注入器 */
  injector: SystemInjector
  /** 扩展系统（仅用其 bindSession/unbindSession） */
  extensions: ExtensionBindingPort
  /**
   * 可选：外部共享的 Semaphore（workflow() 内联调用需与父 workflow 共享并发）；
   * 省略时按 maxConcurrency 自建。
   */
  semaphore?: Semaphore
  /**
   * 可选：WF_Logger 实例（依赖注入式日志抽象）。缺省/非法时回退 No_Op_Logger，
   * 业务行为（返回值、副作用、控制流）与未注入时逐一相同，差异仅为「无日志输出」。
   * 记录的关键后台事件：session.create 失败（ERROR/AGENT_SESSION_CREATE_FAILED）、
   * SDK 未知异常吞 null（ERROR/AGENT_SDK_ERROR）、单 Agent 超时 abort
   * （WARN/AGENT_TIMEOUT）。
   */
  logger?: WFLogger
}

/** 单个 Agent 任务（对应 design.md「AgentTask」）。 */
export interface AgentTask {
  prompt: string
  opts: AgentOptions
  runId: string
  agentIndex: number
  phase: string
  /**
   * 附加系统提示文本（追加到内置契约文本之后）。
   * 由 Orchestration_API 从 per-run system contributor 计算后传入，用于 Workflow Pack
   * （如 lingxi-harness 的金融精度约束）注入领域特定的 system 指令（R12.8）。
   */
  extraSystem?: string
  /**
   * 引擎默认模型（`"providerID/modelID"` 形态，可选）。
   *
   * 由 Orchestration_API 在 `opts.model` 缺失时注入（run 启动时经 default-model
   * 解析链产出，见 src/engine/default-model.ts），使 agent 请求**显式带 model**，
   * 不再依赖 server 端回退链（其顶层 model 缺失/配错时可能 500 全灭）。
   * 注意：仅注入 AgentTask（不落盘 journal、不参与 resume 比对），`opts.model` 原样保留。
   */
  defaultModel?: string
  /**
   * 子 session 创建成功后的回调（R 第二期）。在「会话创建后、prompt 完成前」即触发，
   * 使上层（Orchestration_API）能在 agent 仍 running 时就拿到 sessionID 并落盘，
   * 供 Workflow Monitor 实时拉取该 agent 的会话日志。回调内异常不影响 agent 执行。
   */
  onSessionCreated?: (agentIndex: number, sessionID: string) => void
}

/** Agent_Executor 公开接口（对应 design.md「AgentExecutor」）。 */
export interface AgentExecutor {
  /** 执行单个 Agent 任务（受并发与总数控制）；超时/被销毁返回 null */
  execute(task: AgentTask): Promise<AgentResult | null>
  /** 当前活跃 Agent 数 */
  activeCount(): number
  /** 已执行 Agent 总数 */
  totalCount(): number
  /** 重置计数器（新 Run 时） */
  reset(): void
  /** 销毁所有活跃子 session（cancel 时调用 session.abort） */
  destroy(): Promise<void>
}

// ============================================================================
// 内部工具
// ============================================================================

/** 超时竞速哨兵。 */
const TIMEOUT = Symbol("agent-timeout")

/**
 * 在 timeoutMs 内 await 一个 Promise；超时返回 {@link TIMEOUT} 哨兵。
 * 始终清理定时器，避免句柄泄漏。
 */
async function raceTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race<T | typeof TIMEOUT>([
      promise,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 把 `session.prompt` 返回的 error 信封（或空响应）序列化为**可读**字符串，用于把真实
 * 失败原因写入 WF 日志。
 *
 * SDK 的 `error` 多为对象（如 `{ data: { message }, ... }` 或 HTTP 错误体），直接
 * `String(error)` 会得到无信息量的 `"[object Object]"`——这正是此前真实服务端原因
 * （如 `Agent not found: "librarian"` / `Model not found` / 连接错误）被静默吞掉的根因。
 * 本函数优先取 `message`，否则 JSON 序列化，兜底 `String()`。
 */
function stringifySdkError(error: unknown): string {
  if (error == null) return "empty response"
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object") {
    // 常见形态：{ data: { message } } / { message } / { error: {...} }。
    const obj = error as Record<string, unknown>
    const data = obj.data as Record<string, unknown> | undefined
    if (data && typeof data.message === "string") return data.message
    if (typeof obj.message === "string") return obj.message
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

/**
 * 剥离模型内联的推理块 `<think>…</think>` / `<thinking>…</thinking>`（问题1·方案A，编排层兜底）。
 *
 * 背景：部分 provider（如 minimax/MiniMax-M*）把推理过程**内联在普通 text 片段里**（而非独立
 * reasoning part 类型），SDK 的 `synthetic` 过滤抓不到。若不剥离，这些 think 文本会经
 * `str(result)` 逐级拼进下游 prompt，造成上下文污染与 token 暴涨。
 *
 * 策略：仅剥离**配对**标签（非贪婪），最大限度避免误删正文中合法出现的 `<think>` 字样；
 * 大小写不敏感、跨行匹配；剥离后裁剪首尾空白。
 */
function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim()
}

/** 从 prompt 返回体提取输出文本：拼接所有非合成 text 片段，并剥离内联推理块（问题1·方案A）。 */
function extractOutputText(body: PromptResponseBody): string {
  const raw = body.parts
    .filter((p) => p.type === "text" && !p.synthetic && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("")
  return stripReasoning(raw)
}

// ============================================================================
// 失败检测（P6）与瞬时错误分类（P5-A）—— 纯函数，导出供单测与 runPrompt 复用
// ============================================================================

/**
 * 失败分类结果（design.md 组件5「FailureClassification」）。
 * {@link classifyFailure} 返回 `null` 表示本次调用成功（非失败）。
 */
export interface FailureClassification {
  /** 是否可重试（命中 {@link isTransientError} 的 Transient_Error）。 */
  retryable: boolean
  /** 失败原因（写入 WF 日志）。 */
  reason: string
}

/**
 * 瞬时错误识别（P5-A，R5.2/R5.5）：按 code / status / message 三路径匹配 Transient_Error 集合
 * （`CERTIFICATE_VERIFICATION_ERROR` / `ECONNRESET` / `ETIMEDOUT` / HTTP 5xx / 429）。
 *
 * - **code 路径**：`error.code` 命中三类网络错误码之一。
 * - **status 路径**：`error.status` 或 `error.statusCode` 为 429 或落在 [500, 599]。
 * - **message 路径**：序列化后的消息含上述错误码、`429`/`5xx` 数字、或 `rate limit`/`too many requests` 文案。
 *
 * @param error `session.prompt` 返回信封的 error，或 `body.info.error`。
 * @returns 命中 Transient_Error 集合则 `true`，否则 `false`。
 */
export function isTransientError(error: unknown): boolean {
  const codes = ["CERTIFICATE_VERIFICATION_ERROR", "ECONNRESET", "ETIMEDOUT"]
  const obj = (error ?? {}) as Record<string, unknown>
  const code = typeof obj.code === "string" ? obj.code : ""
  if (codes.includes(code)) return true
  const status =
    typeof obj.status === "number"
      ? obj.status
      : typeof obj.statusCode === "number"
        ? obj.statusCode
        : 0
  if (status === 429 || (status >= 500 && status <= 599)) return true
  const msg = stringifySdkError(error)
  if (codes.some((c) => msg.includes(c))) return true
  // 自然语言 / 小写错误串（大小写不敏感 + 常见瞬时短语）：真实 SDK 错误消息往往是
  // 「unknown certificate verification error」「socket hang up」等自然语言，而非大写 code 串，
  // 仅靠上面的 code 子串匹配会漏网（见 docs/WF-default-prd-优化评审.md 问题 3）。
  // 用长串 `certificate` 与词边界码（避免误伤随机短词）+ 多词短语（单词消息天然不含空格）。
  if (
    /certificate|socket hang up|connection (?:reset|refused|closed)|network error|fetch failed|timed\s+out|\b(?:econnreset|etimedout|enotfound|eai_again|epipe|timeout)\b/i.test(
      msg,
    )
  ) {
    return true
  }
  if (/\b(429|5\d{2})\b/.test(msg) || /too many requests|rate limit/i.test(msg)) return true
  return false
}

/**
 * 统一失败检测（P6，R4.1/R4.2/R4.3）+ 瞬时错误标记（P5-A）。把一次 `session.prompt` 结果信封
 * 统一分类为失败/非失败，并对失败给出是否可重试。纯函数、无副作用。
 *
 * 失败信号（任一命中即判失败）：
 * 1. **信封级失败**：`raced.error` 置位 或 `raced.data` 缺失（保留原有失败条件，R4.3）。
 * 2. **stream 中途失败**：`body.info.error` 置位（R4.1）。
 * 3. **空响应**：parts 无有效文本 且 输入与输出 token 均为 0（R4.2）。
 *
 * @param raced `session.prompt` 的返回信封（`{ data?, error? }`）。
 * @returns 失败分类 {@link FailureClassification}；本次成功则返回 `null`。
 */
export function classifyFailure(raced: SdkResult<PromptResponseBody>): FailureClassification | null {
  // 1) 信封级失败：error 置位或无 data。
  if (raced.error || !raced.data) {
    return { retryable: isTransientError(raced.error), reason: stringifySdkError(raced.error) }
  }
  const body = raced.data
  // 2) stream 中途失败：info.error 置位。
  if (body.info.error) {
    return { retryable: isTransientError(body.info.error), reason: stringifySdkError(body.info.error) }
  }
  // 3) 空响应：parts 无有效文本 且 输入+输出 token 均为 0。
  const text = extractOutputText(body)
  const tokens = body.info.tokens ?? {}
  const inTok = typeof tokens.input === "number" ? tokens.input : 0
  const outTok = typeof tokens.output === "number" ? tokens.output : 0
  if (text.length === 0 && inTok === 0 && outTok === 0) {
    return { retryable: false, reason: "空响应：parts 无有效文本且 token 计数为 0" }
  }
  return null // 成功
}

/** 从 prompt 返回体的 info 解析实际模型标识。 */
function extractModel(info: PromptInfo, fallback: string): string {
  if (info.providerID && info.modelID) return `${info.providerID}/${info.modelID}`
  if (info.modelID) return info.modelID
  return fallback
}

/** 解析 `model` opts（`providerID/modelID` 形式）为 SDK model 入参；无法解析返回 undefined。 */
function parseModelOpt(model: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined
  const slash = model.indexOf("/")
  if (slash <= 0 || slash >= model.length - 1) return undefined
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
}

/**
 * 组合子 Agent 的系统提示文本：
 * - 有 schema → 结构化输出系统提示由 SDK 原生 format:json_schema 注入（含官方
 *   StructuredOutput 契约），此处仅保留通信约束；
 * - 无 schema → 附加 plain-text 输出契约；
 * - 始终追加「禁止 SendUserMessage」通信约束（R6.7）。
 */
function buildSystemText(schema: JsonSchema | undefined): string {
  const parts = schema ? [] : [plainTextInstruction()]
  parts.push(FORBID_SEND_USER_MESSAGE)
  return parts.join("\n\n")
}

// ============================================================================
// 工厂
// ============================================================================

/**
 * 创建一个 Agent_Executor。
 *
 * @param config 见 {@link AgentExecutorConfig}。
 */
export function createAgentExecutor(config: AgentExecutorConfig): AgentExecutor {
  const maxAgents =
    Number.isFinite(config.maxAgents) && (config.maxAgents as number) >= 1
      ? Math.floor(config.maxAgents as number)
      : DEFAULT_MAX_AGENTS
  const defaultTimeout: number | null =
    Number.isFinite(config.agentTimeout) && (config.agentTimeout as number) > 0
      ? Math.floor(config.agentTimeout as number)
      : null
  const schemaRetries =
    Number.isFinite(config.schemaRetries) && (config.schemaRetries as number) >= 0
      ? Math.floor(config.schemaRetries as number)
      : DEFAULT_SCHEMA_RETRIES
  // 瞬时错误重试次数（P5-A / R5.3）：钳制为非负整数，非法/缺省回退 DEFAULT_RETRIES。
  const retries =
    Number.isFinite(config.retries) && (config.retries as number) >= 0
      ? Math.floor(config.retries as number)
      : DEFAULT_RETRIES
  // 退避等待钩子（默认真实 setTimeout；单测可注入假时钟）。
  const sleep: (ms: number) => Promise<void> =
    typeof config.sleep === "function"
      ? config.sleep
      : (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  const semaphore =
    config.semaphore ?? createSemaphore(config.maxConcurrency ?? defaultConcurrency())
  const { client, injector, extensions } = config
  const log = coerceLogger(config.logger)

  /** 当前活跃子 session 的 id 集合（用于 destroy 级联 abort）。 */
  const activeSessions = new Set<string>()
  /** 已被销毁标记（destroy 后新任务直接返回 null）。 */
  let destroyed = false
  let active = 0
  let total = 0

  /** 安全调用 session.abort，吞掉异常（abort 失败不应中断流程）。 */
  async function safeAbort(sessionId: string): Promise<void> {
    try {
      await client.session.abort({ path: { id: sessionId } })
    } catch {
      // 忽略 abort 失败：会话可能已结束。
    }
  }

  /**
   * 执行一次或多次 `session.prompt()`（含瞬时错误指数退避重试，P5-A），按是否带 schema 走两条
   * 路径：
   *
   * - **无 schema**：拼接所有非合成 text 片段为输出文本（纯文本模式）。
   * - **有 schema**：透传 `format: { type:"json_schema", schema, retryCount }`，由 SDK 原生
   *   StructuredOutput 工具强制结构化并在**服务端**完成校验与重试；结果从 `info.structured`
   *   读取。若原生重试（retryCount）耗尽仍未通过（`info.structured` 缺失），**降级返回 `null`**
   *   （P3-A，R6.1/R6.2/R6.3），不再抛 `SCHEMA_VALIDATION_ERROR`。
   *
   * **重试循环（P5-A）**：每次循环执行一次 prompt（带超时竞速）+ {@link classifyFailure} 失败
   * 分类。失败且 `retryable` 且未耗尽 → 指数退避（1s/2s/4s）后重试；非瞬时失败或重试耗尽 →
   * 返回 `null`（视为该 Agent 失败，不中断 run）。**超时不进入重试**——直接返回 TIMEOUT 走 abort。
   *
   * @returns 输出（结构化对象或纯文本）、token、model；超时返回 TIMEOUT；失败返回 null。
   */
  async function runPrompt(
    sessionId: string,
    task: AgentTask,
    system: string | undefined,
    timeoutMs: number | null,
  ): Promise<{ output: unknown; input: number; output_tokens: number; model: string } | typeof TIMEOUT | null> {
    const schema = task.opts.schema
    //脚本显式 model 优先，缺失时回退引擎默认模型（defaultModel）——请求显式带 model。
    const modelOpt = parseModelOpt(task.opts.model ?? task.defaultModel)
    const backoffs = [1000, 2000, 4000] // 指数退避序：1s / 2s / 4s（R5.1）。
    const maxAttempts = retries + 1 // retries 默认 3 → 共 4 次尝试。

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const promptPromise = client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: task.prompt }],
          ...(system !== undefined ? { system } : {}),
          ...(modelOpt ? { model: modelOpt } : {}),
          ...(task.opts.agentType ? { agent: task.opts.agentType } : {}),
          ...(schema
            ? { format: { type: "json_schema" as const, schema: schema as Record<string, unknown>, retryCount: schemaRetries } }
            : {}),
        },
      })

      // 超时竞速：仅当 timeoutMs 为正数时启用；为 null/<=0（默认）时直接 await（不限制运行时间）。
      const raced =
        timeoutMs != null && timeoutMs > 0
          ? await raceTimeout(promptPromise, timeoutMs)
          : await promptPromise
      if (raced === TIMEOUT) return TIMEOUT // 超时不重试，走 abort（与重试解耦）。

      // 统一失败检测（P6）+ 瞬时错误分类（P5-A）。
      const failure = classifyFailure(raced)
      if (failure) {
        if (failure.retryable && attempt < maxAttempts - 1) {
          // 瞬时错误且仍有重试额度：记 WARN(AGENT_RETRY) 后退避重试。
          log.warn(task.runId, "瞬时错误，指数退避后重试", {
            eventCode: WORKFLOW_EVENT_CODES.AGENT_RETRY,
            agentIndex: task.agentIndex,
            attempt: attempt + 1,
            reason: failure.reason,
          })
          await sleep(backoffs[Math.min(attempt, backoffs.length - 1)])
          continue
        }
        // 不可重试 或 重试耗尽 → 返回 null（视为该 Agent 失败，不中断 run）。
        log.error(task.runId, "Agent 调用失败，吞为 null", {
          eventCode: WORKFLOW_EVENT_CODES.AGENT_SDK_ERROR,
          agentIndex: task.agentIndex,
          reason: failure.reason,
        })
        return null
      }

      // 成功：解析输出。
      const body = raced.data!
      const tokens = body.info.tokens ?? {}
      const input = typeof tokens.input === "number" ? tokens.input : 0
      const output_tokens = typeof tokens.output === "number" ? tokens.output : 0
      const model = extractModel(body.info, task.opts.model ?? task.defaultModel ?? "")

      if (schema) {
        // 有 schema：读取 SDK 原生校验通过后的结构化结果（保留 schema 透传能力，R1.5）。
        if (body.info.structured !== undefined) {
          return { output: body.info.structured, input, output_tokens, model }
        }
        // structured 缺失：原生重试（retryCount）后仍未通过 Schema 校验。
        // P3-A（R6.1/R6.2/R6.3）：不再抛 SCHEMA_VALIDATION_ERROR 崩掉整个 run，改为记
        // ERROR(AGENT_SDK_ERROR) 后降级返回 null，使 schema 失败语义与其它失败语义一致。
        log.error(task.runId, "结构化输出缺失，降级返回 null", {
          eventCode: WORKFLOW_EVENT_CODES.AGENT_SDK_ERROR,
          agentIndex: task.agentIndex,
          reason: "info.structured 缺失",
        })
        return null
      }

      // 无 schema：纯文本模式，直接返回拼接文本。
      return { output: extractOutputText(body), input, output_tokens, model }
    }

    // 理论不可达（循环内必返回）；保险返回 null。
    return null
  }

  async function execute(task: AgentTask): Promise<AgentResult | null> {
    if (destroyed) return null

    // Agent 总数安全阀（R6.10）：达上限抛 AGENT_LIMIT_EXCEEDED。
    if (total >= maxAgents) {
      throw new WorkflowError(
        "AGENT_LIMIT_EXCEEDED",
        `单 Workflow Agent 调用总数达上限 ${maxAgents}（防失控循环安全阀）`,
        { runId: task.runId, agentIndex: task.agentIndex, maxAgents },
      )
    }
    total += 1

    const timeoutMs: number | null =
      Number.isFinite(task.opts.timeout) && (task.opts.timeout as number) > 0
        ? Math.floor(task.opts.timeout as number)
        : defaultTimeout

    // 并发准入：获取槽位（可能等待）。
    await semaphore.acquire()
    active += 1

    let sessionId: string | undefined
    const startTime = Date.now()
    try {
      if (destroyed) return null

      // 1. 创建子 session。
      let created: SdkResult<CreatedSession>
      try {
        created = await client.session.create({
          body: { title: task.opts.label ?? `agent#${task.agentIndex}` },
        })
      } catch (error) {
        // session.create 抛错（R4.2）：记 ERROR(AGENT_SESSION_CREATE_FAILED) 恰一条后返回 null。
        // 在此就地处理并返回，使其不落入下方的通用 catch（避免重复记为 AGENT_SDK_ERROR）。
        log.error(task.runId, "子 session 创建失败（session.create 抛出异常）", {
          eventCode: WORKFLOW_EVENT_CODES.AGENT_SESSION_CREATE_FAILED,
          agentIndex: task.agentIndex,
          reason: error instanceof Error ? error.message : String(error),
        })
        return null // 创建失败：视为该 Agent 失败。
      }
      if (created.error || !created.data?.id) {
        // session.create 返回错误、或返回无有效 id 的 null（R4.2）：记 ERROR 恰一条后返回 null。
        log.error(task.runId, "子 session 创建失败（返回错误或无有效 id）", {
          eventCode: WORKFLOW_EVENT_CODES.AGENT_SESSION_CREATE_FAILED,
          agentIndex: task.agentIndex,
          reason: created.error ? String(created.error) : "session.create 返回无有效 id",
        })
        return null // 创建失败：视为该 Agent 失败。
      }
      sessionId = created.data.id
      activeSessions.add(sessionId)

      // 子 session 创建成功 → 回调通知上层（R 第二期）：在 agent 仍 running 时即落盘
      // sessionID，供 Monitor 实时拉取会话日志。回调异常不影响 agent 执行。
      if (task.onSessionCreated) {
        try {
          task.onSessionCreated(task.agentIndex, sessionId)
        } catch {
          // 静默：回调失败不应中断 agent。
        }
      }

      // 2. 绑定 sessionID → run/phase，使全局 before-tool 分发器可路由（R11.7）。
      extensions.bindSession({
        sessionID: sessionId,
        runId: task.runId,
        phase: task.phase,
        constraints: undefined,
      })

      // 3. 注入系统提示（direct 路径回传 system 入参；transform-hook 路径登记后返回 {}）。
      const baseSystem = buildSystemText(task.opts.schema)
      // 附加 Workflow Pack 贡献的领域系统文本（如金融精度约束，R12.8）。
      const systemText =
        task.extraSystem && task.extraSystem.length > 0
          ? `${baseSystem}\n\n${task.extraSystem}`
          : baseSystem
      const injected = await injector.inject(sessionId, systemText)

      // 4. 阻塞 prompt（含结构化输出原生 format 透传）+ 超时竞速。
      const outcome = await runPrompt(sessionId, task, injected.system, timeoutMs)

      if (outcome === TIMEOUT) {
        // 超时：abort 子 session，返回 null（上层据此记录超时事件到 Journal）。
        // 记 WARN(AGENT_TIMEOUT) 恰一条，含 runId/agentIndex/timeoutMs（R4.4）。
        log.warn(task.runId, "单 Agent 执行超时，触发 session.abort()", {
          eventCode: WORKFLOW_EVENT_CODES.AGENT_TIMEOUT,
          agentIndex: task.agentIndex,
          timeoutMs,
        })
        await safeAbort(sessionId)
        return null
      }

      if (outcome === null) {
        // runPrompt 已对失败分类并记 ERROR(AGENT_SDK_ERROR)（P5-A：非瞬时失败或重试耗尽）。
        // abort 子 session 并返回 null（视为该 Agent 失败，不中断整个 workflow）。
        await safeAbort(sessionId)
        return null
      }

      const durationMs = Date.now() - startTime
      return {
        output: outcome.output,
        tokens: { input: outcome.input, output: outcome.output_tokens },
        durationMs,
        model: outcome.model,
      }
    } catch (error) {
      // AGENT_LIMIT_EXCEEDED 等 WorkflowError 向上抛出；其余未知错误吞为 null
      // （视为该 Agent 失败，不中断整个 workflow）。注：runPrompt 已不再抛
      // SCHEMA_VALIDATION_ERROR（P3-A 改为降级返回 null）。
      if (sessionId) await safeAbort(sessionId)
      if (isWorkflowError(error)) throw error
      // SDK 未知异常被吞为 null（R4.3）：记 ERROR(AGENT_SDK_ERROR) 恰一条。
      // 仅此路径触发——session.create 失败已在上方就地记 AGENT_SESSION_CREATE_FAILED 并返回，
      // 不会落入此处（避免对同一失败重复记两类事件码）。
      log.error(task.runId, "Agent SDK 调用抛出未知异常，已吞为 null", {
        eventCode: WORKFLOW_EVENT_CODES.AGENT_SDK_ERROR,
        agentIndex: task.agentIndex,
        reason: error instanceof Error ? error.message : String(error),
      })
      return null
    } finally {
      if (sessionId) {
        extensions.unbindSession(sessionId)
        activeSessions.delete(sessionId)
      }
      active -= 1
      semaphore.release()
    }
  }

  function activeCount(): number {
    return active
  }

  function totalCount(): number {
    return total
  }

  function reset(): void {
    total = 0
    active = 0
    destroyed = false
  }

  async function destroy(): Promise<void> {
    destroyed = true
    // 级联 abort 所有活跃子 session（cancel/超时路径）。
    const ids = [...activeSessions]
    await Promise.all(ids.map((id) => safeAbort(id)))
  }

  return { execute, activeCount, totalCount, reset, destroy }
}

/** 默认并发：min(16, cpu_cores - 2)，最小 1（仅在未注入共享 Semaphore 时使用）。 */
function defaultConcurrency(): number {
  let cores = 4
  try {
    cores = cpus().length
  } catch {
    // 忽略：保留回退值。
  }
  return Math.max(1, Math.min(16, cores - 2))
}

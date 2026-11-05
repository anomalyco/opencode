/**
 * OpenCode Workflows —— Hook Registry（四类 Hook 注册表 + 顺序执行 + 容错）。
 *
 * 本模块是 Extension_System（task 9.3）的底层构件，只负责两件事：
 * 1. **Hook 数据结构**：按触发时机（timing）分组维护已注册 Hook，并严格保持
 *    **注册顺序**（R11.5）。
 * 2. **四类 Hook 的顺序执行器（runner）**：对同一时机的所有 Hook 按注册顺序
 *    **依次同步**（await 前一个再调用下一个）调用，并按各时机的失败策略容错。
 *
 * 不在本模块职责内（属于 task 9.3 Extension_System）：
 * - 全局 `tool.execute.before` 单分发器（getBinding 网关 + throw 阻断）；
 * - discoverWorkflows / resolveWorkflow / bindSession 等。
 * 本模块仅导出注册表与四个 runner，供 9.3 组合装配；共享 Hook 类型亦在此定义，
 * 由 9.3 直接 import 复用，避免重复声明。
 *
 * 失败策略（design.md「Hook 体系四类」表 + Property 11 + R11.11）：
 * - **before-tool**：任一 Hook reject → 整体 reject（停止后续）。某 Hook 超时
 *   （默认 5000ms）或抛异常 → **安全默认 reject**（停止后续，阻止工具执行），
 *   避免漏过未经检查的写入（R11.11 例外）。
 * - **before-agent**：任一 Hook reject → 返回 reject（调用方据此把 agent() 置 null）。
 *   超时/异常 → **跳过该 Hook 并记录日志，继续**后续 Hook（R11.11 常规规则）。
 * - **after-agent**：支持 `{action:"modify", result}` 改写结果，跨 Hook **链式**传递；
 *   超时/异常 → 跳过并记录、继续。
 * - **workflow-complete**：观察性；超时/异常 → 跳过并记录、继续。
 *
 * 每个 Hook 通过 `Promise.race` + 定时器实现**单 Hook 超时**（默认 5000ms，可由
 * `hook.timeout` 覆盖）。被跳过/出错/触发安全默认 reject 的 Hook 会写入内存日志，
 * 经 `getLog()` 访问（R14.5 可观测性）。
 *
 * @see .kiro/specs/opencode-workflows/design.md — 9. Extension_System / Property 11
 * Requirements: 11.5, 11.6, 11.8, 11.9, 11.10, 11.11, 14.5
 */

import { WorkflowError } from "../errors"
import { WORKFLOW_EVENT_CODES } from "../logging/event-codes"
import { coerceLogger } from "../logging/wf-logger"
import type { AgentOptions } from "../types"
import type { WFLogger } from "../logging/wf-logger"

// ============================================================================
// 共享 Hook 类型（single source of truth；task 9.3 从本文件 import 复用）
// ============================================================================

/** Hook 触发时机四类（R11.5）。 */
export type HookTiming =
  | "before-tool"
  | "before-agent"
  | "after-agent"
  | "workflow-complete"

/**
 * Hook 定义。
 *
 * - `name`：全局唯一名称（R11.5）；重复注册将抛出 `HOOK_ERROR`。
 * - `timing`：四类触发时机之一。
 * - `handler`：Hook 回调，返回与时机匹配的结果对象。
 * - `timeout`：单 Hook 超时阈值（ms），默认 {@link DEFAULT_HOOK_TIMEOUT_MS}（5000）。
 */
export interface HookDefinition {
  name: string
  timing: HookTiming
  handler: HookHandler
  /** 单 Hook 超时阈值（ms），默认 5000ms */
  timeout?: number
}

/** before-tool / before-agent 的决策结果（门控）。 */
export type GateHookResult =
  | { action: "continue" }
  | { action: "reject"; reason: string }

/** after-agent 的结果（可改写返回值）。 */
export type AfterAgentHookResult =
  | { action: "continue" }
  | { action: "modify"; result: unknown }

/** workflow-complete 的结果（观察性）。 */
export type CompleteHookResult = { action: "continue" }

/** Hook 回调签名：接收 {@link HookContext}，返回与时机匹配的结果。 */
export type HookHandler = (
  context: HookContext,
) => Promise<GateHookResult | AfterAgentHookResult | CompleteHookResult>

/**
 * Hook 上下文。
 *
 * 形状对应 design.md「Extension_System」节的 `HookContext`：携带当前子 Agent
 * 所属 run/phase 与触发点相关信息，使 Hook 能识别"属于哪个 workflow 的哪个阶段、
 * 应套用何种约束规则"（R11.7，约束规则由 9.3 经 sessionID 映射注入到 `constraints`）。
 */
export interface HookContext {
  runId: string
  phase: string
  /** before-tool 时为子 Agent 的 sessionID；其余时机为对应 agent 的 sessionID（如已创建） */
  sessionID?: string
  agentIndex?: number
  prompt?: string
  opts?: AgentOptions
  /** before-tool 时的工具调用信息（工具名、入参） */
  tool?: { name: string; input: unknown }
  /** after-agent 时可用 */
  result?: unknown
  /** Extension_System 注入的约束规则（来自 sessionID 映射） */
  constraints?: unknown
}

// ============================================================================
// 日志与常量
// ============================================================================

/** 单 Hook 默认超时阈值（ms）。 */
export const DEFAULT_HOOK_TIMEOUT_MS = 5000

/** Hook 容错日志条目：记录被跳过 / 出错 / 触发安全默认 reject 的 Hook。 */
export interface HookLogEntry {
  /** 出问题的 Hook 所属时机 */
  timing: HookTiming
  /** 出问题的 Hook 名称 */
  hookName: string
  /** 失败原因：超时 or 抛异常 */
  reason: "timeout" | "error"
  /** 对该次失败的处置：跳过（非 before-tool） or 安全默认 reject（before-tool） */
  disposition: "skipped" | "safe-default-reject"
  /** 人类可读的描述信息 */
  message: string
  /** 失败发生的时间戳（ms） */
  timestamp: number
}

// ============================================================================
// Hook 调用结果（内部）
// ============================================================================

type AnyHookResult = GateHookResult | AfterAgentHookResult | CompleteHookResult

/** 单 Hook 调用的内部结果：成功返回值，或失败（超时/异常）。 */
type HookOutcome =
  | { ok: true; value: AnyHookResult }
  | { ok: false; reason: "timeout" | "error"; error?: unknown }

// ============================================================================
// Hook Registry 公开接口
// ============================================================================

/**
 * Hook 注册表 + 四类顺序执行器。
 *
 * 由 {@link createHookRegistry} 创建。task 9.3（Extension_System）在此之上组合
 * 全局 `tool.execute.before` 分发器与 sessionID 映射等。
 */
export interface HookRegistry {
  /** 注册一个 Hook（按时机分组，保持注册顺序）；名称重复抛 `HOOK_ERROR`。 */
  registerHook(hook: HookDefinition): void
  /** 按名称注销 Hook；不存在时静默返回（幂等）。 */
  unregisterHook(name: string): void

  /**
   * before-tool runner：按注册顺序依次同步调用所有 before-tool Hook。
   * - 任一 Hook reject → 立即返回该 reject（停止后续）。
   * - 任一 Hook 超时/异常 → **安全默认 reject**（停止后续，记录日志）。
   * - 全部 continue → 返回 `{ action: "continue" }`。
   */
  runBeforeToolHooks(ctx: HookContext): Promise<GateHookResult>

  /**
   * before-agent runner：按注册顺序依次同步调用所有 before-agent Hook。
   * - 任一 Hook reject → 立即返回该 reject（调用方据此把 agent() 置 null）。
   * - 任一 Hook 超时/异常 → 跳过并记录日志、继续后续 Hook。
   * - 全部 continue → 返回 `{ action: "continue" }`。
   */
  runBeforeAgentHooks(ctx: HookContext): Promise<GateHookResult>

  /**
   * after-agent runner：按注册顺序依次同步调用所有 after-agent Hook，支持
   * `{action:"modify", result}` 链式改写结果（后一 Hook 看到前一 Hook 改写后的结果）。
   * - 超时/异常 → 跳过并记录日志、继续。
   * - 返回最终结果：发生过 modify 则返回 `{action:"modify", result}`，否则
   *   `{action:"continue"}`。
   */
  runAfterAgentHooks(ctx: HookContext): Promise<AfterAgentHookResult>

  /**
   * workflow-complete runner：按注册顺序依次同步调用所有 workflow-complete Hook。
   * 观察性，无返回值；超时/异常 → 跳过并记录日志、继续。
   */
  runWorkflowCompleteHooks(ctx: HookContext): Promise<void>

  /** 返回容错日志的副本（被跳过/出错/安全默认 reject 的 Hook 记录）。 */
  getLog(): HookLogEntry[]
  /** 清空容错日志。 */
  clearLog(): void
}

// ============================================================================
// 工厂实现
// ============================================================================

/**
 * {@link createHookRegistry} 的构造选项。
 *
 * 仅含一个可选的 {@link WFLogger} 注入位。保持无参调用 `createHookRegistry()`
 * 向后兼容（既有调用方/测试不破）。
 */
export interface HookRegistryOptions {
  /**
   * 可选的 WF_Logger 实例（依赖注入，R8.1）。
   *
   * 注入后，Hook 的跳过 / 超时 / 安全默认 reject 在保留容错内存日志
   * （{@link HookRegistry.getLog}）的同时，经 WF_Logger 双写输出（R7.2 / R7.3 /
   * R7.4）：`safe-default-reject` → ERROR(HOOK_SAFE_DEFAULT_REJECT)、`timeout`
   * 跳过 → WARN(HOOK_TIMEOUT)、其余跳过 → WARN(HOOK_SKIPPED)。未注入（或注入
   * 非法值）时经 {@link coerceLogger} 回退 No_Op_Logger，业务行为（跳过/安全默认
   * reject 决策与返回结果）与未引入日志时逐一相同（R7.8 / R8.6）。
   */
  logger?: WFLogger
}

/**
 * 创建一个 Hook 注册表。
 *
 * 内部按 timing 分组存放 Hook 数组，数组顺序即注册顺序（R11.5）。
 *
 * @param options 可选构造选项；`options.logger` 注入 WF_Logger（缺省/非法值经
 *   {@link coerceLogger} 回退 No_Op_Logger）。无参调用向后兼容。
 */
export function createHookRegistry(options?: HookRegistryOptions): HookRegistry {
  // 按时机分组的 Hook 数组；数组顺序 == 注册顺序。
  const hooksByTiming: Record<HookTiming, HookDefinition[]> = {
    "before-tool": [],
    "before-agent": [],
    "after-agent": [],
    "workflow-complete": [],
  }
  // 名称 → 时机，用于唯一性校验与 O(1) 注销定位。
  const nameIndex = new Map<string, HookTiming>()
  // 容错日志（内存）。
  const log: HookLogEntry[] = []
  // 注入式 WF_Logger（R8.1）：未注入/非法值经 coerceLogger 回退 No_Op_Logger（R8.6）。
  const wfLog = coerceLogger(options?.logger)

  function registerHook(hook: HookDefinition): void {
    if (nameIndex.has(hook.name)) {
      throw new WorkflowError(
        "HOOK_ERROR",
        `Hook 名称重复：「${hook.name}」已注册（Hook 名称必须全局唯一）`,
        { hookName: hook.name, timing: hook.timing },
      )
    }
    hooksByTiming[hook.timing].push(hook)
    nameIndex.set(hook.name, hook.timing)
  }

  function unregisterHook(name: string): void {
    const timing = nameIndex.get(name)
    if (timing === undefined) return // 幂等：不存在时静默返回
    const list = hooksByTiming[timing]
    const idx = list.findIndex((h) => h.name === name)
    if (idx >= 0) list.splice(idx, 1)
    nameIndex.delete(name)
  }

  function record(
    ctx: HookContext,
    hook: HookDefinition,
    reason: "timeout" | "error",
    disposition: HookLogEntry["disposition"],
    error?: unknown,
  ): void {
    const detail =
      reason === "timeout"
        ? "执行超时"
        : `执行异常：${errorMessage(error)}`
    const message = `Hook「${hook.name}」（${hook.timing}）${detail} → ${
      disposition === "safe-default-reject" ? "安全默认 reject" : "跳过并继续"
    }`
    // 保留：getLog() 既有条目/返回类型不变（R7.6）。
    log.push({
      timing: hook.timing,
      hookName: hook.name,
      reason,
      disposition,
      message,
      timestamp: Date.now(),
    })
    // 新增：经 WF_Logger 双写（R7.2 / R7.3 / R7.4）。
    // runId 来源（R7.7）：取 ctx.runId；缺失/不可得 → "unknown"。
    const runId =
      typeof ctx.runId === "string" && ctx.runId !== "" ? ctx.runId : "unknown"
    const extra = {
      hookName: hook.name,
      timing: hook.timing,
      reason,
      disposition,
    }
    // 容错语义不变（R7.8）：WF_Logger 永不抛、不改控制流。
    if (disposition === "safe-default-reject") {
      // before-tool 失败（超时/异常）统一安全默认 reject → ERROR（R7.4）。
      wfLog.error(runId, message, {
        ...extra,
        eventCode: WORKFLOW_EVENT_CODES.HOOK_SAFE_DEFAULT_REJECT,
      })
    } else if (reason === "timeout") {
      // 超时跳过 → WARN（R7.3）。
      wfLog.warn(runId, message, {
        ...extra,
        eventCode: WORKFLOW_EVENT_CODES.HOOK_TIMEOUT,
      })
    } else {
      // 其余跳过（异常跳过）→ WARN（R7.2）。
      wfLog.warn(runId, message, {
        ...extra,
        eventCode: WORKFLOW_EVENT_CODES.HOOK_SKIPPED,
      })
    }
  }

  async function runBeforeToolHooks(ctx: HookContext): Promise<GateHookResult> {
    for (const hook of hooksByTiming["before-tool"]) {
      const outcome = await invokeHandler(hook.handler, ctx, hook.timeout)
      if (!outcome.ok) {
        // 安全默认 reject：超时/异常一律阻止工具执行（R11.11 例外）。
        record(ctx, hook, outcome.reason, "safe-default-reject", outcome.error)
        return {
          action: "reject",
          reason: `安全默认 reject：before-tool Hook「${hook.name}」${
            outcome.reason === "timeout" ? "执行超时" : "执行异常"
          }`,
        }
      }
      if (outcome.value.action === "reject") {
        // 任一 Hook 主动 reject → 整体 reject，停止后续。
        return outcome.value
      }
    }
    return { action: "continue" }
  }

  async function runBeforeAgentHooks(ctx: HookContext): Promise<GateHookResult> {
    for (const hook of hooksByTiming["before-agent"]) {
      const outcome = await invokeHandler(hook.handler, ctx, hook.timeout)
      if (!outcome.ok) {
        // 常规规则：跳过并记录、继续后续 Hook。
        record(ctx, hook, outcome.reason, "skipped", outcome.error)
        continue
      }
      if (outcome.value.action === "reject") {
        // 任一 Hook reject → 返回 reject，停止后续（调用方把 agent() 置 null）。
        return outcome.value
      }
    }
    return { action: "continue" }
  }

  async function runAfterAgentHooks(
    ctx: HookContext,
  ): Promise<AfterAgentHookResult> {
    let currentResult = ctx.result
    let modified = false
    for (const hook of hooksByTiming["after-agent"]) {
      // 链式：后一 Hook 看到前一 Hook 改写后的结果。
      const hookCtx: HookContext = { ...ctx, result: currentResult }
      const outcome = await invokeHandler(hook.handler, hookCtx, hook.timeout)
      if (!outcome.ok) {
        record(hookCtx, hook, outcome.reason, "skipped", outcome.error)
        continue
      }
      if (outcome.value.action === "modify") {
        currentResult = (outcome.value as { action: "modify"; result: unknown }).result
        modified = true
      }
    }
    return modified
      ? { action: "modify", result: currentResult }
      : { action: "continue" }
  }

  async function runWorkflowCompleteHooks(ctx: HookContext): Promise<void> {
    for (const hook of hooksByTiming["workflow-complete"]) {
      const outcome = await invokeHandler(hook.handler, ctx, hook.timeout)
      if (!outcome.ok) {
        record(ctx, hook, outcome.reason, "skipped", outcome.error)
        // 观察性：无返回值需处理，继续后续 Hook。
      }
    }
  }

  function getLog(): HookLogEntry[] {
    return log.map((e) => ({ ...e }))
  }

  function clearLog(): void {
    log.length = 0
  }

  return {
    registerHook,
    unregisterHook,
    runBeforeToolHooks,
    runBeforeAgentHooks,
    runAfterAgentHooks,
    runWorkflowCompleteHooks,
    getLog,
    clearLog,
  }
}

// ============================================================================
// 内部工具函数
// ============================================================================

/** 用于超时竞速的哨兵类型。 */
type TimeoutSentinel = { kind: "timeout" }
type ValueSentinel = { kind: "value"; value: AnyHookResult }

/**
 * 在超时阈值内调用单个 Hook handler。
 *
 * @param handler  Hook 回调
 * @param ctx      传入 Hook 的上下文
 * @param timeout  超时阈值（ms）；非有限数或负数时回退默认 5000ms（0 表示立即超时）
 */
async function invokeHandler(
  handler: HookHandler,
  ctx: HookContext,
  timeout: number | undefined,
): Promise<HookOutcome> {
  const timeoutMs =
    typeof timeout === "number" && Number.isFinite(timeout) && timeout >= 0
      ? timeout
      : DEFAULT_HOOK_TIMEOUT_MS

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const raced = await Promise.race<ValueSentinel | TimeoutSentinel>([
      // Promise.resolve 包裹以容纳 handler 的同步 throw（落入下方 catch）
      Promise.resolve(handler(ctx)).then(
        (value): ValueSentinel => ({ kind: "value", value }),
      ),
      new Promise<TimeoutSentinel>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
      }),
    ])
    if (raced.kind === "timeout") {
      return { ok: false, reason: "timeout" }
    }
    return { ok: true, value: raced.value }
  } catch (error) {
    return { ok: false, reason: "error", error }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 从任意抛出物提取可读消息。 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

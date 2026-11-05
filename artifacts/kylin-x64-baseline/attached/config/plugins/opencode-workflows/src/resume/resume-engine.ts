/**
 * OpenCode Workflows —— Resume_Engine（恢复引擎，step 级 + 单点一致性安全网）。
 *
 * Resume_Engine 实现 **step（agent 调用）级**断点续跑：按 `agentIndex` 顺序逐一判定
 * Journal 中每次 agent() 调用的完成状态，并在复用缓存前对**单个** agentIndex 的
 * prompt 与关键 opts 做一致性校验（**不做整脚本/整前缀逐字重放**）。因此本框架
 * **不要求整脚本确定性**（`Date.now()`/`Math.random()` 等仍允许），该单点校验仅作为
 * 调用序漂移的安全网，确保非确定性脚本在漂移时**重新执行**而非返回错配的缓存结果
 * （R8.3-R8.6）。
 *
 * 关键语义：
 * - **last-wins 重建（R8.8）**：从失配点重跑时，新的 started/result 事件以**已存在的**
 *   agentIndex 追加进同一 `journal.jsonl`，导致同一 agentIndex 可能存在多份记录。
 *   {@link ResumeEngine.createContext} 在重建 completion/started 表时对同一 agentIndex
 *   采用**末次出现优先**语义（以文件中最后出现的 started/result 为准），绝不采用被覆盖
 *   的旧记录，避免旧 prompt 误判一致性或复用过期结果。
 * - **completed 判定（R8.3）**：仅当某 agentIndex 的**末次** result 事件**不含 error** 时
 *   视为 completed（可复用）；仅有 started、记录为 failed（含 error）、或超出 Journal
 *   记录范围的调用均判定为需重新执行。
 * - **前缀终止（R8.5）**：{@link ResumeEngine.shouldReuse} 在任一复用边界失配时将
 *   `prefixValid` 置为 false——缓存复用仅适用于**从头连续匹配的前缀**，一旦失配，
 *   其后所有 agent() 调用一律重新执行。
 * - **同步函数（R4.15）**：`shouldReuse`/`getCachedResult` 均为同步函数，使
 *   Orchestration_API 能在 agent() 的同步前导段（首个 await 之前）原子地完成
 *   「分配 agentIndex → 复用判定 → 命中取缓存 → 更新 prefixValid」，并发下无竞态。
 *
 * **RESUME_INVALID（R8.2）**：runId 不存在或其 Journal 缺失/为空时，createContext 抛出
 * {@link WorkflowError}（code `RESUME_INVALID`）。由于 {@link StateStore.readJournal} 在
 * Journal 文件缺失时返回空数组，本模块将「空/缺失 Journal」统一视为 RESUME_INVALID。
 *
 * 注：本模块仅实现 Resume_Engine 核心判定逻辑，StateStore 经工厂参数注入以便测试。
 * Resume step 级判定的属性测试（Property 10）为独立任务（10.2），本模块不含测试。
 *
 * @see .kiro/specs/opencode-workflows/design.md — 7. Resume_Engine
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8
 */

import { WorkflowError } from "../errors"
import type { StateStore } from "../state/state-store"
import type { AgentOptions, AgentResult, JournalEntry } from "../types"

// ============================================================================
// 公开类型
// ============================================================================

/**
 * Journal `agent_started` 事件的精简记录，用于单点一致性校验。
 */
export interface JournalStartedRecord {
  /** Journal started 事件记录的 prompt。 */
  prompt: string
  /** Journal started 事件记录的关键 opts（schema/agentType/model 等影响结果的参数）。 */
  opts?: AgentOptions
}

/**
 * Resume 上下文：承载按 agentIndex 重建的完成状态表与 started 记录表，
 * 以及前缀有效性与游标状态。由 {@link ResumeEngine.createContext} 构建，
 * 在整个 Resume 执行过程中被 {@link ResumeEngine.shouldReuse} 读写。
 */
export interface ResumeContext {
  /** agentIndex → 完成状态（completed 表示该 index 的末次 result 事件不含 error）。 */
  completion: Map<number, { status: "completed"; result: AgentResult }>
  /** agentIndex → started 记录（用于单点一致性校验）。 */
  started: Map<number, JournalStartedRecord>
  /**
   * 缓存前缀是否仍然有效：一旦某 agentIndex 失配（缺 result 或 prompt/opts 不一致），
   * 置为 false；其后所有调用一律重新执行（前缀终止语义，R8.5）。
   */
  prefixValid: boolean
  /** 当前 agent 调用序号游标（由消费方 Orchestration_API 维护推进）。 */
  cursor: number
}

/**
 * Resume_Engine 公开接口。签名严格对应 design.md「7. Resume_Engine」。
 */
export interface ResumeEngine {
  /**
   * 加载指定 runId 的 Journal 并按 agentIndex 以 last-wins 重建完成状态表与 started
   * 记录表（R8.1、R8.8）。
   *
   * @param runId 不含 `wf_` 前缀的 runId。
   * @returns 初始化的 {@link ResumeContext}（prefixValid=true、cursor=0）。
   * @throws {WorkflowError} code `RESUME_INVALID` —— runId 不存在或 Journal 缺失/为空（R8.2）。
   */
  createContext(runId: string): Promise<ResumeContext>
  /**
   * 判断指定 agentIndex 是否可复用缓存（**同步**，R4.15）。
   *
   * 返回 true 当且仅当：(1) `ctx.prefixValid` 仍为 true；(2) 该 agentIndex 已记录
   * completed 结果；(3) `currentPrompt` 与该 agentIndex 的 started.prompt 一致；
   * (4) `currentOpts` 的关键字段（schema/agentType/model）与 started.opts 一致。
   * 任一不满足则返回 false 并将 `ctx.prefixValid` 置为 false（前缀终止，R8.5）。
   */
  shouldReuse(
    ctx: ResumeContext,
    agentIndex: number,
    currentPrompt: string,
    currentOpts?: AgentOptions,
  ): boolean
  /**
   * 获取指定 agentIndex 的缓存结果（仅在 {@link ResumeEngine.shouldReuse} 返回 true 后调用）。
   *
   * @throws {WorkflowError} code `RESUME_INVALID` —— 该 agentIndex 无可复用缓存结果（防御性）。
   */
  getCachedResult(ctx: ResumeContext, agentIndex: number): AgentResult
}

// ============================================================================
// 内部辅助
// ============================================================================

/**
 * 针对 JSON 安全值（schema 对象等）的聚焦深比较。
 *
 * 处理原始值、数组与普通对象的结构相等；不处理函数、循环引用、`Map`/`Set` 等
 * 非 JSON 结构（JSON Schema 不含这些）。`undefined` 双方相等（用于 schema 缺省比较）。
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  // 走到此处说明 a !== b：任一为 null（含 undefined 与 null 互比）即不等。
  if (a === null || b === null || a === undefined || b === undefined) {
    return false
  }
  if (typeof a !== typeof b) {
    return false
  }
  if (typeof a !== "object") {
    // 非 === 的原始值（string/number/boolean 等）判为不等。
    return false
  }
  const aIsArray = Array.isArray(a)
  const bIsArray = Array.isArray(b)
  if (aIsArray !== bIsArray) {
    return false
  }
  if (aIsArray && bIsArray) {
    if (a.length !== b.length) {
      return false
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) {
        return false
      }
    }
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const aKeys = Object.keys(ao)
  const bKeys = Object.keys(bo)
  if (aKeys.length !== bKeys.length) {
    return false
  }
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, key)) {
      return false
    }
    if (!deepEqual(ao[key], bo[key])) {
      return false
    }
  }
  return true
}

/**
 * 比较两个 opts 的**关键字段**是否一致：仅 schema（深比较）、agentType、model。
 *
 * 其余字段（label、phase、timeout）不影响结果身份，故排除在一致性校验之外
 * （R8.4：仅比对「影响结果的参数」）。任一方为 undefined 时按字段缺省处理。
 */
function keyOptsMatch(a: AgentOptions | undefined, b: AgentOptions | undefined): boolean {
  if (!deepEqual(a?.schema, b?.schema)) {
    return false
  }
  if (a?.agentType !== b?.agentType) {
    return false
  }
  if (a?.model !== b?.model) {
    return false
  }
  return true
}

/**
 * 由 Journal `agent_result` 事件与对应 started 记录重建 {@link AgentResult}。
 *
 * model 优先取 result 事件的 `model` 字段（真实执行模型，providerID/modelID——
 * 修复前 Journal 不记此字段，resume 复用的 agent 在 Monitor 显示 "—"）；
 * 旧 Journal（无此字段）回退 started 记录 `opts.model`，再回退空串。
 */
function toAgentResult(
  resultEntry: JournalEntry,
  startedRecord: JournalStartedRecord | undefined,
): AgentResult {
  return {
    output: resultEntry.result,
    tokens: {
      input: resultEntry.input_tokens ?? 0,
      output: resultEntry.output_tokens ?? 0,
    },
    durationMs: resultEntry.durationMs ?? 0,
    model: resultEntry.model ?? startedRecord?.opts?.model ?? "",
  }
}

// ============================================================================
// 工厂
// ============================================================================

/**
 * 创建 Resume_Engine 实例。
 *
 * @param store 注入的 {@link StateStore}（经由 `readJournal` 读取 Journal）；
 *   注入式设计便于属性测试（任务 10.2）提供 fake store。
 */
export function createResumeEngine(store: StateStore): ResumeEngine {
  async function createContext(runId: string): Promise<ResumeContext> {
    // runId 缺省即 RESUME_INVALID（R8.2）。
    if (!runId) {
      throw new WorkflowError("RESUME_INVALID", "runId 无效：未提供 runId", { runId })
    }

    const entries = await store.readJournal(runId)
    // readJournal 在 Journal 文件缺失时返回 []；空/缺失 Journal 统一视为 RESUME_INVALID（R8.2）。
    if (entries.length === 0) {
      throw new WorkflowError(
        "RESUME_INVALID",
        `runId 无效或 Journal 不可用：${runId}`,
        { runId },
      )
    }

    // last-wins 重建（R8.8）：按文件顺序遍历，同一 agentIndex 的后出现记录覆盖先出现记录。
    const started = new Map<number, JournalStartedRecord>()
    const lastResult = new Map<number, JournalEntry>()
    for (const entry of entries) {
      if (entry.eventType === "agent_started") {
        started.set(entry.agentIndex, { prompt: entry.prompt ?? "", opts: entry.opts })
      } else if (entry.eventType === "agent_result") {
        lastResult.set(entry.agentIndex, entry)
      }
    }

    // 仅末次 result 事件不含 error 的 agentIndex 视为 completed（R8.3）。
    const completion = new Map<number, { status: "completed"; result: AgentResult }>()
    for (const [agentIndex, resultEntry] of lastResult) {
      if (resultEntry.error != null) {
        // 末次记录为 failed → 需重新执行，不进入复用表。
        continue
      }
      completion.set(agentIndex, {
        status: "completed",
        result: toAgentResult(resultEntry, started.get(agentIndex)),
      })
    }

    return { completion, started, prefixValid: true, cursor: 0 }
  }

  function shouldReuse(
    ctx: ResumeContext,
    agentIndex: number,
    currentPrompt: string,
    currentOpts?: AgentOptions,
  ): boolean {
    // 前缀已终止：其后一律重新执行（prefixValid 已为 false，无需再置）。
    if (!ctx.prefixValid) {
      return false
    }

    const completed = ctx.completion.get(agentIndex)
    const startedRecord = ctx.started.get(agentIndex)

    // 复用条件：该 index 已 completed、存在 started 记录、prompt 一致、关键 opts 一致。
    const reusable =
      completed !== undefined &&
      startedRecord !== undefined &&
      currentPrompt === startedRecord.prompt &&
      keyOptsMatch(currentOpts, startedRecord.opts)

    if (!reusable) {
      // 失配 → 前缀终止：从该 agentIndex 起及其后全部重新执行（R8.5）。
      ctx.prefixValid = false
      return false
    }

    return true
  }

  function getCachedResult(ctx: ResumeContext, agentIndex: number): AgentResult {
    const completed = ctx.completion.get(agentIndex)
    if (completed === undefined) {
      // 防御性：仅应在 shouldReuse 返回 true 后调用；否则属调用方违约。
      throw new WorkflowError(
        "RESUME_INVALID",
        `agentIndex ${agentIndex} 无可复用的缓存结果`,
        { agentIndex },
      )
    }
    return completed.result
  }

  return { createContext, shouldReuse, getCachedResult }
}

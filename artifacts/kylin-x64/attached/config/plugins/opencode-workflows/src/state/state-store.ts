/**
 * OpenCode Workflows —— State_Store（状态存储）核心实现。
 *
 * State_Store 负责将每次 Workflow 执行的完整状态持久化到中立命名空间
 * `.opencode/workflows/` 下三类产物，支持审计、Resume 恢复与实时进度追踪：
 *
 * - **Run Snapshot**：`<storageRoot>/runs/wf_<runId>.json`，记录某次运行的
 *   完整快照（status、result、error、agentCount、totalTokens、phases、
 *   workflowProgress、logs 等）。`wf_` 前缀仅用于文件名，runId 字段本身不含前缀。
 * - **Journal**：`<storageRoot>/journal/<runId>/journal.jsonl`，按事件**实际发生
 *   顺序** append 的 JSONL，agentIndex 作为对齐键（而非文件行顺序）。
 * - **Script Archive**：`<storageRoot>/scripts/<name>-wf_<runId>.mjs`，脚本完整副本；
 *   Snapshot 内嵌的 `script` 字段为审计用副本，超过可配置阈值时截断，完整来源以
 *   归档文件（scriptPath）为准（R7.2）。
 *
 * 关键行为：
 * - **即时落盘（R3.7）**：每次 createRun / 状态变更 / 进度更新 / agent() 完成都立即
 *   写盘（不仅保存在内存），以保证进程崩溃或重启后可通过 Resume 恢复。
 * - **状态机（R7.3）**：`running → completed | failed | cancelled`，终态不回退——
 *   一旦进入终态，后续 complete/fail/cancel/status 变更一律忽略。
 * - **持久化失败容错（R7.7）**：所有文件写入以 try/catch 包裹；写入失败时记录到
 *   内存日志（{@link StateStore.getMemoryLog}）并继续执行，不抛出、不中断业务流程。
 *
 * 注：本模块仅实现 State_Store 核心读写与状态机。totalTokens 的**聚合逻辑**由
 * 独立模块 token-aggregator（任务 6.5）负责，本模块只存储该字段。状态生命周期、
 * Journal 配对、Log 持久化的属性测试为独立任务（6.2/6.3/6.4），本模块不含测试。
 *
 * @see .kiro/specs/opencode-workflows/design.md — 6. State_Store / Data Models
 * Requirements: 3.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 13.5
 */

import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { WorkflowError } from "../errors"
import { WORKFLOW_EVENT_CODES } from "../logging/event-codes"
import { coerceLogger } from "../logging/wf-logger"
import type { WFLogger } from "../logging/wf-logger"
import type {
  AgentProgress,
  JournalEntry,
  PhaseProgress,
  ProgressEntry,
  RunSnapshot,
  RunStatus,
  WorkflowMeta,
} from "../types"
import { generateRunId, toRunFileBase, toScriptFileBase } from "./run-id"

// ============================================================================
// 常量与默认配置
// ============================================================================

/** 持久化根目录默认值（中立命名空间，所有 workflow 共用）。 */
export const DEFAULT_STORAGE_ROOT = ".opencode/workflows"

/**
 * Snapshot 内嵌脚本副本的默认截断阈值（字节）。
 *
 * 超过该阈值时，`script` 字段被截断并附加提示，完整脚本以 `scriptPath` 指向的
 * 归档文件为准（R7.2）。默认 64 KiB，可经 {@link StateStoreOptions} 配置。
 */
export const DEFAULT_MAX_EMBEDDED_SCRIPT_BYTES = 64 * 1024

/** Run 标签（需求原文）落盘的字符上限。超长截断加省略号，防止超长文本写入快照。 */
export const MAX_LABEL_LEN = 200

/** 持久化失败内存日志的环形上限（L 级修复）：长驻进程下防 memoryLog 无界增长，仅保留最近 N 条。 */
const MEMORY_LOG_MAX = 1000

/** 内嵌脚本被截断时附加在末尾的提示（完整脚本见 scriptPath 归档文件）。 */
const SCRIPT_TRUNCATION_NOTICE =
  "\n\n/* …(脚本内嵌副本已截断，完整脚本见 Snapshot.scriptPath 指向的归档文件) */\n"

/** 运行期终态集合；进入任一终态后状态不再回退（R7.3）。 */
const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
])

function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

// ============================================================================
// 公开接口
// ============================================================================

/**
 * State_Store 可选配置。
 */
export interface StateStoreOptions {
  /**
   * Snapshot 内嵌脚本副本的截断阈值（字节）；默认
   * {@link DEFAULT_MAX_EMBEDDED_SCRIPT_BYTES}（64 KiB）。
   */
  maxEmbeddedScriptBytes?: number
  /**
   * 可选的 WF_Logger 实例（依赖注入，R8.1）。
   *
   * 注入后，持久化失败（`recordFailure`）在保留内存日志（{@link StateStore.getMemoryLog}）
   * 的同时，经 WF_Logger 以 `ERROR` 级别双写输出（R7.1）。未注入（或注入非法值）时
   * 经 {@link coerceLogger} 回退 No_Op_Logger，业务行为与未引入日志时逐一相同（R8.6）。
   */
  logger?: WFLogger
}

/**
 * State_Store 公开接口。
 *
 * 签名严格对应 design.md「6. State_Store」的 `StateStore` 接口；额外提供
 * {@link StateStore.getMemoryLog} 以暴露 R7.7 的持久化失败内存日志，供上层观测/诊断。
 */
export interface StateStore {
  /** 创建新 Run：生成 runId、写初始 Snapshot（status=running）并即时落盘，返回 runId（不含 wf_ 前缀）。可选 `label` 存需求原文（截断展示用），可选 `args` 存完整原始入参（resume 重建 prompt 用）。 */
  createRun(meta: WorkflowMeta, scriptPath: string, script: string, label?: string, args?: unknown): Promise<string>
  /** 局部更新 Snapshot 字段并即时落盘；终态下的 status 回退将被忽略（R7.3）。 */
  updateRun(runId: string, updates: Partial<RunSnapshot>): Promise<void>
  /** 标记完成：status=completed，写 result/endTime/durationMs；终态不回退。 */
  completeRun(runId: string, result: unknown): Promise<void>
  /** 标记失败：status=failed，写 error/endTime/durationMs；终态不回退。 */
  failRun(runId: string, error: string): Promise<void>
  /** 标记取消：status=cancelled，写 endTime/durationMs；终态不回退。 */
  cancelRun(runId: string): Promise<void>
  /**
   * **显式复活**一个 run：将状态强制置回 `running` 并复位 `endTime`/`durationMs`/`error`，
   * **绕过终态守卫**。专用于 `resume` 对非 running（含终态 `failed`/`cancelled`）run 的
   * 显式复活（R4.4：resume 校验非 running，paused/failed/cancelled 均可续跑）。
   *
   * 与 {@link StateStore.updateRun} 的语义区分：`updateRun` 的状态机守卫**永不**让终态
   * 回退（R7.3，Property 14）；`reviveRun` 是**用户显式 resume 意图**触发的复活，故有意
   * 绕过该守卫。run 不存在时记录内存日志并忽略（不抛）。
   */
  reviveRun(runId: string): Promise<void>
  /**
   * 删除某 run 的全部产物：`runs/wf_<runId>.json`、`journal/<runId>/`（递归整目录）、
   * `scripts/<name>-wf_<runId>.mjs`，并清除内存 cache 条目（R6.1）。
   *
   * - **running 守卫（R6.2）**：目标 run 处于 `running` 时拒绝并抛
   *   {@link WorkflowError}（`RUN_NOT_DELETABLE`），不删除任何产物（D3：禁止删 running）。
   * - **幂等（R6.3）**：缺失的产物文件/目录不报错；run 不存在或重复删除均静默通过。
   * - **持久化失败容错（R6.4）**：删除过程中的非 ENOENT 异常记入内存日志
   *   （{@link StateStore.getMemoryLog}），不中断、不抛出（running 守卫除外）。
   */
  deleteRun(runId: string): Promise<void>
  /** 读取指定 Run Snapshot；不存在返回 null。 */
  getRun(runId: string): Promise<RunSnapshot | null>
  /** 列出最近的 Runs（按 startTime 降序）；limit ≤ 0 表示不限制。 */
  listRuns(limit: number): Promise<RunSnapshot[]>
  /**
   * 刷新指定 run 的心跳时间戳（{@link RunSnapshot.heartbeatAt}）并即时落盘。
   *
   * 仅对**非终态**（running）run 生效；终态 run 忽略（避免无谓写盘与状态扰动）。
   * run 不存在时记录内存日志并忽略。供后台执行进程定期调用以宣告存活（crash recovery）。
   *
   * @param runId 目标 run。
   * @param now 时间戳（ms），默认 `Date.now()`；显式传入便于测试。
   */
  heartbeat(runId: string, now?: number): Promise<void>
  /**
   * 扫描所有 `status==="running"` 的快照，将**心跳停滞超过 `timeoutMs`** 的判定为
   * 孤儿（持有进程已崩溃/退出），标记为 `failed` 并写入 error。返回被回收的 runId 列表。
   *
   * 判活基准：`heartbeatAt`（缺省回退 `startTime`）。`now - 基准 > timeoutMs` 即为孤儿。
   * `timeoutMs <= 0` 时视为关闭，直接返回空数组（不回收）。
   *
   * @param timeoutMs 孤儿超时阈值（ms）。
   * @param now 当前时间戳（ms），默认 `Date.now()`；显式传入便于测试。
   * @returns 被标记为 failed 的孤儿 runId 列表。
   */
  recoverOrphans(timeoutMs: number, now?: number): Promise<string[]>
  /** 向 Journal 追加一条事件（JSONL，按实际发生顺序 append）。 */
  appendJournal(runId: string, entry: JournalEntry): Promise<void>
  /** 读取并解析 Journal 全部事件；文件缺失返回空数组。 */
  readJournal(runId: string): Promise<JournalEntry[]>
  /** 归档脚本完整副本到 scripts/，返回归档文件路径。 */
  persistScript(name: string, runId: string, script: string): Promise<string>
  /**
   * 派生归档脚本副本的绝对路径（纯路径计算，不做 I/O）：`scripts/<name>-wf_<runId>.mjs`。
   * 供 resume 在源脚本缺失时回退加载归档副本（L 级修复，保证「归档可复现」）。
   */
  archivedScriptPath(name: string, runId: string): string
  /** 追加一条进度条目到 workflowProgress 并即时落盘。 */
  appendProgress(runId: string, entry: ProgressEntry): Promise<void>
  /** 更新指定 index 的 workflow_agent 进度条目并即时落盘。 */
  updateProgress(runId: string, index: number, updates: Partial<AgentProgress>): Promise<void>
  /** 追加一条日志到 Snapshot.logs 并即时落盘。 */
  appendLog(runId: string, message: string): Promise<void>
  /**
   * 返回持久化失败内存日志的只读快照（R7.7）。
   *
   * 当 Snapshot/Journal/Script 写入失败时，错误被记录到此内存日志而非抛出，
   * 业务流程继续。该方法供上层（如 TUI/诊断）观测持久化健康度。
   */
  getMemoryLog(): readonly string[]
}

// ============================================================================
// 工厂
// ============================================================================

/**
 * 创建 State_Store 实例。
 *
 * @param storageRoot 持久化根目录，默认 {@link DEFAULT_STORAGE_ROOT}（`.opencode/workflows`）。
 * @param options 可选配置（如内嵌脚本截断阈值）。
 */
export function createStateStore(
  storageRoot: string = DEFAULT_STORAGE_ROOT,
  options: StateStoreOptions = {},
): StateStore {
  const maxEmbeddedScriptBytes =
    Number.isFinite(options.maxEmbeddedScriptBytes) &&
    (options.maxEmbeddedScriptBytes as number) >= 0
      ? Math.floor(options.maxEmbeddedScriptBytes as number)
      : DEFAULT_MAX_EMBEDDED_SCRIPT_BYTES

  // 注入式 WF_Logger（R8.1）：未注入/非法值经 coerceLogger 回退 No_Op_Logger（R8.6）。
  const log = coerceLogger(options.logger)

  /**
   * Snapshot 内存缓存：runId → 最新快照。
   *
   * 即时落盘的同时维护内存副本，使读取无需每次回盘；当写盘失败时（R7.7），
   * 内存副本仍持有最新状态，避免后续 update 基于过期磁盘内容。
   */
  const cache = new Map<string, RunSnapshot>()

  /** 持久化失败内存日志（R7.7）。环形上限见 {@link MEMORY_LOG_MAX}（L 级修复：防无界增长）。 */
  const memoryLog: string[] = []

  /**
   * per-runId 串行写队列（M1 修复）：所有「读-改-写」操作（updateRun/finalize/reviveRun/
   * heartbeat/appendProgress/updateProgress/appendLog/deleteRun）按 runId 排队执行，消除
   * 「getRun → merge → commit」的丢失更新与终态回退竞态：
   *
   * - **丢失更新**：并行 agent 同时 appendProgress，原先两者基于同一旧快照合并、后写覆盖前写
   *   → 丢进度条目；串行后 op2 的 getRun 必见 op1 已 commit 的结果。
   * - **终态回退竞态**：heartbeat 读到过期快照后 commit({...旧, heartbeatAt}) 可能把 completed
   *   翻回 running（其终态检查基于过期快照）；串行后 heartbeat 必见最新终态、被守卫拦截。
   *
   * 实现：每个 runId 维护一条 promise 链尾；新操作 `prev.then(op)` 接在链尾后。链尾经
   * `.then(noop, noop)` 吞掉结果与异常（前一个 op 的 reject 不阻断/污染后续）。链尾 settle
   * 且仍为当前尾时删除 Map 条目，避免长跑进程内存泄漏。
   */
  const writeChains = new Map<string, Promise<unknown>>()
  function withRunLock<T>(runId: string, op: () => Promise<T>): Promise<T> {
    const prev = writeChains.get(runId) ?? Promise.resolve()
    const result = prev.then(op)
    const settled = result.then(
      () => {},
      () => {},
    )
    writeChains.set(runId, settled)
    void settled.then(() => {
      if (writeChains.get(runId) === settled) writeChains.delete(runId)
    })
    return result
  }

  // ---- 路径派生（wf_ 前缀仅用于文件名；journal 目录用裸 runId） ----
  const runsDir = () => join(storageRoot, "runs")
  const snapshotPath = (runId: string) => join(runsDir(), `${toRunFileBase(runId)}.json`)
  const journalDir = (runId: string) => join(storageRoot, "journal", runId)
  const journalFile = (runId: string) => join(journalDir(runId), "journal.jsonl")
  const scriptsDir = () => join(storageRoot, "scripts")
  const scriptArchivePath = (name: string, runId: string) =>
    join(scriptsDir(), `${toScriptFileBase(name, runId)}.mjs`)

  function recordFailure(operation: string, error: unknown, runId?: string): void {
    const reason = error instanceof Error ? error.message : String(error)
    const line = `[${new Date().toISOString()}] ${operation} failed: ${reason}`
    // 保留：getMemoryLog() 既有条目/返回类型不变（R7.5）。
    memoryLog.push(line)
    // 环形上限（L 级修复）：TUI 为长驻进程，持久化持续故障（如磁盘满）会让 memoryLog 无界增长。
    // 超过上限时丢弃最旧条目，仅保留最近 MEMORY_LOG_MAX 条。
    if (memoryLog.length > MEMORY_LOG_MAX) {
      memoryLog.splice(0, memoryLog.length - MEMORY_LOG_MAX)
    }
    // 新增：经 WF_Logger 以 ERROR 双写（R4.9 / R7.1）；message 与内存条目一致。
    // 容错语义不变（R7.8）：WF_Logger 永不抛、不改控制流。
    log.error(runId ?? "unknown", line, {
      eventCode: WORKFLOW_EVENT_CODES.PERSIST_FAILED,
      operation,
    })
  }

  async function ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true })
  }

  /**
   * 即时落盘 Snapshot（R3.7）。写入失败时记录内存日志并继续（R7.7），不抛出。
   */
  async function persistSnapshot(snapshot: RunSnapshot): Promise<void> {
    try {
      await ensureDir(runsDir())
      await writeFile(snapshotPath(snapshot.runId), JSON.stringify(snapshot, null, 2), "utf8")
    } catch (error) {
      recordFailure(`persistSnapshot(${snapshot.runId})`, error, snapshot.runId)
    }
  }

  /** 设置缓存并即时落盘的统一出口。 */
  async function commit(snapshot: RunSnapshot): Promise<void> {
    cache.set(snapshot.runId, snapshot)
    await persistSnapshot(snapshot)
  }

  /**
   * 截断内嵌脚本副本到字节阈值内（R7.2）。
   *
   * 以二分查找定位不超出预算的最大字符前缀（避免在多字节字符中间截断），
   * 再附加截断提示。未超阈值时原样返回。
   */
  function truncateEmbeddedScript(script: string): string {
    if (Buffer.byteLength(script, "utf8") <= maxEmbeddedScriptBytes) {
      return script
    }
    const noticeBytes = Buffer.byteLength(SCRIPT_TRUNCATION_NOTICE, "utf8")
    const budget = Math.max(0, maxEmbeddedScriptBytes - noticeBytes)
    let lo = 0
    let hi = script.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (Buffer.byteLength(script.slice(0, mid), "utf8") <= budget) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return script.slice(0, lo) + SCRIPT_TRUNCATION_NOTICE
  }

  /**
   * 截断 run 标签（需求原文）到 {@link MAX_LABEL_LEN} 字符上限，超长加省略号。
   * 仅做长度兜底（防超长文本落盘）；展示侧的「智能提取」由 `deriveRunLabel()` 负责。
   */
  function truncateLabel(label: string): string {
    const collapsed = label.replace(/\s+/g, " ").trim()
    return collapsed.length > MAX_LABEL_LEN ? `${collapsed.slice(0, MAX_LABEL_LEN)}…` : collapsed
  }

  // -------------------------------------------------------------------------
  // Run 生命周期
  // -------------------------------------------------------------------------

  async function createRun(
    meta: WorkflowMeta,
    scriptPath: string,
    script: string,
    label?: string,
    args?: unknown,
  ): Promise<string> {
    const runId = generateRunId()
    const startTime = Date.now()
    const snapshot: RunSnapshot = {
      runId,
      workflowName: meta.name,
      status: "running",
      ...(typeof label === "string" && label.length > 0 ? { label: truncateLabel(label) } : {}),
      // 完整原始 args（resume 重建 prompt 用）：经 JSON 往返过滤不可序列化值；
      // 失败（循环引用等）则省略，resume 时回退既有行为（label 仍保证 output_path）。
      ...(() => {
        if (args === undefined) return {}
        try {
          return { args: JSON.parse(JSON.stringify(args)) as unknown }
        } catch {
          return {}
        }
      })(),
      script: truncateEmbeddedScript(script),
      scriptPath,
      result: null,
      error: null,
      startTime,
      endTime: null,
      durationMs: null,
      agentCount: 0,
      totalTokens: 0,
      phases: meta.phases ?? [],
      workflowProgress: [],
      logs: [],
    }
    await commit(snapshot)
    return runId
  }

  async function updateRun(runId: string, updates: Partial<RunSnapshot>): Promise<void> {
    return withRunLock(runId, async () => {
      const current = await getRun(runId)
      if (!current) {
        recordFailure(`updateRun(${runId})`, "run not found", runId)
        return
      }
      const merged: RunSnapshot = { ...current, ...updates, runId: current.runId }
      // 状态机守卫：终态下忽略 status 回退（R7.3）。
      if (isTerminalStatus(current.status)) {
        merged.status = current.status
      }
      await commit(merged)
    })
  }

  /**
   * 终态转换统一实现：守卫终态不回退，写入新终态及结束时间字段后即时落盘。
   */
  async function finalize(
    runId: string,
    operation: string,
    patch: { status: RunStatus; result?: unknown; error?: string },
  ): Promise<void> {
    return withRunLock(runId, async () => {
      const current = await getRun(runId)
      if (!current) {
        recordFailure(operation, "run not found", runId)
        return
      }
      // 终态不回退：已是终态则忽略后续转换（R7.3）。
      if (isTerminalStatus(current.status)) {
        return
      }
      const endTime = Date.now()
      const next: RunSnapshot = {
        ...current,
        status: patch.status,
        endTime,
        durationMs: endTime - current.startTime,
      }
      if ("result" in patch) {
        next.result = patch.result
      }
      if (patch.error !== undefined) {
        next.error = patch.error
      }
      await commit(next)
    })
  }

  async function completeRun(runId: string, result: unknown): Promise<void> {
    await finalize(runId, `completeRun(${runId})`, { status: "completed", result })
  }

  async function failRun(runId: string, error: string): Promise<void> {
    await finalize(runId, `failRun(${runId})`, { status: "failed", error })
  }

  async function cancelRun(runId: string): Promise<void> {
    await finalize(runId, `cancelRun(${runId})`, { status: "cancelled" })
  }

  /**
   * 显式复活：将 run 强制置回 running 并复位 endTime/durationMs/error，**绕过终态守卫**。
   * 专供 resume 对非 running（含终态）run 的显式复活使用（R4.4）。
   * run 不存在记内存日志并忽略。
   */
  async function reviveRun(runId: string): Promise<void> {
    return withRunLock(runId, async () => {
      const current = await getRun(runId)
      if (!current) {
        recordFailure(`reviveRun(${runId})`, "run not found", runId)
        return
      }
      await commit({
        ...current,
        status: "running",
        endTime: null,
        durationMs: null,
        error: null,
      })
    })
  }

  /**
   * 删除某 run 的全部产物（snapshot / journal 目录 / script 归档）并清缓存（R6.1–R6.4）。
   *
   * 流程：
   * 1. `getRun(runId)`：若 `status==="running"` → 抛 `RUN_NOT_DELETABLE`（D3，唯一会抛出的路径）。
   * 2. 依次删除 `runs/wf_<runId>.json`、`journal/<runId>/`（递归）、
   *    `scripts/<workflowName>-wf_<runId>.mjs`；用 `force:true` 忽略缺失（ENOENT）。
   * 3. `cache.delete(runId)` 清内存条目。
   *
   * 每类产物删除独立 try/catch，单类失败不阻断其余；非 ENOENT 异常记入内存日志（recordFailure），
   * 不中断、不抛出（running 守卫除外）。run 不存在时仍清缓存并返回（幂等）。
   */
  async function deleteRun(runId: string): Promise<void> {
    return withRunLock(runId, async () => {
      const current = await getRun(runId)
      // running/pausing 守卫（R6.2 / D3 / FIX-1）：唯一会抛出的路径，且不删除任何产物。
      // pausing（暂停途中）仍持有活动执行体，删除其产物同样危险，与 running 同等保护。
      if (current?.status === "running" || current?.status === "pausing") {
        throw new WorkflowError(
          "RUN_NOT_DELETABLE",
          `禁止删除运行中/暂停途中的 run（status=${current.status}）；请先 cancel 或等其落 paused 后再删除：${runId}`,
          { runId },
        )
      }
      // snapshot 文件（force 忽略 ENOENT，缺失不报错）。
      try {
        await rm(snapshotPath(runId), { force: true })
      } catch (error) {
        recordFailure(`deleteRun(${runId}) snapshot`, error, runId)
      }
      // journal 目录（递归整目录删除；force 忽略 ENOENT）。
      try {
        await rm(journalDir(runId), { recursive: true, force: true })
      } catch (error) {
        recordFailure(`deleteRun(${runId}) journal`, error, runId)
      }
      // script 归档（路径依赖 workflowName；快照缺失则无从定位，跳过脚本删除）。
      if (current) {
        try {
          await rm(scriptArchivePath(current.workflowName, runId), { force: true })
        } catch (error) {
          recordFailure(`deleteRun(${runId}) script`, error, runId)
        }
      }
      // 清内存 cache 条目（R6.1）。
      cache.delete(runId)
    })
  }

  async function getRun(runId: string): Promise<RunSnapshot | null> {
    const cached = cache.get(runId)
    if (cached) {
      return cached
    }
    try {
      const text = await readFile(snapshotPath(runId), "utf8")
      const parsed = JSON.parse(text) as RunSnapshot
      cache.set(runId, parsed)
      return parsed
    } catch {
      // 文件缺失/不可读/解析失败：视为不存在（不记内存日志，属正常 not-found 路径）。
      return null
    }
  }

  async function listRuns(limit: number): Promise<RunSnapshot[]> {
    const byRunId = new Map<string, RunSnapshot>()
    try {
      const files = await readdir(runsDir())
      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue
        }
        try {
          const text = await readFile(join(runsDir(), file), "utf8")
          const parsed = JSON.parse(text) as RunSnapshot
          if (parsed && typeof parsed.runId === "string") {
            byRunId.set(parsed.runId, parsed)
          }
        } catch (error) {
          recordFailure(`listRuns(read ${file})`, error)
        }
      }
    } catch {
      // runs 目录尚不存在：返回（叠加缓存后的）已知内容。
    }
    // 叠加内存缓存的最新状态，覆盖可能落后的磁盘副本（含写盘失败场景）。
    for (const [runId, snapshot] of cache) {
      byRunId.set(runId, snapshot)
    }
    const all = [...byRunId.values()].sort((a, b) => b.startTime - a.startTime)
    return limit > 0 ? all.slice(0, limit) : all
  }

  async function heartbeat(runId: string, now: number = Date.now()): Promise<void> {
    return withRunLock(runId, async () => {
      const current = await getRun(runId)
      if (!current) {
        recordFailure(`heartbeat(${runId})`, "run not found", runId)
        return
      }
      // 仅 running 刷新心跳；终态忽略（不复活、不扰动）。串行化后此处必见最新终态，
      // 杜绝「读到过期 running 快照 → commit 把 completed 翻回 running」的回退竞态（M1）。
      if (isTerminalStatus(current.status)) {
        return
      }
      await commit({ ...current, heartbeatAt: now })
    })
  }

  async function recoverOrphans(timeoutMs: number, now: number = Date.now()): Promise<string[]> {
    // 关闭语义：阈值非正数直接不回收。
    if (!(timeoutMs > 0)) {
      return []
    }
    // 全量列出（limit<=0 不截断），仅处理 running。
    const runs = await listRuns(0)
    const recovered: string[] = []
    for (const run of runs) {
      if (run.status !== "running") {
        continue
      }
      // 判活基准：心跳缺省回退 startTime（兼容旧 Snapshot 无 heartbeatAt）。
      const lastAlive =
        typeof run.heartbeatAt === "number" ? run.heartbeatAt : run.startTime
      if (now - lastAlive > timeoutMs) {
        // 心跳实际停滞时长（ms）：now 与最近存活基准之差（R4.8）。
        const staleMs = now - lastAlive
        await finalize(run.runId, `recoverOrphans(${run.runId})`, {
          status: "failed",
          error: `[ORPHAN_RECOVERED] Run 进程中断未恢复（心跳停滞超过 ${timeoutMs}ms）`,
        })
        // 为每个被回收 runId 记 WARN(ORPHAN_RECOVERED) 恰一条，含实际停滞时长 staleMs 与
        // 停滞判定阈值 timeoutMs（均 ms）。纯旁路副作用：不改返回值、行为或控制流；
        // WF_Logger 永不抛（R7.8）。引擎侧不重复记录，避免重复日志（R4.8）。
        log.warn(
          run.runId,
          `孤儿回收：Run 心跳停滞 ${staleMs}ms 超过阈值 ${timeoutMs}ms，已标记为 failed`,
          {
            eventCode: WORKFLOW_EVENT_CODES.ORPHAN_RECOVERED,
            staleMs,
            timeoutMs,
          },
        )
        recovered.push(run.runId)
      }
    }
    return recovered
  }

  // -------------------------------------------------------------------------
  // Journal
  // -------------------------------------------------------------------------

  async function appendJournal(runId: string, entry: JournalEntry): Promise<void> {
    try {
      await ensureDir(journalDir(runId))
      await appendFile(journalFile(runId), `${JSON.stringify(entry)}\n`, "utf8")
    } catch (error) {
      recordFailure(`appendJournal(${runId})`, error, runId)
    }
  }

  async function readJournal(runId: string): Promise<JournalEntry[]> {
    let text: string
    try {
      text = await readFile(journalFile(runId), "utf8")
    } catch {
      // Journal 缺失：返回空数组（Resume_Engine 负责 RESUME_INVALID 判定）。
      return []
    }
    const entries: JournalEntry[] = []
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.length === 0) {
        continue
      }
      try {
        entries.push(JSON.parse(trimmed) as JournalEntry)
      } catch (error) {
        // 跳过损坏行（如崩溃时的半行写入），保留可解析的事件。
        recordFailure(`readJournal(${runId}) parse line`, error, runId)
      }
    }
    return entries
  }

  // -------------------------------------------------------------------------
  // Script 归档
  // -------------------------------------------------------------------------

  async function persistScript(name: string, runId: string, script: string): Promise<string> {
    const filePath = scriptArchivePath(name, runId)
    try {
      await ensureDir(scriptsDir())
      await writeFile(filePath, script, "utf8")
    } catch (error) {
      recordFailure(`persistScript(${name}, ${runId})`, error, runId)
    }
    return filePath
  }

  /** 派生归档脚本副本路径（纯计算，无 I/O）；供 resume 源脚本缺失时回退（L 级修复）。 */
  function archivedScriptPath(name: string, runId: string): string {
    return scriptArchivePath(name, runId)
  }

  // -------------------------------------------------------------------------
  // 进度与日志
  // -------------------------------------------------------------------------

  /**
   * 追加或更新进度条目到 workflowProgress（FIX-2 / BUG-008：upsert 语义消除 resume 重复）。
   *
   * 按 `(entry.type, entry.index)` 去重：同类型 + 同 index 的条目**覆盖旧值**而非追加，
   * 消除 resume 时「首次运行旧记录 + 复用/重跑新记录」导致的重复条目。保留首次出现顺序，
   * 但值以 last-wins 更新（与 Journal 的 last-wins 语义一致）。
   *
   * - workflow_agent 按 `index` 唯一；
   * - workflow_phase 按 `index` 唯一（阶段在 meta.phases 中序号唯一）。
   *
   * 旧快照（首次运行未 upsert、追加了重复条目）经由 {@link agentEntries} 的展示层去重兜底。
   */
  async function appendProgress(runId: string, entry: ProgressEntry): Promise<void> {
    return withRunLock(runId, async () => {
      const current = await getRun(runId)
      if (!current) {
        recordFailure(`appendProgress(${runId})`, "run not found", runId)
        return
      }
      // upsert 语义（FIX-2）：找到同 (type, index) 的已存在条目并覆盖，否则追加到末尾。
      const existing = current.workflowProgress.findIndex(
        (e) =>
          e.type === entry.type &&
          (e.type === "workflow_agent"
            ? (e as AgentProgress).index === (entry as AgentProgress).index
            : e.type === "workflow_phase"
              ? (e as PhaseProgress).index === (entry as PhaseProgress).index
              : false),
      )
      let next: ProgressEntry[]
      if (existing >= 0) {
        // 已存在：覆盖（保留首次出现顺序，值 last-wins）。
        next = [...current.workflowProgress]
        next[existing] = entry
      } else {
        // 新增：追加到末尾。
        next = [...current.workflowProgress, entry]
      }
      await commit({ ...current, workflowProgress: next })
    })
  }

  async function updateProgress(
    runId: string,
    index: number,
    updates: Partial<AgentProgress>,
  ): Promise<void> {
    return withRunLock(runId, async () => {
      const current = await getRun(runId)
      if (!current) {
        recordFailure(`updateProgress(${runId})`, "run not found", runId)
        return
      }
      let matched = false
      const workflowProgress: ProgressEntry[] = current.workflowProgress.map((entry) => {
        if (entry.type === "workflow_agent" && entry.index === index) {
          matched = true
          // 合并更新，但保留区分字段 type/index 不被覆盖。
          return { ...entry, ...updates, type: "workflow_agent", index: entry.index }
        }
        return entry
      })
      if (!matched) {
        recordFailure(`updateProgress(${runId})`, `no workflow_agent entry at index ${index}`, runId)
        return
      }
      await commit({ ...current, workflowProgress })
    })
  }

  async function appendLog(runId: string, message: string): Promise<void> {
    return withRunLock(runId, async () => {
      const current = await getRun(runId)
      if (!current) {
        recordFailure(`appendLog(${runId})`, "run not found", runId)
        return
      }
      await commit({ ...current, logs: [...current.logs, message] })
    })
  }

  function getMemoryLog(): readonly string[] {
    // 返回拷贝（L 级修复）：避免外部经返回值 push/清空内部 memoryLog（getLog/hook-registry 同款语义）。
    return [...memoryLog]
  }

  return {
    createRun,
    updateRun,
    completeRun,
    failRun,
    cancelRun,
    reviveRun,
    deleteRun,
    getRun,
    listRuns,
    heartbeat,
    recoverOrphans,
    appendJournal,
    readJournal,
    persistScript,
    archivedScriptPath,
    appendProgress,
    updateProgress,
    appendLog,
    getMemoryLog,
  }
}

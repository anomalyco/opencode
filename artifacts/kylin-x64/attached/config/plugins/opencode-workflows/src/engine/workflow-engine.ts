/**
 * OpenCode Workflows —— Workflow_Engine（工作流引擎）。
 *
 * Workflow_Engine 是顶层编排入口，负责 Run 的**后台异步执行**生命周期：
 *
 * - **execute（fire-and-forget，R3.1/R3.2）**：解析 name/受控目录 path → 加载脚本
 *   → `createRun` 写初始 Snapshot(running) → `void runWorkflow(runId)` 后台执行 →
 *   在 100ms 内返回 runId（不阻塞调用方）。引擎**不接受裸脚本内容**，只接受已注册
 *   name 或受控目录内 path（R9.8/R9.9）。
 * - **resume（R3.x/R8）**：基于已存在 runId 的 Journal 做 step 级断点续跑——
 *   ResumeEngine 重建复用上下文，重跑时复用已完成 agent 的缓存结果。
 * - **cancel（R3.4/R9.10）**：级联 `executor.destroy()`（abort 所有运行中子 session）
 *   并把 status 置 `cancelled`（终态不回退）。
 * - **workflowTimeout（R1.7）**：每个后台执行持有一个超时定时器（默认 168 小时 / 7 天），
 *   超时**复用 cancel 的级联 abort 路径**，但终态置 `failed`（区别于主动 cancel 的
 *   `cancelled`）。配置为 `null` 或 `<= 0` 时**关闭**整体超时（长跑 workflow 不被墙钟打断）。
 *
 * 后台完成/失败仅**即时落盘 Snapshot**（completeRun/failRun），不向主 session 注入
 * prompt——TUI 经文件监听感知进度（R3.7）。
 *
 * 依赖注入：ScriptLoader（load）、StateStore、ExtensionSystem、ResumeEngine、
 * AgentExecutor 工厂、子 workflow 加载器均经构造参数注入，便于集成测试（task 13.2）
 * 用 Mock SDK 驱动端到端流程。
 *
 * @see .kiro/specs/opencode-workflows/design.md — 1. Workflow_Engine / 后台执行与通知流程
 * Requirements: 1.7, 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 13.5
 */

import { cpus } from "node:os"

import { WorkflowError, isWorkflowError } from "../errors"
import { WorkflowCancelled, WorkflowPaused } from "./control-signals"
import { isPathInControlledDir } from "../command/command-system"
import { coerceLogger } from "../logging/wf-logger"
import { WORKFLOW_EVENT_CODES } from "../logging/event-codes"
import type { ResolvedConfigBlock, RunSnapshot, WorkflowConfig, WorkflowMeta } from "../types"
import type { WFLogger } from "../logging/wf-logger"
import type { LoadedScript } from "./script-loader"
import type { StateStore } from "../state/state-store"
import type { ExtensionSystem, HookContext } from "../extension/extension-system"
import type { ResumeEngine } from "../resume/resume-engine"
import type { AgentExecutor } from "../executor/agent-executor"
import type { ConfigLoader } from "../config/config-loader"
import { resolveOutputPath } from "../config/output-path"
import {
  createOrchestrationApi,
  createRunContext,
  emptyConfigBlock,
  type OrchestrationAPI,
  type RunContext,
  type SubWorkflowLoader,
} from "../api/orchestration-api"
import type { DefaultModelResolution } from "./default-model"

// ============================================================================
// 默认配置
// ============================================================================

/** Workflow 整体超时默认值（168 小时 / 7 天）。设为 null 或 <=0 可关闭。 */
export const DEFAULT_WORKFLOW_TIMEOUT_MS = 604_800_000

/** 运行期心跳写入间隔默认值（10s）。设为 null 或 <=0 关闭心跳与孤儿回收。 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000

/** 孤儿 run 判定超时默认值（60s，约心跳间隔 6 倍）。设为 null 或 <=0 关闭回收。 */
export const DEFAULT_ORPHAN_TIMEOUT_MS = 60_000

/** 默认运行时配置（缺省项填充）。 */
export function defaultWorkflowConfig(): WorkflowConfig {
  return {
    maxConcurrency: defaultConcurrency(),
    maxAgents: 1000,
    // 默认不限制单 Agent 运行时间（null）：不同任务耗时差异大，框架不强行墙钟打断。
    // 需要时可经配置设正数，或单步 ctx.agent(prompt, { timeout }) 局部启用。
    agentTimeout: null,
    workflowTimeout: DEFAULT_WORKFLOW_TIMEOUT_MS,
    schemaRetries: 2,
    storageRoot: ".opencode/workflows",
    heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    orphanTimeoutMs: DEFAULT_ORPHAN_TIMEOUT_MS,
  }
}

function defaultConcurrency(): number {
  let cores = 4
  try {
    cores = cpus().length
  } catch {
    /* 忽略：保留回退值 */
  }
  return Math.max(1, Math.min(16, cores - 2))
}

/**
 * 提取脚本加载错误的原始原因（日志 reason 字段用）。
 *
 * WorkflowError 的 message 是面向用户的完整描述（含笼统前缀），其 context.reason 承载
 * **结构化的原始错误**（如 bun 编译期的 `This assignment will throw because "x" is a
 * constant`）——日志记录优先取后者（排障直接看到根因），非 WorkflowError 回退 message。
 */
function extractScriptErrorReason(error: unknown): string {
  if (isWorkflowError(error)) {
    const reason = error.context?.reason
    if (typeof reason === "string" && reason.length > 0) return reason
  }
  return error instanceof Error ? error.message : String(error)
}

// ============================================================================
// 公开接口与依赖
// ============================================================================

/** Workflow_Engine 公开接口（对应 design.md「1. Workflow_Engine」）。 */
export interface WorkflowEngine {
  /** 执行已注册 name 或受控目录 path，<100ms 返回 runId（fire-and-forget）。 */
  execute(nameOrPath: string, args?: unknown): Promise<string>
  /** 恢复中断的 Workflow（step 级）；放宽校验为非 running（paused/failed/cancelled 均可），返回（同一）runId。 */
  resume(runId: string): Promise<string>
  /** 取消正在执行的 Workflow（running|paused）：级联 abort 子 session，status=cancelled。 */
  cancel(runId: string): Promise<void>
  /**
   * 暂停正在执行的 Workflow（仅 running）：置位内存 Control_Signal=pause，立即把快照置为
   * 过渡态 `pausing`（FIX-1），由 `agent()` 准入检查点在「下一个 agent 边界」抛
   * {@link WorkflowPaused}，由 `runWorkflow` catch 将 run 落为**非终态** `paused`。
   * 非 running 抛 `RUN_NOT_CANCELLABLE`。
   */
  pause(runId: string): Promise<void>
  /**
   * 删除某 run 的全部产物（snapshot/journal/scripts）；委托 {@link StateStore.deleteRun}
   * （running 守卫 + 幂等在 store 层）。delete 一个 running run 抛 `RUN_NOT_DELETABLE`。
   */
  delete(runId: string): Promise<void>
  /** 获取 Run 状态。 */
  getRunStatus(runId: string): Promise<RunSnapshot | null>
  /** 列出最近 N 条 Runs。 */
  listRuns(limit?: number): Promise<RunSnapshot[]>
  /**
   * 回收孤儿 run（crash recovery）：扫描残留的 `running` 快照，将心跳停滞超过
   * `orphanTimeoutMs` 的标记为 `failed`。返回被回收的 runId 列表。
   *
   * 通常在引擎装配后调用一次（进程启动时清理上次未正常收尾的 run）。
   * 配置 `orphanTimeoutMs` 为 `null`/`<=0` 时不回收，返回空数组。
   */
  recoverOrphans(): Promise<string[]>
}

/**
 * Workflow_Engine 依赖（注入式）。
 *
 * `createExecutor` 为每个 Run 创建独立的 AgentExecutor（持有该 Run 的 Semaphore、计数、
 * 活跃 session 集合），以便 cancel 时 `destroy()` 仅影响该 Run。
 */
export interface WorkflowEngineDeps {
  /** 解析 name/path → 脚本绝对路径（经 ExtensionSystem.resolveWorkflow 或 Command_System 校验后传入）。 */
  resolvePath(nameOrPath: string): Promise<string>
  /** 加载脚本（执行阶段，含 meta 校验）。 */
  load(scriptPath: string): Promise<LoadedScript>
  store: StateStore
  extensions: ExtensionSystem
  resumeEngine: ResumeEngine
  /** 为单个 Run 创建独立 AgentExecutor。 */
  createExecutor(): AgentExecutor
  /**
   * 企业配置桥接（R5.1/R6.1）：在启动 Run 时按 workflow 全名解析其
   * {@link ResolvedConfigBlock} 注入 `RunContext.config`。配置缺失/非法时
   * `resolveConfigBlock` 自身已降级返回空块（不抛），不影响 Run 正常执行。
   */
  configLoader: ConfigLoader
  /**
   * 项目根（`workflows.config.json` 相对路径与 `output_path` 相对路径绝对化的基准）。
   * 默认 `process.cwd()`。
   */
  projectRoot?: string
  /** 运行时配置（缺省用 defaultWorkflowConfig）。 */
  config?: Partial<WorkflowConfig>
  /**
   * 受控目录白名单（**绝对路径**数组，M3 安全修复）：内置 workflows 目录 + 全局用户目录。
   * 用于在**实际执行路径**（makeSubLoader 的对象 `{ scriptPath }` 分支、引擎 resolvePath
   * 降级分支）强制校验脚本路径，使「只接受已注册 name 或受控目录内 path」（R9.8/R9.9）的
   * 白名单防线真正部署在引擎而非仅 Command_System。缺省空数组 → 拒绝一切对象 path 目标。
   */
  controlledDirs?: readonly string[]
  /**
   * 可选：WF_Logger 实例（依赖注入式日志抽象）。缺省/非法时回退 No_Op_Logger，
   * 业务行为（返回值、副作用、控制流）与未注入时逐一相同，差异仅为「无日志输出」。
   * 记录的关键生命周期事件：脚本加载失败（ERROR/SCRIPT_LOAD_FAILED）、
   * cancel 级联 abort（INFO/RUN_CANCELLED）、pause 级联 abort（INFO/RUN_PAUSED）、
   * 整体超时落 failed（ERROR/WORKFLOW_TIMEOUT）。
   *
   * 注：孤儿回收（ORPHAN_RECOVERED）由 State_Store 在标记孤儿时记录，引擎侧不重复记录
   * 以避免重复日志（见 design.md §6）。
   */
  logger?: WFLogger
  /**
   * 引擎默认模型解析（可选）：run 启动时调用一次，产出该 run 的默认模型
   * （`"providerID/modelID"`）或 null（连清单兜底都不可用）。由装配层（index.ts）注入——
   * 内部持 SDK client（config.get / config.providers）与 model.json 读取，并做进程级缓存。
   * 纯解析逻辑见 {@link resolveDefaultModel}（src/engine/default-model.ts）。
   * 未注入/抛错时 RunContext.defaultModel 缺省，agent 行为与既有版本一致。
   */
  resolveDefaultModel?: () => Promise<DefaultModelResolution | null>
  /**
   * 失败原因倒查（可选）：以 agentIndex 倒查内存日志环形缓冲中最近一条 ERROR 的
   * 真实 reason。由装配层（index.ts memorySink）注入，Orchestration_API 的 failEntry
   * 用它替代写死的笼统错误串。未注入/查不到时回退原串。
   */
  lookupFailureReason?: (agentIndex: number) => string | undefined
}

// ============================================================================
// 工厂
// ============================================================================

/**
 * 创建 Workflow_Engine。
 */
export function createWorkflowEngine(deps: WorkflowEngineDeps): WorkflowEngine {
  const config: WorkflowConfig = { ...defaultWorkflowConfig(), ...deps.config }

  /** 配置相对路径绝对化基准（`workflows.config.json` 与 `output_path` 共用）。 */
  const projectRoot = deps.projectRoot ?? process.cwd()

  /**
   * WF_Logger 实例：缺省/非法时回退 No_Op_Logger，使引擎始终持有可调用 logger。
   * 无条件调用其日志方法，不依据启用/禁用状态分支（R1.6）。
   */
  const log = coerceLogger(deps.logger)

  /** runId → 该 Run 的活跃执行句柄（用于 cancel/超时级联 abort）。 */
  interface ActiveRun {
    executor: AgentExecutor
    timer: ReturnType<typeof setTimeout> | undefined
    /** 心跳定时器（周期性刷新 heartbeatAt 落盘，宣告进程存活，供孤儿回收）。 */
    heartbeatTimer: ReturnType<typeof setInterval> | undefined
    /** 标记超时触发，使后台执行 catch 时落 failed 而非误判。 */
    timedOut: boolean
    /**
     * 内存 Control_Signal（pause/cancel/none）。由 `pause`/`cancel` 置位，经注入到
     * RunContext 的 `readControlSignal` 被 `agent()` 同步前导段读取，在「下一个 agent
     * 边界」抛 {@link WorkflowPaused}/{@link WorkflowCancelled}。默认 "none"。
     */
    controlSignal: "none" | "pause" | "cancel"
    /**
     * 标记 catch 分支应将 run 落为非终态 `paused`（而非 failed）。由 `pause` 置 true。
     * 默认 false。
     */
    paused: boolean
  }
  const activeRuns = new Map<string, ActiveRun>()

  /** 受控目录白名单（M3）：缺省空数组（拒绝一切对象 path 目标，仅放行已注册 name）。 */
  const controlledDirs: readonly string[] = deps.controlledDirs ?? []

  /**
   * 构造子 workflow 加载器：把 nameOrRef 解析为 { meta, execute }，供 workflow() 内联展开。
   */
  function makeSubLoader(): SubWorkflowLoader {
    return async (nameOrRef) => {
      let scriptPath: string
      if (typeof nameOrRef === "string") {
        // 字符串按已注册 name 解析（resolveWorkflow 对未知 name 抛 WORKFLOW_NOT_FOUND）。
        scriptPath = await deps.extensions.resolveWorkflow(nameOrRef)
      } else {
        // 对象 { scriptPath } 是任意路径注入向量（M3）：脚本内 ctx.workflow({ scriptPath })
        // 经对象引用可加载任意 .mjs。在引擎层强制受控目录白名单校验，越界抛 PATH_NOT_ALLOWED。
        if (!isPathInControlledDir(nameOrRef.scriptPath, controlledDirs)) {
          throw new WorkflowError(
            "PATH_NOT_ALLOWED",
            `子 workflow path 不在受控目录内（${controlledDirs.join(" / ") || "<空白名单>"}）：${nameOrRef.scriptPath}`,
            { scriptPath: nameOrRef.scriptPath, controlledDirs: [...controlledDirs] },
          )
        }
        scriptPath = await deps.extensions.resolveWorkflow({ scriptPath: nameOrRef.scriptPath })
      }
      const loaded = await deps.load(scriptPath)
      return {
        meta: loaded.meta,
        execute: loaded.execute as (ctx: OrchestrationAPI) => Promise<unknown>,
      }
    }
  }

  /**
   * 后台执行体 fire-and-forget 的最终兜底（风险5）。
   *
   * `runWorkflow` 自身的 try/catch/finally 已覆盖绝大多数执行期异常；但其 `try` 之前的
   * 前置步骤（`deps.createExecutor()`、`activeRuns.set()`、定时器初始化）一旦抛错，将既不
   * 进入 finally 清理 `activeRuns`，也无人接管 reject。本兜底统一：
   * - 清理可能残留的 `activeRuns` 项（避免泄漏在途计时器/句柄）；
   * - 尽力把 run 落为 `failed` 终态（store 终态守卫保证幂等、不回退已落终态）；
   * - 记 ERROR 日志，避免 unhandledRejection 静默丢失。
   *
   * 本函数自身**不抛**（任何兜底步骤异常都被吞并记录），确保它能安全用于 `.catch`。
   */
  async function handleBackgroundFailure(runId: string, error: unknown): Promise<void> {
    const message = isWorkflowError(error)
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error)
    // 清理可能残留的 ActiveRun（前置步骤抛错时不会进入 runWorkflow 的 finally）。
    const active = activeRuns.get(runId)
    if (active) {
      if (active.timer !== undefined) clearTimeout(active.timer)
      if (active.heartbeatTimer !== undefined) clearInterval(active.heartbeatTimer)
      activeRuns.delete(runId)
    }
    log.error(runId, "后台执行体未受控失败（fire-and-forget 兜底）", {
      eventCode: WORKFLOW_EVENT_CODES.PERSIST_FAILED,
      reason: message,
    })
    try {
      await deps.store.failRun(runId, message)
    } catch {
      // 兜底落盘失败不再上抛：孤儿回收（recoverOrphans）作为最终安全网。
    }
  }

  /**
   * 后台执行主体：加载脚本 → 装配 Orchestration_API → 执行 → 即时落盘终态。
   *
   * @param runId        已 createRun 的 runId。
   * @param scriptPath   脚本路径。
   * @param meta         已校验 meta。
   * @param execute      脚本主体。
   * @param args         入参。
   * @param resumeRunId  非空时走 step 级恢复（基于该 runId 的 Journal 构建复用上下文）。
   */
  async function runWorkflow(
    runId: string,
    meta: WorkflowMeta,
    execute: (ctx: OrchestrationAPI) => Promise<unknown>,
    args: unknown,
    resumeRunId: string | undefined,
    label: string | undefined,
  ): Promise<void> {
    const executor = deps.createExecutor()
    const active: ActiveRun = {
      executor,
      timer: undefined,
      heartbeatTimer: undefined,
      timedOut: false,
      controlSignal: "none",
      paused: false,
    }
    activeRuns.set(runId, active)

    // workflowTimeout 定时器（R1.7）：仅当配置为正数时启用；null 或 <=0 表示关闭整体超时
    // （长跑 workflow 不被墙钟打断）。超时复用 cancel 级联 abort，但终态置 failed。
    if (typeof config.workflowTimeout === "number" && config.workflowTimeout > 0) {
      active.timer = setTimeout(() => {
        active.timedOut = true
        void executor.destroy()
      }, config.workflowTimeout)
    }

    // 心跳定时器（crash recovery）：仅当配置为正数时启用。周期性刷新 heartbeatAt 落盘，
    // 宣告「持有此 run 的进程存活」。进程崩溃后心跳停滞，另一进程启动时据此回收孤儿。
    if (typeof config.heartbeatIntervalMs === "number" && config.heartbeatIntervalMs > 0) {
      // 立即打一次心跳，避免「createRun 到首个 interval 之间」的空窗被误判。
      void deps.store.heartbeat(runId)
      active.heartbeatTimer = setInterval(() => {
        void deps.store.heartbeat(runId)
      }, config.heartbeatIntervalMs)
      // 不阻止进程退出（与 workflowTimeout 一致的非阻塞语义）。
      ;(active.heartbeatTimer as { unref?: () => void }).unref?.()
    }

    try {
      // Resume：基于现有 Journal 构建复用上下文（resumeRunId 缺失/Journal 缺失抛 RESUME_INVALID）。
      let resume: RunContext["resume"]
      if (resumeRunId) {
        const ctx = await deps.resumeEngine.createContext(resumeRunId)
        resume = { engine: deps.resumeEngine, ctx }
      }

      // ===== 企业配置桥接（R5.1/R6.1/R6.3 + R10.5/R16.4）=====
      // 按某 workflow 全名解析其 ResolvedConfigBlock（新形状：resources 开放资源字典 +
      // resourceLabels + 知名三类 template/rules/review 别名），并把 output_path 模板的
      // <RUNID>/<FEATURE> 占位符替换为最终绝对路径。resolveConfigBlock 自身已对文件
      // 缺失/非法降级（不抛），resolveOutputPath 对 null 模板返回 null——故配置缺失不
      // 影响 Run 的正常完成/失败路径。
      //
      // 注：此处用 `{ ...block, outputPath }` **原样透传** loader 解析出的整块（含
      // resources / resourceLabels / 知名三类双暴露），仅覆写 outputPath（占位符替换后
      // 的最终绝对路径）。不重建部分块——使脚本既能读旧式 ctx.config.template/rules/review，
      // 也能读新式 ctx.config.resources[<类别>]，知名三类两路指向同一绝对路径数组（R16.4）。
      const resolveConfigFor = async (
        workflowName: string,
        outputName?: string,
      ): Promise<ResolvedConfigBlock> => {
        const block = await deps.configLoader.resolveConfigBlock(workflowName, projectRoot)
        // 默认落盘（问题 5）：未配置 output_path（含配 "none"/"" → null）时回退默认模板。
        // 友好文件名（meta.outputName，问题"易懂文件名"）：非空白时用 `docs/<outputName>.md`
        // （如 docs/产品需求文档.md），缺省回退 `docs/<name>.md`。使「跑了 wf 就有产出文件」
        // 开箱即用且文件名易懂；相对 projectRoot 绝对化、不污染源码树之外。落盘内容仍由各脚本
        // 决定：消费 ctx.config.outputPath 的 wf（prd/design/test）据此落盘，不消费的（code）忽略。
        // outputName 已过 validateMeta 路径安全校验（禁含 / \ ..）；workflowName 已过字符集白名单。
        const base = typeof outputName === "string" && outputName.trim().length > 0 ? outputName.trim() : workflowName
        const outputTemplate = block.outputPath ?? `docs/${base}.md`
        // per-phase 落盘路径（路 A，与 outputPath 同口径替换占位符）：逐项把阶段路径模板
        // 的 <RUNID>/<FEATURE> 替换为最终绝对路径。空字典（配 string 或缺省）→ 仍为空字典。
        const outputPathByPhase: Record<string, string> = {}
        for (const [phase, template] of Object.entries(block.outputPathByPhase)) {
          const resolved = resolveOutputPath(template, runId, label, projectRoot)
          if (resolved) outputPathByPhase[phase] = resolved
        }
        return {
          ...block,
          outputPath: resolveOutputPath(outputTemplate, runId, label, projectRoot),
          outputPathByPhase,
        }
      }

      // 顶层 config：以当前（顶层）workflow 全名解析并注入 RunContext.config（R5.1）。
      // 解析失败时降级为空块，保证 Run 仍可执行（防御性兜底——resolveConfigBlock 不抛）。
      let topConfig: ResolvedConfigBlock
      try {
        topConfig = await resolveConfigFor(meta.name, meta.outputName)
      } catch {
        topConfig = emptyConfigBlock()
      }

      const run = createRunContext({
        runId,
        store: deps.store,
        executor,
        extensions: deps.extensions,
        loadSubWorkflow: makeSubLoader(),
        resume,
        // 顶层 config（R5.1/R5.2）：注入 RunContext.config，由 createOrchestrationApi 透传 ctx.config。
        config: topConfig,
        // 子层 config 解析回调（R5.5）：内联子 workflow 按自身 name 解析其配置块并替换占位符。
        resolveConfig: (workflowName) => resolveConfigFor(workflowName),
        // 注入同步可读的 Control_Signal：指向该 run 的 ActiveRun.controlSignal。
        // pause/cancel 置位后，`agent()` 同步前导段在「下一个 agent 边界」据此短路。
        readControlSignal: () => activeRuns.get(runId)?.controlSignal ?? "none",
        // 失败原因倒查（可选）：agent() 在 execute 返回 null 时按 agentIndex 倒查
        // 内存日志的真实 reason 写入 journal。未注入时 failEntry 回退笼统原串。
        lookupFailureReason: deps.lookupFailureReason,
      })

      //解析引擎默认模型（首次为真实网络调用，之后进程级缓存命中）。
      // 失败静默（run.defaultModel 缺省 → agent 请求裸发，回退既有 server 回退链行为）。
      try {
        const resolution = await deps.resolveDefaultModel?.()
        if (resolution?.model) {
          run.defaultModel = resolution.model
          log.info(runId, "引擎默认模型解析完成", {
            model: resolution.model,
            source: resolution.source,
            ...(resolution.invalidConfigModel
              ? { invalidConfigModel: resolution.invalidConfigModel }
              : {}),
          })
        }
      } catch (error) {
        log.warn(runId, "引擎默认模型解析失败（本次 run 将裸发请求，依赖 server 回退链）", {
          reason: error instanceof Error ? error.message : String(error),
        })
      }

      const api = createOrchestrationApi(run, meta, { args, depth: 0 })
      const result = await execute(api)

      if (active.timedOut) {
        // 超时已在定时器中 destroy；此处置 failed 终态（R1.7）。
        // 记 ERROR(WORKFLOW_TIMEOUT) 恰一条（与下方 catch 分支的超时记录互斥：execute 正常
        // 返回走此处、抛出走 catch，二者不可能同时命中）。含 runId 与整体超时阈值（ms）。
        log.error(runId, "Workflow 整体超时，置为 failed", {
          eventCode: WORKFLOW_EVENT_CODES.WORKFLOW_TIMEOUT,
          workflowTimeout: config.workflowTimeout,
        })
        await deps.store.failRun(runId, `[WORKFLOW_TIMEOUT] Workflow 执行超过 ${config.workflowTimeout}ms`)
      } else {
        await deps.store.completeRun(runId, result)
        // workflow-complete Hooks（观察性；异常/超时由 registry 内部容错）。
        const ctx: HookContext = { runId, phase: "", result }
        await deps.extensions.runWorkflowCompleteHooks(ctx)
      }
    } catch (error) {
      // ===== Control_Signal 受控异常分流（task 4.4）=====
      // 用 instanceof 判定受控异常，并以 ActiveRun 标志位作为兜底（覆盖在途 agent 因
      // pause/cancel 竞态抛出普通 Error 的边角场景）。分支顺序：超时 > cancel > pause >
      // 普通失败——避免普通 Error 抢先匹配，也保证 cancel 终态优先于 pause 非终态。
      const isCancel = error instanceof WorkflowCancelled || active.controlSignal === "cancel"
      const isPause = error instanceof WorkflowPaused || active.paused
      if (active.timedOut) {
        // 超时已 destroy executor，属硬失败终态。记 ERROR(WORKFLOW_TIMEOUT) 恰一条
        // （与 try 成功路径的超时记录互斥：execute 抛出走此处、正常返回走上方，二者不并发）。
        log.error(runId, "Workflow 整体超时，置为 failed", {
          eventCode: WORKFLOW_EVENT_CODES.WORKFLOW_TIMEOUT,
          workflowTimeout: config.workflowTimeout,
        })
        await deps.store.failRun(
          runId,
          `[WORKFLOW_TIMEOUT] Workflow 执行超过 ${config.workflowTimeout}ms`,
        )
      } else if (isCancel) {
        // cancel：销毁在途子 session 后落终态 cancelled（幂等守卫）。cancel() 通常已先
        // destroy + cancelRun，此处为防御性兜底（destroy 幂等、cancelRun 终态不回退）。
        // RUN_CANCELLED 日志在 cancel() 的级联 abort 处记录（恰一条），此处不重复记。
        await executor.destroy()
        await deps.store.cancelRun(runId)
      } else if (isPause) {
        // pause：销毁在途子 session（R4.2），再落非终态 paused（复位结束时间字段，
        // 可经 resume 翻回 running）。pause() 仅置位信号、不级联 abort——真正的级联 abort
        // 在此发生，故 INFO(RUN_PAUSED) 在此记录恰一条（reason=pause）。
        log.info(runId, "Run 被 pause，级联 abort 子 session", {
          eventCode: WORKFLOW_EVENT_CODES.RUN_PAUSED,
          reason: "pause",
        })
        await executor.destroy()
        await deps.store.updateRun(runId, { status: "paused", endTime: null, durationMs: null })
      } else {
        const message = isWorkflowError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error)
        await deps.store.failRun(runId, message)
      }
    } finally {
      if (active.timer !== undefined) clearTimeout(active.timer)
      if (active.heartbeatTimer !== undefined) clearInterval(active.heartbeatTimer)
      activeRuns.delete(runId)
    }
  }

  // ------------------------------------------------------------------------
  // execute（fire-and-forget）
  // ------------------------------------------------------------------------
  async function execute(nameOrPath: string, args?: unknown): Promise<string> {
    const scriptPath = await deps.resolvePath(nameOrPath)
    let loaded: LoadedScript
    try {
      loaded = await deps.load(scriptPath)
    } catch (error) {
      // 脚本加载失败（R4.1）：记 ERROR(SCRIPT_LOAD_FAILED) 恰一条后向上抛出，保持既有行为
      // （调用方 Promise 照常 reject、不创建 Run）。此路径尚未 createRun，故无 runId（归一为
      // 占位 "unknown"），但 scriptPath 与失败原因摘要齐备。reason 优先取 WorkflowError
      // context 的结构化原始错误（如 bun 编译期的 const 重复赋值详情），message 仅兜底。
      log.error("unknown", "脚本加载失败（execute）", {
        eventCode: WORKFLOW_EVENT_CODES.SCRIPT_LOAD_FAILED,
        scriptPath,
        reason: extractScriptErrorReason(error),
      })
      throw error
    }

    // 从 args.feature 提取本次运行的需求原文作为 label（区分同名 workflow 的多次运行）。
    const label =
      args && typeof args === "object" && typeof (args as { feature?: unknown }).feature === "string"
        ? ((args as { feature: string }).feature)
        : undefined

    // createRun 写初始 Snapshot(running) + 归档脚本副本。完整 args 一并落盘（P1 修复：
    // 供 resume 精确重建 prompt，避免 args 丢失导致缓存复用失效 + 用错误需求重跑）。
    const runId = await deps.store.createRun(loaded.meta, scriptPath, loaded.source, label, args)
    await deps.store.persistScript(loaded.meta.name, runId, loaded.source)

    // fire-and-forget：后台执行，不 await。
    // 兜底 .catch（风险5）：runWorkflow 内部的 try/catch/finally 仅覆盖 createExecutor /
    // activeRuns.set / 定时器初始化**之后**的执行体；若这些前置步骤抛错，后台 Promise 会
    // reject 且无人接管（unhandledRejection），且已 createRun 的 run 会停留在 running 直到
    // 孤儿回收。此处统一兜底：清理可能残留的 activeRuns，并把 run 落为 failed 终态。
    void runWorkflow(
      runId,
      loaded.meta,
      loaded.execute as (ctx: OrchestrationAPI) => Promise<unknown>,
      args,
      undefined,
      label,
    ).catch((error) => handleBackgroundFailure(runId, error))
    return runId
  }

  // ------------------------------------------------------------------------
  // resume（step 级；放宽校验为非 running）
  // ------------------------------------------------------------------------
  async function resume(runId: string): Promise<string> {
    const snapshot = await deps.store.getRun(runId)
    if (!snapshot) {
      throw new WorkflowError("RESUME_INVALID", `runId 无效或 Snapshot 不存在：${runId}`, { runId })
    }
    // 放宽校验为非 running（R4.4/R4.5 + FIX-1 增强）：paused/failed/cancelled 均可 resume；
    // running → 拒绝，避免对同一 run 起并发执行体（R4.5）。
    if (snapshot.status === "running") {
      throw new WorkflowError(
        "RESUME_INVALID",
        `Run 已在运行中（status=running），无法 resume（避免对同一 run 起并发执行体）`,
        { runId, status: snapshot.status },
      )
    }
    // pausing 态分两种情形（FIX-1 近实时打断）：
    // - **本进程暂停途中**（activeRuns 仍有该 run 的活动条目）：pause() 已 destroy executor 并
    //   正在做 catch/finally 清理，runWorkflow 尚未退出。此窗口内 resume 会产生并发执行体，
    //   不安全 → 拒绝，提示用户等其落为 paused。monitor-data.canResume/filterRunsForCommand 已
    //   把 pausing 排在「不可 resume」列，正常 UI 不会呈现该选项。
    // - **崩溃残留 pausing**（无活动条目，进程在暂停途中崩溃留下的 stale 快照）：等价于 paused，
    //   走正常 resume 路径复活——重新加载脚本、新建执行体续跑。
    if (snapshot.status === "pausing" && activeRuns.has(runId)) {
      throw new WorkflowError(
        "RESUME_INVALID",
        `Run 正在暂停途中（status=pausing，abort 尚未完成），请等其落为 paused 后再 resume`,
        { runId, status: snapshot.status },
      )
    }
    // 重新加载脚本。默认按 Snapshot 记录的源路径 scriptPath 续跑（resume = 按当前脚本续跑）。
    let loaded: LoadedScript
    try {
      loaded = await deps.load(snapshot.scriptPath)
    } catch (error) {
      // L 级修复：源脚本缺失（被移动/删除）时回退到 persistScript 写入的归档副本
      // （scripts/<name>-wf_<runId>.mjs），保证「归档可复现」。仅 SCRIPT_NOT_FOUND 触发回退；
      // 其它加载错误（语法错误等）不回退，直接走失败路径。
      const sourceMissing = isWorkflowError(error) && error.code === "SCRIPT_NOT_FOUND"
      let recovered: LoadedScript | undefined
      if (sourceMissing) {
        const archivePath = deps.store.archivedScriptPath(snapshot.workflowName, runId)
        try {
          recovered = await deps.load(archivePath)
          log.info(runId, "源脚本缺失，已回退加载归档副本续跑（resume）", {
            eventCode: WORKFLOW_EVENT_CODES.SCRIPT_LOAD_FAILED,
            scriptPath: snapshot.scriptPath,
            archivePath,
          })
        } catch {
          // 归档副本也加载失败：落回原始错误处理（记 ERROR 并抛出）。
          recovered = undefined
        }
      }
      if (recovered) {
        loaded = recovered
      } else {
        // 脚本加载失败（R4.1，resume 路径）：记 ERROR(SCRIPT_LOAD_FAILED) 恰一条后向上抛出，
        // 保持既有行为（调用方 Promise 照常 reject、不复活 Run）。此路径 runId 已知。
        // reason 优先取 context 的结构化原始错误（同 execute 路径）。
        log.error(runId, "脚本加载失败（resume）", {
          eventCode: WORKFLOW_EVENT_CODES.SCRIPT_LOAD_FAILED,
          scriptPath: snapshot.scriptPath,
          reason: extractScriptErrorReason(error),
        })
        throw error
      }
    }

    // 显式复活：把状态强制置回 running（绕过终态守卫——从 failed/cancelled resume 是
    // 用户显式意图，paused 本就非终态）。复位 endTime/durationMs/error。
    await deps.store.reviveRun(runId)

    void runWorkflow(
      runId,
      loaded.meta,
      loaded.execute as (ctx: OrchestrationAPI) => Promise<unknown>,
      // P1 修复：回填首跑落盘的完整原始 args（snapshot.args）。这样 resume 重建的 prompt
      // 与 Journal 的 started.prompt 一致 → shouldReuse 命中已完成前缀（零重跑），且重跑
      // 段使用正确需求文本。旧快照无 args 字段时为 undefined，安全回退既有行为。
      snapshot.args,
      runId,
      // resume 路径 label 取自 Snapshot 既有 label（createRun 时从 args.feature 提取并落盘），
      // 保证 output_path 的 <FEATURE> 与首次运行一致；缺省时 resolveOutputPath 对空 label 回退短 runId。
      snapshot.label ?? undefined,
    ).catch((error) => handleBackgroundFailure(runId, error))
    return runId
  }

  // ------------------------------------------------------------------------
  // pause（置位 Control_Signal=pause，由 agent() 检查点在下一边界落 paused）
  // ------------------------------------------------------------------------
  async function pause(runId: string): Promise<void> {
    const snapshot = await deps.store.getRun(runId)
    if (!snapshot) {
      throw new WorkflowError("RUN_NOT_CANCELLABLE", `runId 不存在：${runId}`, { runId })
    }
    if (snapshot.status !== "running") {
      // 文案区分（FIX-1 / BUG-006）：pausing（已在暂停途中）与终态分别给更准确提示，
      // 而非笼统「非 running 无法暂停」。
      const hint =
        snapshot.status === "pausing"
          ? `Run 已在暂停途中（status=pausing，等待当前 Agent 到达检查点），无需重复暂停`
          : `Run 非 running 状态（当前 ${snapshot.status}），无法暂停`
      throw new WorkflowError("RUN_NOT_CANCELLABLE", hint, { runId, status: snapshot.status })
    }
    const active = activeRuns.get(runId)
    if (!active) {
      // stale running（崩溃残留，无活动执行体）：pause 一个已死 run 无意义——无现场可在
      // 「下一个 agent 边界」停下。拒绝并提示改用 resume（先续跑再 pause）。
      throw new WorkflowError(
        "RUN_NOT_CANCELLABLE",
        `Run 标记为 running 但无活动执行体（疑似崩溃残留）；无法暂停，请改用 resume 续跑`,
        { runId, status: snapshot.status },
      )
    }
    // 置位 pause 信号：下一个 agent() 准入检查点（或本 agent 执行返回后的复查点）抛
    // WorkflowPaused，由 runWorkflow catch destroy + 落非终态 paused。
    active.controlSignal = "pause"
    active.paused = true
    // 近实时打断（FIX-1 增强 / accept-discard）：立即级联 abort 在途子 session，使正在跑的
    // Agent 尽快停下（session.abort），而非等它自然跑到「下一个 agent 边界」。被 abort 的
    // Agent 的 execute() 多半返回 null，由 agent() 的执行后复查点在**本 agent 边界**抛
    // WorkflowPaused → catch 落 paused；其 result 事件含 error → resume 时重跑（丢弃半截结果，
    // 符合用户预期）。注意：abort 后 executor 标记 destroyed，resume 时 runWorkflow 会
    // createExecutor() 取新执行体，不受影响。
    // destroy 幂等且 best-effort（safeAbort 吞错），失败不影响信号置位与状态落盘。
    await active.executor.destroy()
    // 立即把快照置为过渡态 pausing（FIX-1 / BUG-007 / BUG-006）：让 Monitor/面板能即时显示
    // 「⏸ 暂停中…」。近实时打断下，从 pausing → paused 的间隔通常很短（abort 即时生效）。
    // pausing 为非终态（不会被终态守卫拦截），且这里用 updateRun 而非 finalize（不写 endTime）。
    await deps.store.updateRun(runId, { status: "pausing" })
  }

  // ------------------------------------------------------------------------
  // cancel（running|paused → 级联 abort + status=cancelled）
  // ------------------------------------------------------------------------
  async function cancel(runId: string): Promise<void> {
    const snapshot = await deps.store.getRun(runId)
    if (!snapshot) {
      throw new WorkflowError("RUN_NOT_CANCELLABLE", `runId 不存在：${runId}`, { runId })
    }
    // 仅 running|pausing|paused 可取消；终态（completed/failed/cancelled）拒绝（R5.2）。
    if (
      snapshot.status !== "running" &&
      snapshot.status !== "pausing" &&
      snapshot.status !== "paused"
    ) {
      throw new WorkflowError(
        "RUN_NOT_CANCELLABLE",
        `Run 已是终态（当前 ${snapshot.status}），无法取消`,
        { runId, status: snapshot.status },
      )
    }
    const active = activeRuns.get(runId)
    if (active) {
      // 有活动执行体：置位 cancel 信号 + 级联 abort 子 session + 写终态 cancelled。
      // 此处是 cancel 的级联 abort 点——记 INFO(RUN_CANCELLED) 恰一条（reason=cancel）。
      // runWorkflow 的 catch isCancel 分支不重复记，避免重复日志。
      active.controlSignal = "cancel"
      log.info(runId, "Run 被 cancel，级联 abort 子 session", {
        eventCode: WORKFLOW_EVENT_CODES.RUN_CANCELLED,
        reason: "cancel",
      })
      if (active.timer !== undefined) clearTimeout(active.timer)
      if (active.heartbeatTimer !== undefined) clearInterval(active.heartbeatTimer)
      await active.executor.destroy()
    }
    // stale running 或 paused（无活动执行体）→ 直接写终态 cancelled（状态即权威，R5.3）。
    await deps.store.cancelRun(runId)
  }

  // ------------------------------------------------------------------------
  // delete（委托 store.deleteRun；running 守卫 + 幂等在 store 层）
  // ------------------------------------------------------------------------
  async function deleteRun(runId: string): Promise<void> {
    await deps.store.deleteRun(runId)
  }

  async function getRunStatus(runId: string): Promise<RunSnapshot | null> {
    return deps.store.getRun(runId)
  }

  async function listRuns(limit = 50): Promise<RunSnapshot[]> {
    return deps.store.listRuns(limit)
  }

  async function recoverOrphans(): Promise<string[]> {
    const timeout = config.orphanTimeoutMs
    if (typeof timeout !== "number" || timeout <= 0) {
      return []
    }
    return deps.store.recoverOrphans(timeout)
  }

  return { execute, resume, cancel, pause, delete: deleteRun, getRunStatus, listRuns, recoverOrphans }
}

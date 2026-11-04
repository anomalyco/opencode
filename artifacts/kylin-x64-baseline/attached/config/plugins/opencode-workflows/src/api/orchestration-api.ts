/**
 * OpenCode Workflows —— Orchestration_API（编排 API）。
 *
 * 本模块把脚本作者可见的核心 API 装配为一个 {@link OrchestrationAPI} 对象，作为
 * `LoadedScript.execute(context)` 的 `context`：`agent`、`parallel`、`pipeline`、
 * `phase`、`log`、`workflow`、`args`、`config`、`runId`。它接线下层各模块（AgentExecutor、
 * SystemInjector 经 executor 内部、StateStore、ResumeEngine、ExtensionSystem、
 * PhaseTracker、TokenAggregator、combinators），对脚本作者隐藏全部底层细节。
 *
 * ## agentIndex 分配（R4.14）与 Resume 同步前导段（R4.15）
 *
 * 每次 `agent()` 被**同步调用的时刻**按 JS 执行顺序分配单调递增的 agentIndex。由于
 * `parallel(thunks.map(t => t()))` 按数组序依次调用各 thunk、`pipeline` 按确定遍历序
 * 调用各 stage，且 JS 单线程同步段不可被打断，因此 agentIndex 严格按调用发起序分配。
 *
 * Resume 模式下，`agent()` 的**同步前导段**（首个 await 之前）原子地完成：
 *   1) 分配 agentIndex；
 *   2) `shouldReuse(ctx, agentIndex, prompt, opts)` 复用判定（同步）；
 *   3) 命中则同步 `getCachedResult` 取缓存、更新 prefixValid。
 * 因同步段连续执行，复用决策与前缀终止状态严格按 agentIndex 序求值，并发下无竞态。
 *
 * ## agent() 执行流水（非复用路径）
 *
 *   分配 index（同步） → before-agent Hooks（reject → 返回 null）→ 写 agent_started
 *   Journal + 追加 workflow_agent 进度 → AgentExecutor.execute → 超时/失败置 null →
 *   after-agent Hooks（可 modify）→ 记录 token（aggregator input+output 口径）→
 *   写 agent_result Journal + 更新进度/Snapshot → 返回 output。
 *
 * ## workflow() 内联子 workflow（R4.5/R8.7/嵌套一层）
 *
 *   `workflow(name|{scriptPath,resumeFromRunId}, args)` 在**同一 run** 内联展开子脚本，
 *   **共享**并发信号量 / agentIndex 计数（通过共享同一 RunContext 实现）；最多嵌套
 *   一层，超限抛 `NESTING_DEPTH_EXCEEDED`；解析失败抛 `WORKFLOW_NOT_FOUND`。传入
 *   `resumeFromRunId` 时走**编程式恢复**（与 `/workflow resume` 命令路径不同）。
 *
 * @see .kiro/specs/opencode-workflows/design.md — 3. Orchestration_API / agentIndex 分配 / Resume 同步前导段
 * Requirements: 4.1, 4.4, 4.5, 4.14, 4.15, 5.2, 5.3, 5.4, 5.5, 5.6, 8.7
 */

import { WorkflowError } from "../errors"
import { WorkflowCancelled, WorkflowPaused } from "../engine/control-signals"
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type {
  AgentOptions,
  AgentProgress,
  AgentResult,
  JournalEntry,
  PhaseDefinition,
  ResolvedConfigBlock,
  WorkflowMeta,
} from "../types"
import type { AgentExecutor, AgentTask } from "../executor/agent-executor"
import type { ExtensionSystem, HookContext, HookDefinition } from "../extension/extension-system"
import type { ResumeContext, ResumeEngine } from "../resume/resume-engine"
import type { StateStore } from "../state/state-store"
import { createPhaseTracker, type PhaseTracker } from "./phase-tracker"
import { createTokenAggregator, type TokenAggregator } from "../state/token-aggregator"
import { parallel as parallelCombinator, pipeline as pipelineCombinator } from "./combinators"
import type { PipelineStage, Thunk } from "./combinators"

// ============================================================================
// 公开类型
// ============================================================================

/** 脚本可见的编排 API（即 execute(context) 的 context）。 */
export interface OrchestrationAPI {
  agent(prompt: string, opts?: AgentOptions): Promise<unknown | null>
  parallel<T>(thunks: Thunk<T>[]): Promise<(T | null)[]>
  pipeline<T>(items: T[], ...stages: PipelineStage[]): Promise<(unknown | null)[]>
  phase(title: string): void
  log(message: string): void
  /**
   * 产出落盘原语（问题 8 修复）：把文本内容写入绝对路径文件，父目录自动 `mkdir -p`。
   *
   * 由**框架**直接用 `node:fs` 同步写盘——脚本因此无需 `import`/`require`/动态 `import()`，
   * 保持「完全自包含、可独立加载」约束（内置 default-* 与 Studio 生成脚本统一受益）。
   * 取代旧的「让子 Agent 用 write 工具逐字复写大文档」落盘方式（既慢、烧 token、又易卡死/
   * 截断/改写）。
   *
   * 契约：
   * - `path` 为空/非字符串 → 抛 `WORKFLOW_ERROR`（脚本一般仅在 `ctx.config.outputPath` 非空时调用）；
   * - 成功 → 返回写入的绝对路径字符串；
   * - 写盘失败（权限/磁盘等）→ 抛错，由脚本 `try/catch` 降级为告警日志（落盘失败不应中断 run）。
   */
  writeFile(path: string, content: string): Promise<string>
  workflow(
    nameOrRef: string | { scriptPath: string; resumeFromRunId?: string },
    args?: unknown,
  ): Promise<unknown>
  args: unknown
  /**
   * 当前 workflow 全名对应的、已三层合并且路径绝对化的 ResolvedConfigBlock（R5.2/R5.3）。
   *
   * `template`/`rules`/`review` 为绝对路径数组（未配置 → 空数组）；`outputPath` 为最终
   * 绝对路径或 `null`，其 `<RUNID>`/`<FEATURE>` 占位符已由引擎在启动时替换完毕。配置文件
   * 全缺失或当前 workflow 名无对应配置块时为**降级空块**（见 {@link emptyConfigBlock}），
   * 不暴露 `undefined`。内联子 workflow 展开时按**子 workflow 自身 name** 解析其各自的
   * config 块（顶层与子层可不同），顶层 config 在子调用前后保持不变（R5.5）。
   */
  config: ResolvedConfigBlock
  /**
   * 当前 Run 的非空 runId 字符串（R5.4）。与 State_Store 中该 Run 的 Snapshot 与 Journal
   * 所用 runId 一致；内联子 workflow 与顶层共享同一 runId（共享同一 RunContext）。
   */
  runId: string
  /**
   * Workflow Pack 扩展点（R12.6/R12.8/R12.11）：供脚本注册 before-tool 等 Hook
   * 与 per-agent 系统文本贡献器。Phase 1 核心通过此公开面让 Workflow Pack（如
   * lingxi-harness）接入 write-guard 与精度约束注入，**不感知任何领域概念**。
   */
  extension: WorkflowExtensionApi
}

/** 脚本可用的扩展注册面（Workflow Pack 公开扩展点）。 */
export interface WorkflowExtensionApi {
  /** 注册一个 Hook（before-tool / before-agent / after-agent / workflow-complete）。 */
  registerHook(hook: HookDefinition): void
  /** 按名称注销 Hook。 */
  unregisterHook(name: string): void
  /**
   * 设置 per-agent 附加系统文本贡献器（R12.8）。返回的非空文本追加到子 Agent 系统提示。
   * 多次调用以最后一次为准（覆盖语义）。
   */
  setSystemContributor(
    fn: (info: { phase: string; prompt: string; opts: AgentOptions }) => string | undefined,
  ): void
}

/**
 * 子 workflow 加载器：把 nameOrRef 解析为 `{ meta, execute }`。
 *
 * 注入式以解耦 ScriptLoader 与 ExtensionSystem.resolveWorkflow：内联 workflow() 时
 * 由该函数解析并加载子脚本主体。
 */
export type SubWorkflowLoader = (
  nameOrRef: string | { scriptPath: string; resumeFromRunId?: string },
) => Promise<{ meta: WorkflowMeta; execute: (ctx: OrchestrationAPI) => Promise<unknown> }>

/**
 * RunContext —— 单个 Run 内被所有内联 workflow() 共享的运行时状态。
 *
 * 共享项：agentIndex 计数器、token 聚合、并发（经 AgentExecutor 内部 Semaphore）、
 * StateStore、ExtensionSystem、（可选）ResumeEngine 与 ResumeContext。
 */
export interface RunContext {
  runId: string
  store: StateStore
  executor: AgentExecutor
  extensions: ExtensionSystem
  tokens: TokenAggregator
  /** 共享的单调递增 agentIndex 计数器（同步分配）。 */
  nextAgentIndex: () => number
  /**
   * 顶层 workflow 全名对应的、已三层合并且路径绝对化的 ResolvedConfigBlock（R5.1/R5.2）。
   *
   * 由 WorkflowEngine 在 `createRunContext` 时注入（见 design.md 组件 6 / task 10.1）。
   * 内联子 workflow 不复用此值，而是按子 workflow 自身 name 经 {@link resolveConfig}
   * 重新解析（见 {@link OrchestrationApiOptions.config}）。
   *
   * 注：本字段声明为可选以保持本次改造（task 9.1）的最小爆炸半径——引擎注入由 task 10.1
   * 落地、既有测试断言由 task 9.2 补充。未注入时 `createOrchestrationApi` 暴露的 `config`
   * 降级为空块（{@link emptyConfigBlock}），绝不暴露 `undefined`（R5.3）。
   */
  config?: ResolvedConfigBlock
  /**
   * 可选：按 workflow 全名解析其 ResolvedConfigBlock 的回调（R5.5 子层 config 解析注入点）。
   *
   * 内联子 workflow（`workflow(name, args)`）展开时，{@link createOrchestrationApi} 用此回调
   * 以**子 workflow 自身 name** 解析其对应配置块注入子层 API。由 WorkflowEngine 在装配时
   * 注入（wired to ConfigLoader + resolveOutputPath，见 task 10.1）。未注入时回退为**复用顶层
   * config**（`run.config`），保证子调用前后顶层 config 不变、子层与顶层共享同一 runId。
   */
  resolveConfig?: (workflowName: string) => ResolvedConfigBlock | Promise<ResolvedConfigBlock>
  /** Resume 模式下的引擎与上下文；非 resume 时为 undefined。 */
  resume?: { engine: ResumeEngine; ctx: ResumeContext }
  /**
   * 引擎默认模型（可选，`"providerID/modelID"` 形态）。
   *
   * 由 WorkflowEngine 在 start() 时经 `deps.resolveDefaultModel()` 解析注入（run 级唯一值，
   * 见 src/engine/default-model.ts）。`agent()` 在脚本 `opts.model` 缺失时把它注入
   * `AgentTask.defaultModel`，使请求显式带模型、不进 server 回退链。未注入（解析失败/
   * 依赖缺失）时 agent 行为与既有版本逐字节一致。
   */
  defaultModel?: string
  /**
   * 失败原因倒查（可选）。
   *
   * 由装配层注入（内存日志环形缓冲，index.ts memorySink）。`agent()` 在 execute 返回 null
   * 时以 agentIndex 倒查最近一条 ERROR 日志的真实 reason，写入 journal 的 error 字段
   * （此前写死「agent execution failed or timed out」）。未注入/查不到时回退原串。
   */
  lookupFailureReason?: (agentIndex: number) => string | undefined
  /** 子 workflow 加载器（内联展开用）。 */
  loadSubWorkflow: SubWorkflowLoader
  /**
   * 可选：per-agent 附加系统文本贡献器（Workflow Pack 扩展点，R12.8）。
   * 每次 agent() 执行前以 (phase, prompt, opts) 调用，返回的非空文本将追加到该子 Agent
   * 的系统提示之后（经 AgentExecutor 注入）。lingxi-harness 用此注入金融精度约束。
   */
  systemContributor?: (info: { phase: string; prompt: string; opts: AgentOptions }) => string | undefined
  /**
   * 可选：同步读取该 run 的控制信号（pause/cancel/none）。由 WorkflowEngine 在装配
   * 时注入（指向该 run 的 `ActiveRun.controlSignal`）。`agent()` 同步前导段据此在
   * 「下一个 agent 边界」短路当前执行体（pause/cancel）。未注入时默认 "none"，不影响
   * 现有流程。
   * Requirements: 4.2, 5.1
   */
  readControlSignal?: () => "none" | "pause" | "cancel"
}

/** Orchestration_API 工厂选项。 */
export interface OrchestrationApiOptions {
  /** 外部传入参数（顶层启动时为 undefined）。 */
  args?: unknown
  /** 嵌套深度（顶层 0，内联子 workflow 为 1；> 1 抛 NESTING_DEPTH_EXCEEDED）。 */
  depth?: number
  /**
   * 显式注入该（子）workflow 的 ResolvedConfigBlock（R5.5）。
   *
   * 内联子 workflow 展开时由 {@link createOrchestrationApi} 内部按子 workflow 自身 name
   * 解析后经此项传入，使子层 `ctx.config` 反映子 workflow 名对应的配置块。顶层调用一般
   * 不传此项——此时回退到 `run.config`，再回退到降级空块（{@link emptyConfigBlock}）。
   */
  config?: ResolvedConfigBlock
}

/** 最大内联嵌套层数（R4.5：最多嵌套一层）。 */
export const MAX_NESTING_DEPTH = 1

/**
 * 构造一个降级空 ResolvedConfigBlock（R5.3）。
 *
 * 配置文件全缺失或当前 workflow 名无对应配置块时，`ctx.config` 暴露此空块而非
 * `undefined`。新形状（workflow-create-studio 能力域 C）：开放资源字典 `resources`
 * 与引导语 `resourceLabels` 均为空对象，知名三类别名 `template`/`rules`/`review` 为
 * 空数组、`outputPath` 为 `null`。任意类别经 `ctx.config.resources[<类别>]` 求值为
 * `undefined`（脚本侧以 `?? []` 或 `&& .length` 守卫回退空，R10.6）。每次调用返回
 * **新对象**，避免脚本意外共享/改写同一引用。
 */
export function emptyConfigBlock(): ResolvedConfigBlock {
  return {
    resourcesByPhase: {},
    resourceLabelsByPhase: {},
    outputPathByPhase: {},
    maxReviewRoundsByPhase: {},
    // 旧版兼容字段（已废弃，保留空值）
    resources: {},
    resourceLabels: {},
    template: [],
    rules: [],
    review: [],
    outputPath: null,
    maxReviewRounds: 3,
  }
}

// ============================================================================
// 工厂
// ============================================================================

/**
 * 创建 Run 级共享状态（顶层调用一次）。token 聚合在此初始化，内联 workflow()
 * 共享同一 RunContext，从而共享并发/计数/token 聚合。
 *
 * @param base 注入的协作者（runId/store/executor/extensions/loadSubWorkflow/resume）。
 */
export function createRunContext(
  base: Omit<RunContext, "tokens" | "nextAgentIndex"> & {
    tokens?: TokenAggregator
  },
): RunContext {
  let counter = 0
  return {
    ...base,
    tokens: base.tokens ?? createTokenAggregator(),
    nextAgentIndex: () => counter++,
  }
}

/**
 * 在给定 {@link RunContext} 与 meta 之上装配一个 {@link OrchestrationAPI}。
 *
 * 每个（子）workflow 脚本拥有自己的 {@link PhaseTracker}（按各自 meta.phases），但共享
 * 同一 RunContext（并发/计数/token/store/extensions）。
 *
 * @param run 共享 RunContext。
 * @param meta 当前脚本的 meta（用于 PhaseTracker 阶段校验）。
 * @param options 见 {@link OrchestrationApiOptions}。
 */
export function createOrchestrationApi(
  run: RunContext,
  meta: WorkflowMeta,
  options: OrchestrationApiOptions = {},
): OrchestrationAPI {
  const depth = options.depth ?? 0
  const phaseTracker: PhaseTracker = createPhaseTracker(meta.phases ?? [])
  const declaredPhases: PhaseDefinition[] = meta.phases ?? []

  // 本（子）workflow 暴露给脚本的 config（R5.2/R5.3）：
  //   1) 优先用显式注入的 options.config（内联子 workflow 展开时按子 name 解析后传入）；
  //   2) 否则用 RunContext 注入的顶层 config（run.config，由引擎 task 10.1 注入）；
  //   3) 仍无则降级为空块——绝不暴露 undefined。
  // 每个 API 实例持有自己的 config 引用，故子调用不改写顶层 config（R5.5）。
  const config: ResolvedConfigBlock = options.config ?? run.config ?? emptyConfigBlock()

  /** 求 phase 在 meta.phases 中的索引（用于进度条目 phaseIndex）；未声明返回 -1。 */
  function phaseIndexOf(title: string | undefined): number {
    if (title === undefined) return -1
    return declaredPhases.findIndex((p) => p.title === title)
  }

  // ------------------------------------------------------------------------
  // agent()
  // ------------------------------------------------------------------------
  async function agent(prompt: string, opts: AgentOptions = {}): Promise<unknown | null> {
    // ===== 同步前导段（R4.15）：分配 index → Resume 复用判定（原子，按序）=====
    const agentIndex = run.nextAgentIndex()

    // ===== Control_Signal 检查（同步前导段，phase 解析与 Resume shouldReuse 之前）=====
    // 在 started 事件写入之前短路：被 pause/cancel 中止的 agent 天然不留 Journal 记录
    // （既无 started 也无成功 result），resume 时据「completed 才复用」判定将其重跑（R4.6）。
    const controlSignal = run.readControlSignal?.() ?? "none"
    if (controlSignal === "pause") throw new WorkflowPaused(run.runId)
    if (controlSignal === "cancel") throw new WorkflowCancelled(run.runId)

    const phaseTitle = phaseTracker.resolve(opts.phase) // 可能抛 META_INVALID（阶段未声明）
    const phase = phaseTitle ?? ""

    if (run.resume) {
      const { engine, ctx } = run.resume
      // shouldReuse 为同步函数：在首个 await 之前完成复用决策与 prefixValid 更新。
      if (engine.shouldReuse(ctx, agentIndex, prompt, opts)) {
        const cached: AgentResult = engine.getCachedResult(ctx, agentIndex)
        // 复用命中：仍记录 token 与进度，保证 Snapshot/预算口径一致。
        await recordReusedResult(agentIndex, prompt, phase, phaseTitle, opts, cached)
        return cached.output
      }
    }

    // ===== before-agent Hooks（reject → agent() 返回 null）=====
    const beforeCtx: HookContext = {
      runId: run.runId,
      phase,
      agentIndex,
      prompt,
      opts,
    }
    const beforeResult = await run.extensions.runBeforeAgentHooks(beforeCtx)
    if (beforeResult.action === "reject") {
      return null
    }

    // ===== 写 agent_started Journal + 追加 workflow_agent 进度 =====
    const startedEntry: JournalEntry = {
      eventType: "agent_started",
      agentIndex,
      timestamp: Date.now(),
      prompt,
      phase,
      opts,
    }
    await run.store.appendJournal(run.runId, startedEntry)

    const label = (opts.label ?? prompt).slice(0, 80)
    const progress: AgentProgress = {
      type: "workflow_agent",
      index: agentIndex,
      label,
      phaseIndex: phaseIndexOf(phaseTitle),
      phaseTitle: phaseTitle ?? "",
      //运行中即显示将用的模型（脚本显式 > 引擎默认），不再恒空。
      model: opts.model ?? run.defaultModel ?? "",
      state: "running",
      tokens: 0,
      durationMs: 0,
    }
    await run.store.appendProgress(run.runId, progress)

    // ===== 执行（受并发/总数控制；超时/失败 → null）=====
    const extraSystem = run.systemContributor?.({ phase, prompt, opts })
    const task: AgentTask = {
      prompt,
      opts,
      runId: run.runId,
      agentIndex,
      phase,
      ...(extraSystem ? { extraSystem } : {}),
      //脚本未显式指定 model 且引擎已解析出默认模型时注入（仅 AgentTask 层，
      // 不改写 opts——opts 原样落盘 journal 并参与 resume 比对，保持旧 run 兼容）。
      ...(!opts.model && run.defaultModel ? { defaultModel: run.defaultModel } : {}),
      // 子 session 创建后即回填 sessionID 到 Snapshot（R 第二期），供 Monitor 实时拉取
      // 该 agent 的会话日志。回调为同步签名，落盘以 fire-and-forget 进行（写盘失败由 store 容错）。
      onSessionCreated: (idx, sessionID) => {
        void run.store.updateProgress(run.runId, idx, { sessionID }).catch(() => {})
      },
    }
    const result = await run.executor.execute(task)

    // ===== 近实时打断复查（FIX-1 增强：accept-discard 语义）=====
    // 执行返回后立即复查控制信号：若在本 agent 执行期间收到 pause/cancel，`pause()`/`cancel()`
    // 已调用 executor.destroy() **近实时 abort** 在途子 session（execute 多半因此返回 null）。
    // 此处在**本 agent 边界**抛控制异常，而非等下一个 agent() 调用——这样即便被打断的是
    // 单 agent workflow 的唯一 agent、或末位 agent（其后再无 agent() 调用），run 也能正确落
    // paused/cancelled，不会误判为 completed。被 abort 的 agent 因 result 事件含 error，
    // resume 时据「completed 才复用」判定将其**重跑**（R4.6，符合用户「打断的 Agent 重跑」预期）。
    const signalAfter = run.readControlSignal?.() ?? "none"

    if (result === null) {
      // 超时/失败/被打断：写 result Journal（含 error）+ 标记进度 failed。
      const interrupted = signalAfter === "pause" || signalAfter === "cancel"
      //非打断失败时倒查内存日志中该 agent 最近一条 ERROR 的真实 reason
      // （session.create 失败 / SDK 错误 / 超时均带 reason 落日志），替代笼统串；
      // 查不到（未注入 lookupFailureReason / 日志被环形覆盖）回退原串。
      const lookedUp = interrupted ? undefined : run.lookupFailureReason?.(agentIndex)
      const rawReason = lookedUp ?? "agent execution failed or timed out"
      // server 内部 500 的归因附注（reason 为笼统的 "Unexpected server error..."，
      // 最常见根因是顶层 model 缺失致默认模型解析失败——见 error 中间件 orDie 链路）。
      const reason = rawReason.includes("Unexpected server error")
        ? rawReason +
          "（服务端内部错误——最常见原因为 opencode.json 缺顶层 model 配置，对话可用但子 Agent 全灭；" +
          "详见 server 日志 err_* 堆栈）"
        : rawReason
      const failEntry: JournalEntry = {
        eventType: "agent_result",
        agentIndex,
        timestamp: Date.now(),
        // 区分「被 pause/cancel 近实时打断」与「自身超时/失败」，便于审计与 Monitor 展示；
        // 两者都含 error 字段 → resume 时均不复用、需重跑。
        error: interrupted
          ? `agent 被 ${signalAfter} 近实时打断（in-flight abort，resume 时重跑）`
          : reason,
        durationMs: 0,
      }
      await run.store.appendJournal(run.runId, failEntry)
      await run.store.updateProgress(run.runId, agentIndex, { state: "failed" })

      // 近实时打断优先于 required 护栏：pause/cancel 时在本边界抛控制异常落 paused/cancelled，
      // 而不是抛 REQUIRED_STEP_FAILED 把 run 打成 failed（用户是主动暂停/取消，非步骤真失败）。
      if (signalAfter === "pause") throw new WorkflowPaused(run.runId)
      if (signalAfter === "cancel") throw new WorkflowCancelled(run.runId)

      // ===== 关键步 required 护栏与受控终止（P5-B，R7.2/R7.3/R7.4）=====
      // required 步在重试耗尽后仍 null → 抛 REQUIRED_STEP_FAILED 终止 run；
      // throw 后 agent() 不返回值，下游 str() 不会执行——不向下游静默注入 [无结果]。
      if (opts.required) {
        const step = opts.label ?? `agent#${agentIndex}`
        const reason = "agent execution failed or timed out"
        throw new WorkflowError(
          "REQUIRED_STEP_FAILED",
          `关键步「${step}」在重试耗尽后仍无结果，终止 run`,
          { runId: run.runId, agentIndex, step, phase, reason },
        )
      }

      // 非 required 步：保持既有行为返回 null（下游 str() 可注入 [无结果]）。
      return null
    }

    // ===== after-agent Hooks（可 modify 结果）=====
    const afterCtx: HookContext = {
      runId: run.runId,
      phase,
      agentIndex,
      prompt,
      opts,
      result: result.output,
    }
    const afterResult = await run.extensions.runAfterAgentHooks(afterCtx)
    const finalOutput =
      afterResult.action === "modify" ? afterResult.result : result.output

    // ===== 记录 token：aggregator（input+output 口径）=====
    run.tokens.add(result.tokens.input, result.tokens.output)

    // ===== 写 agent_result Journal + 更新进度 + 推进 Snapshot 聚合字段 =====
    const resultEntry: JournalEntry = {
      eventType: "agent_result",
      agentIndex,
      timestamp: Date.now(),
      result: finalOutput,
      input_tokens: result.tokens.input,
      output_tokens: result.tokens.output,
      durationMs: result.durationMs,
      // 记录实际模型：Resume 复用路径重建进度条目时据此还原（此前缺失导致 resume 后
      // 复用的 agent 在 Monitor 显示 "—" 而非真实模型）。
      model: result.model,
    }
    await run.store.appendJournal(run.runId, resultEntry)
    await run.store.updateProgress(run.runId, agentIndex, {
      state: "done",
      model: result.model || (opts.model ?? ""),
      tokens: result.tokens.input + result.tokens.output,
      durationMs: result.durationMs,
    })
    await run.store.updateRun(run.runId, {
      agentCount: run.executor.totalCount(),
      totalTokens: run.tokens.totalTokens(),
    })

    // 近实时打断复查（成功路径）：若本 agent 成功完成的同时收到了 pause/cancel 信号
    // （窄竞态：abort 未来得及打断、agent 已成功返回，或信号在落盘期间到达），在本边界抛
    // 控制异常落 paused/cancelled。重新读取信号（而非复用 execute 返回时的 signalAfter），
    // 以捕获在 after-agent Hooks / 落盘等 await 期间才到达的信号。此 agent 的 result 已记为
    // completed（不含 error）→ resume 时据「completed 才复用」复用其结果、不重跑（符合预期：
    // 它确实跑完了）。这样末位/单 agent 也能即时响应 pause，不会忽略信号。
    const signalDone = run.readControlSignal?.() ?? "none"
    if (signalDone === "pause") throw new WorkflowPaused(run.runId)
    if (signalDone === "cancel") throw new WorkflowCancelled(run.runId)

    return finalOutput
  }

  /**
   * 复用命中路径的记录：追加 done 进度、累加 token，保证 Snapshot/预算口径与正常执行
   * 一致。（不写 Journal——复用不改写审计记录。）
   *
   * 进度更新用 updateProgress（**merge**）而非 appendProgress（整条覆盖）：旧快照条目上
   * 由 onSessionCreated 回填的 sessionID 得以保留（此前整条覆盖会把 resume 前完成 agent
   * 的 sessionID 抹掉，Monitor 下钻这些 agent 时无法关联子 session 拉会话日志）。
   */
  async function recordReusedResult(
    agentIndex: number,
    prompt: string,
    phase: string,
    phaseTitle: string | undefined,
    opts: AgentOptions,
    cached: AgentResult,
  ): Promise<void> {
    void prompt
    void phase
    void phaseTitle
    run.tokens.add(cached.tokens.input, cached.tokens.output)
    await run.store.updateProgress(run.runId, agentIndex, {
      state: "done",
      model: cached.model || (opts.model ?? ""),
      tokens: cached.tokens.input + cached.tokens.output,
      durationMs: cached.durationMs,
    })
    await run.store.updateRun(run.runId, {
      totalTokens: run.tokens.totalTokens(),
    })
  }

  // ------------------------------------------------------------------------
  // parallel() / pipeline()
  // ------------------------------------------------------------------------
  function parallel<T>(thunks: Thunk<T>[]): Promise<(T | null)[]> {
    return parallelCombinator(thunks)
  }
  function pipeline<T>(items: T[], ...stages: PipelineStage[]): Promise<(unknown | null)[]> {
    return pipelineCombinator(items, ...stages)
  }

  // ------------------------------------------------------------------------
  // phase() / log()
  // ------------------------------------------------------------------------
  function phase(title: string): void {
    phaseTracker.phase(title) // META_INVALID 若不匹配
    // 追加 workflow_phase 进度条目（fire-and-forget；写盘失败由 store 内部容错）。
    const index = phaseIndexOf(title)
    void run.store.appendProgress(run.runId, { type: "workflow_phase", index, title })
  }

  function log(message: string): void {
    void run.store.appendLog(run.runId, message)
  }

  /**
   * 产出落盘原语（问题 8 修复）：框架直接用 node:fs 同步写盘，父目录自动 mkdir -p。
   * 脚本无需任何 import，保持自包含。空路径抛错；写盘失败由 writeFileSync 抛错传给脚本
   * try/catch。成功返回写入的绝对路径。
   */
  async function writeFile(path: string, content: string): Promise<string> {
    if (typeof path !== "string" || path.trim().length === 0) {
      throw new Error("writeFile: 目标路径为空或非字符串")
    }
    const text = typeof content === "string" ? content : String(content)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text, "utf8")
    return path
  }

  // ------------------------------------------------------------------------
  // workflow()（内联子 workflow，共享并发/计数/预算，最多嵌套一层）
  // ------------------------------------------------------------------------
  async function workflow(
    nameOrRef: string | { scriptPath: string; resumeFromRunId?: string },
    args?: unknown,
  ): Promise<unknown> {
    // 嵌套深度守卫（R4.5）。
    if (depth >= MAX_NESTING_DEPTH) {
      throw new WorkflowError(
        "NESTING_DEPTH_EXCEEDED",
        `workflow() 嵌套深度超过上限（最多嵌套 ${MAX_NESTING_DEPTH} 层）`,
        { runId: run.runId, depth },
      )
    }

    // 解析并加载子脚本（解析失败抛 WORKFLOW_NOT_FOUND）。
    const sub = await run.loadSubWorkflow(nameOrRef)

    // 按**子 workflow 自身 name** 解析其 config 块（R5.5）：经 RunContext 注入的
    // resolveConfig 回调（由引擎 wired to ConfigLoader）解析；未注入时回退为复用顶层
    // config（run.config）——保证降级运行不报错，待 task 10.1 接线后子层取到自身配置。
    // 顶层 config 持有在外层闭包 `config` 变量中，子调用不改写它（子调用前后顶层不变）。
    let subConfig: ResolvedConfigBlock
    if (run.resolveConfig) {
      subConfig = await run.resolveConfig(sub.meta.name)
    } else {
      subConfig = run.config ?? emptyConfigBlock()
    }

    // 内联子 API：共享同一 RunContext（并发/计数/token/store/extensions、同一 runId），
    // depth+1，args 为子 workflow 的入参，config 为按子 name 解析的子层配置块。
    const subApi = createOrchestrationApi(run, sub.meta, {
      args,
      depth: depth + 1,
      config: subConfig,
    })
    return sub.execute(subApi)
  }

  // ------------------------------------------------------------------------
  // extension（Workflow Pack 扩展点）
  // ------------------------------------------------------------------------
  const extension: WorkflowExtensionApi = {
    registerHook: (hook: HookDefinition) => run.extensions.registerHook(hook),
    unregisterHook: (name: string) => run.extensions.unregisterHook(name),
    setSystemContributor: (fn) => {
      run.systemContributor = fn
    },
  }

  return {
    agent,
    parallel,
    pipeline,
    phase,
    log,
    writeFile,
    workflow,
    args: options.args,
    config,
    runId: run.runId,
    extension,
  }
}

import { EventPriority, EventType, type EventBus, type EventBusPersistFn, createSimpleEventBus } from "./event-bus"
import { AgentStateMachine, AgentState, StateTransitionError } from "./state-machine"
import { CheckpointManager, type L1Snapshot, type L2Snapshot, type L3Snapshot, type ContextSummary } from "./checkpoint"
import { DAGPlanner, CapabilityRegistry, ExecutionStrategy, type Capability } from "./planner"
import { MemorySystem } from "./memory"
import { RepairMemoryEngine } from "./repair"
import { EntropyController } from "./entropy"
import { ValidationNetwork } from "./validation"
import { BranchManager, type SessionBranch } from "./branch"
import { EventArchiver } from "./archiver"
import { SkillSystem, HookPoints } from "./skill"
import { GitTransactionManager } from "./transactional-fs"
import { StatelessWorkerPool, type WorkerTask } from "./worker"
import { SessionReplayer, type ReplayMode, type ReplayResult } from "./replay"
import type { EngineDatabase } from "./db/engine-database"
import type { LLMDAGGenerator } from "./llm/llm-dag-generator"
import {
  validateDAG,
  getReadyNodes,
  markNodeFailed,
  isComplete,
  allSucceeded,
  getTransitiveDependents,
  type DAG,
  type DAGNode,
} from "./dag"

/** Data-driven validation layer configuration for runValidation */
interface ValidationLayer {
  name: string
  minRiskLevel: number
  minContentLength?: number
  contentPattern?: RegExp
  /** Name of the ValidationNetwork method to call */
  validateMethod: "runSyntaxValidation" | "runSemanticValidation" | "runSecurityValidation" | "runRuntimeValidation"
  failThreshold: number
  passThreshold?: number
  failPriority: EventPriority
  passPriority?: EventPriority
}

const VALIDATION_LAYERS: ValidationLayer[] = [
  { name: "syntax", minRiskLevel: 0, minContentLength: 50, contentPattern: /[{]|function/, validateMethod: "runSyntaxValidation", failThreshold: 0.5, failPriority: EventPriority.NORMAL },
  { name: "semantic", minRiskLevel: 2, validateMethod: "runSemanticValidation", failThreshold: 1.0, passThreshold: 0.7, failPriority: EventPriority.NORMAL, passPriority: EventPriority.NORMAL },
  { name: "security", minRiskLevel: 1, validateMethod: "runSecurityValidation", failThreshold: 0.5, failPriority: EventPriority.HIGH },
  { name: "runtime", minRiskLevel: 0, contentPattern: /error|fail|crash|exception|stack trace/i, validateMethod: "runRuntimeValidation", failThreshold: 0.5, passThreshold: 0.5, failPriority: EventPriority.HIGH, passPriority: EventPriority.NORMAL },
]

export interface EngineConfig {
  maxSteps: number
  maxRetries: number
  tokenBudget: number
  validationThreshold: number
}

export interface EngineSnapshot {
  sessionId: string
  state: string
  dagVersion: number
  stepCount: number
  tokenUsage: number
  checkpoints: { l1: number; l2: number; l3: number }
  currentDAG: DAG | null
}

export class AgentEngine {
  readonly stateMachine: AgentStateMachine
  readonly eventBus: EventBus
  readonly checkpoints: CheckpointManager
  readonly planner: DAGPlanner
  readonly registry: CapabilityRegistry
  readonly memory: MemorySystem
  readonly repair: RepairMemoryEngine
  readonly entropy: EntropyController
  readonly validation: ValidationNetwork
  readonly branches: BranchManager
  readonly archiver: EventArchiver
  readonly skills: SkillSystem
  txFilesystem: GitTransactionManager
  dagGenerator: LLMDAGGenerator | null
  readonly workerPool: StatelessWorkerPool
  readonly replayer: SessionReplayer

  private config: EngineConfig
  private sessionId: string
  private engineDb: EngineDatabase | null = null

  get maxSteps(): number {
    return this.config.maxSteps
  }
  private stepCount = 0
  private tokenUsage = 0
  private currentDAG: DAG | null = null
  private consecutiveFailures = 0
  private replanCount = 0
  private workspaceHash = ""

  constructor(config?: Partial<EngineConfig>, persistFn?: EventBusPersistFn) {
    this.config = {
      maxSteps: config?.maxSteps ?? 100,
      maxRetries: config?.maxRetries ?? 3,
      tokenBudget: config?.tokenBudget ?? 1_000_000,
      validationThreshold: config?.validationThreshold ?? 0.7,
    }

    this.stateMachine = new AgentStateMachine()
    this.checkpoints = new CheckpointManager()
    this.registry = new CapabilityRegistry()
    this.planner = new DAGPlanner(this.registry)
    this.memory = new MemorySystem()
    this.repair = new RepairMemoryEngine()
    this.entropy = new EntropyController({ tokenBudget: this.config.tokenBudget })
    this.validation = new ValidationNetwork({ threshold: this.config.validationThreshold })
    this.branches = new BranchManager()
    this.archiver = new EventArchiver()
    this.skills = new SkillSystem()
    this.txFilesystem = new GitTransactionManager()
    this.dagGenerator = null
    this.workerPool = new StatelessWorkerPool()
    this.replayer = new SessionReplayer()
    this.eventBus = createSimpleEventBus(persistFn)
    this.sessionId = ""

    this.setupErrorHooks()
  }

  /** Wire the engine to a persistent database for session tracking, branch/archive DB ops */
  setEngineDatabase(db: EngineDatabase): void {
    this.engineDb = db
  }

  private syncSessionStatus(status: string, checkpointId?: string): void {
    if (!this.engineDb) return
    this.engineDb.updateSessionStatus(this.sessionId, status, checkpointId)
  }

  private setupErrorHooks(): void {
    this.stateMachine.onEnter(AgentState.ERROR, async (prev, reason) => {
      await this.createCheckpoint()

      await this.eventBus.publish({
        type: EventType.ERROR_OCCURRED,
        source: "AgentEngine",
        session_id: this.sessionId,
        data: { previous_state: prev, error_reason: reason },
        priority: EventPriority.CRITICAL,
        timestamp: Date.now(),
        require_persistence: true,
      })

      const metrics = {
        totalSteps: this.stepCount,
        retryCount: this.replanCount,
        consecutiveFailures: this.consecutiveFailures,
        cumulativeTokens: this.tokenUsage,
        executionTimeMs: 0,
        validationPassRate: 1.0,
        resultDivergence: 0,
      }
      const action = this.entropy.evaluate(metrics)

      if (action === "ROLLBACK" || action === "TERMINATE") {
        const l2Cp = this.checkpoints.getLatest("L2")
        if (l2Cp && action === "ROLLBACK") {
          await this.resume(l2Cp.checkpoint_id)
        } else {
          await this.stateMachine.transition(AgentState.FAILED, `entropy: ${action}`)
        }
      }
    })
  }

  private async emitStateTransition(to: AgentState, reason?: string): Promise<void> {
    const from = this.stateMachine.state
    if (from === to) return
    await this.stateMachine.transition(to, reason)

    // Sync engine_session status
    this.syncSessionStatus(to)

    await this.eventBus.publish({
      type: EventType.STATE_TRANSITION,
      source: "AgentEngine",
      session_id: this.sessionId,
      data: {
        from,
        to,
        reason: reason ?? "automatic",
        checkpoint_id: this.checkpoints.getLatest("L1")?.checkpoint_id,
      },
      priority: EventPriority.CRITICAL,
      timestamp: Date.now(),
      require_persistence: true,
    })
  }

  async initialize(sessionId: string, goal: string, workspaceHash = ""): Promise<void> {
    this.sessionId = sessionId
    this.stepCount = 0
    this.tokenUsage = 0
    this.consecutiveFailures = 0
    this.replanCount = 0
    this.workspaceHash = workspaceHash

    // Register session in engine_session table
    if (this.engineDb) {
      this.engineDb.upsertSession({ session_id: sessionId, title: goal.slice(0, 100), status: "IDLE" })
    }

    await this.emitStateTransition(AgentState.INITIALIZING)
    await this.skills.triggerHook(HookPoints.SESSION_INIT, { sessionId, goal })
    await this.emitStateTransition(AgentState.READY)
  }

  async plan(goal: string, capabilities: Capability[]): Promise<{ dag: DAG; strategy: ExecutionStrategy }> {
    await this.emitStateTransition(AgentState.PLANNING)

    const metrics = {
      totalSteps: this.stepCount,
      retryCount: this.replanCount,
      consecutiveFailures: this.consecutiveFailures,
      cumulativeTokens: this.tokenUsage,
      executionTimeMs: 0,
      validationPassRate: 1.0,
      resultDivergence: 0,
    }

    const entropyAction = this.entropy.evaluate(metrics)
    if (entropyAction === "TERMINATE" || entropyAction === "ROLLBACK") {
      throw new Error(`Entropy controller blocked planning: ${entropyAction}`)
    }

    const tokenPercent = this.tokenUsage / this.config.tokenBudget
    const strategy = this.planner.selectStrategy(goal, capabilities, this.consecutiveFailures, tokenPercent)

    const skillInjection = this.skills.buildPromptInjection(goal)
    const prompt = skillInjection ? `${skillInjection}\n\n${goal}` : goal

    let dag: DAG
    let validation

    if (this.dagGenerator) {
      dag = await this.dagGenerator.generateDAG(prompt, capabilities)
      validation = validateDAG(dag)
    } else {
      const result = this.planner.buildDAGPlan(prompt, capabilities, strategy, "")
      dag = result.dag
      validation = result.validation
    }

    if (!validation.valid) {
      await this.eventBus.publish({
        type: EventType.PLANNING_FAILED,
        source: "AgentEngine",
        session_id: this.sessionId,
        data: { error: validation.error, cycle_nodes: validation.cycleNodes },
        priority: EventPriority.HIGH,
        timestamp: Date.now(),
        require_persistence: true,
      })
      throw new Error(`DAG validation failed: ${validation.error}`)
    }

    this.currentDAG = dag
    this.replanCount = 0

    await this.eventBus.publish({
      type: EventType.DAG_GENERATED,
      source: "AgentEngine",
      session_id: this.sessionId,
      data: {
        version: dag.version,
        node_count: dag.nodes.length,
        edge_count: dag.edges.length,
        strategy: dag.metadata?.strategy,
        execution_order: validation.executionOrder,
      },
      priority: EventPriority.HIGH,
      timestamp: Date.now(),
      require_persistence: true,
    })

    await this.emitStateTransition(AgentState.THINKING, "DAG generated")
    return { dag, strategy }
  }

  async executeStep(): Promise<{ completed: boolean; allSucceeded: boolean }> {
    if (!this.currentDAG) {
      throw new Error("No DAG to execute. Call plan() first.")
    }

    await this.emitStateTransition(AgentState.EXECUTING)

    const readyNodes = getReadyNodes(this.currentDAG)

    if (readyNodes.length === 0) {
      const done = isComplete(this.currentDAG)
      const success = allSucceeded(this.currentDAG)

      if (done && success) {
        await this.emitStateTransition(AgentState.VERIFYING)
        await this.emitStateTransition(AgentState.COMPLETED)
      } else if (done) {
        await this.emitStateTransition(AgentState.VERIFYING)
        await this.emitStateTransition(AgentState.FAILED)
      }

      return { completed: done, allSucceeded: success }
    }

    // Execute ready nodes — use worker pool for parallel execution when >1 node
    if (readyNodes.length > 1) {
      await this.executeNodesParallel(readyNodes)
    } else {
      await this.executeNode(readyNodes[0])
    }

    // Post-step: Entropy evaluation
    const metrics = {
      totalSteps: this.stepCount,
      retryCount: this.replanCount,
      consecutiveFailures: this.consecutiveFailures,
      cumulativeTokens: this.tokenUsage,
      executionTimeMs: 0,
      validationPassRate: 1.0,
      resultDivergence: 0,
    }
    const entropyAction = this.entropy.evaluate(metrics)
    if (entropyAction !== "CONTINUE") {
      await this.eventBus.publish({
        type: EventType.ENTROPY_ALERT,
        source: "AgentEngine",
        session_id: this.sessionId,
        data: { action: entropyAction, metrics },
        priority: EventPriority.HIGH,
        timestamp: Date.now(),
        require_persistence: true,
      })

      if (entropyAction === "PAUSE") {
        await this.pause()
        return { completed: false, allSucceeded: false }
      }
      if (entropyAction === "ROLLBACK") {
        const l2Cp = this.checkpoints.getLatest("L2")
        if (l2Cp) await this.rollbackToCheckpoint(l2Cp.checkpoint_id)
        return { completed: false, allSucceeded: false }
      }
      if (entropyAction === "TERMINATE") {
        await this.emitStateTransition(AgentState.FAILED, "entropy: TERMINATE")
        return { completed: true, allSucceeded: false }
      }
    }

    // Post-step: Archive cycle check
    if (this.engineDb) {
      const eventCount = this.engineDb.countEvents(this.sessionId)
      if (this.archiver.shouldArchive(eventCount)) {
        await this.archiver.archive(this.sessionId)
      }
    }

    // Post-step: L1 checkpoint
    await this.createCheckpoint()

    return { completed: false, allSucceeded: false }
  }

  /** Execute a single node through capability handler + validation + hooks */
  private async executeNode(node: DAGNode): Promise<void> {
    node.status = "running"

    await this.eventBus.publish({
      type: EventType.TOOL_CALL,
      source: "AgentEngine",
      session_id: this.sessionId,
      data: { node_id: node.node_id, capability_id: node.capability_id, inputs: node.inputs },
      priority: EventPriority.NORMAL,
      timestamp: Date.now(),
      require_persistence: true,
    })

    try {
      const cap = this.registry.get(node.capability_id)
      if (cap?.handler) {
        const output = await cap.handler(node.inputs)
        node.output = output
        node.status = "completed"
        this.consecutiveFailures = 0
        this.registry.recordExecution(node.capability_id, true, node.estimated_duration_ms, node.estimated_tokens)

        // Post-execution: 4-layer validation
        await this.runValidation(node, output)

        // Fire tool:after-call hook for error recovery integration
        await this.skills.triggerHook(HookPoints.TOOL_AFTER_CALL, {
          tool: node.capability_id,
          inputs: node.inputs,
          output,
          success: true,
          node_id: node.node_id,
        })

        await this.eventBus.publish({
          type: EventType.TOOL_RESULT,
          source: "AgentEngine",
          session_id: this.sessionId,
          data: { node_id: node.node_id, output, status: "success" },
          priority: EventPriority.HIGH,
          timestamp: Date.now(),
          require_persistence: true,
        })
      } else {
        node.status = "completed"
        this.consecutiveFailures = 0
      }

      this.tokenUsage += node.estimated_tokens
      this.stepCount++
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      await this.handleNodeFailure(node, errorMessage)
    }
  }

  /** Run data-driven multi-layer validation on node output */
  private async runValidation(node: DAGNode, output: unknown): Promise<void> {
    const outputStr = typeof output === "string" ? output : JSON.stringify(output ?? "")
    const goal = this.currentDAG?.metadata?.goal ?? ""

    for (const layer of VALIDATION_LAYERS) {
      if (node.risk_level < layer.minRiskLevel) continue
      if (layer.minContentLength !== undefined && outputStr.length < layer.minContentLength) continue
      if (layer.contentPattern && !layer.contentPattern.test(outputStr)) continue

      const extraArg = layer.name === "semantic" ? goal : `${node.capability_id}.output`
      const result = await (this.validation[layer.validateMethod] as Function).call(this.validation, outputStr, extraArg)

      if (result.score < layer.failThreshold) {
        await this.eventBus.publish({
          type: EventType.VALIDATION_FAILED,
          source: "AgentEngine",
          session_id: this.sessionId,
          data: { layer: layer.name, node_id: node.node_id, score: result.score, report: result.report },
          priority: layer.failPriority,
          timestamp: Date.now(),
          require_persistence: true,
        })
      } else if (layer.passThreshold !== undefined && result.score >= layer.passThreshold) {
        await this.eventBus.publish({
          type: EventType.VALIDATION_PASSED,
          source: "AgentEngine",
          session_id: this.sessionId,
          data: { layer: layer.name, node_id: node.node_id, score: result.score },
          priority: layer.passPriority ?? EventPriority.NORMAL,
          timestamp: Date.now(),
          require_persistence: true,
        })
      }
    }
  }

  /** Execute multiple ready nodes in parallel via worker pool */
  private async executeNodesParallel(nodes: DAGNode[]): Promise<void> {
    // Ensure each capability has a registered worker handler
    for (const node of nodes) {
      const cap = this.registry.get(node.capability_id)
      if (cap?.handler) {
        this.workerPool.registerHandler(cap.capability_id, async (task) => {
          const result = await cap.handler!(task.inputs)
          return {
            taskId: task.taskId,
            nodeId: task.nodeId,
            success: true,
            output: result,
            durationMs: 0,
            tokenCost: cap.avg_token_cost,
          }
        })
      }
    }

    // Build worker tasks from ready nodes
    const tasks: WorkerTask[] = nodes.map((node) => ({
      taskId: `task_${node.node_id}`,
      nodeId: node.node_id,
      capabilityId: node.capability_id,
      inputs: node.inputs,
      contextSnapshot: this.buildL1Snapshot(nodes.map((n) => n.node_id)),
    }))

    // Execute in parallel via worker pool
    const results = await this.workerPool.executeTasksInParallel(tasks)

    // Map results back to nodes
    for (const result of results) {
      const node = nodes.find((n) => n.node_id === result.nodeId)
      if (!node) continue

      if (result.success) {
        node.output = result.output
        node.status = "completed"
        this.consecutiveFailures = 0
        this.registry.recordExecution(node.capability_id, true, result.durationMs, result.tokenCost)
        this.tokenUsage += node.estimated_tokens
        this.stepCount++

        // Post-execution validation and hooks
        await this.runValidation(node, result.output)
        await this.skills.triggerHook(HookPoints.TOOL_AFTER_CALL, {
          tool: node.capability_id,
          inputs: node.inputs,
          output: result.output,
          success: true,
          node_id: node.node_id,
        })
      } else {
        await this.handleNodeFailure(node, result.error ?? "Unknown error")
      }
    }
  }

  async createCheckpoint(): Promise<string> {
    if (!this.currentDAG) return ""

    const snapshot = this.buildL1Snapshot(getReadyNodes(this.currentDAG).map((n) => n.node_id))
    const cp = this.checkpoints.createL1(this.sessionId, snapshot, this.workspaceHash, `evt_${Date.now()}`)

    // Update engine_session with latest checkpoint
    this.syncSessionStatus(this.stateMachine.state, cp.checkpoint_id)

    await this.eventBus.publish({
      type: EventType.CHECKPOINT_CREATE,
      source: "AgentEngine",
      session_id: this.sessionId,
      data: { checkpoint_id: cp.checkpoint_id, level: cp.level, size: this.checkpoints.getCheckpointSize(snapshot) },
      priority: EventPriority.CRITICAL,
      timestamp: Date.now(),
      require_persistence: true,
    })

    return cp.checkpoint_id
  }

  async createL2Checkpoint(contextSummary: ContextSummary, gitHeadHash: string): Promise<string> {
    if (!this.currentDAG) return ""

    const l1Snapshot = this.buildL1Snapshot([])
    const l2Snapshot: L2Snapshot = { l1_data: l1Snapshot, context_summary: contextSummary, dag_full: this.currentDAG, memory_pointers: [] }

    const cp = this.checkpoints.createL2(this.sessionId, l2Snapshot, this.workspaceHash, gitHeadHash, `evt_${Date.now()}`)

    await this.eventBus.publish({
      type: EventType.CHECKPOINT_CREATE,
      source: "AgentEngine",
      session_id: this.sessionId,
      data: { checkpoint_id: cp.checkpoint_id, level: cp.level },
      priority: EventPriority.CRITICAL,
      timestamp: Date.now(),
      require_persistence: true,
    })

    return cp.checkpoint_id
  }

  async resume(checkpointId?: string, currentWorkspaceHash?: string, currentGitHeadHash?: string): Promise<EngineSnapshot | null> {
    // Step 1: Transition to RECOVERING (or force via ERROR if needed)
    const currentState = this.stateMachine.state
    if (currentState !== AgentState.RECOVERING) {
      if (this.stateMachine.canTransition(currentState, AgentState.RECOVERING)) {
        await this.emitStateTransition(AgentState.RECOVERING)
      } else if (this.stateMachine.canTransition(currentState, AgentState.ERROR)) {
        await this.emitStateTransition(AgentState.ERROR, "forced for resume")
        await this.emitStateTransition(AgentState.RECOVERING)
      }
      // If neither path works (e.g., already IDLE), proceed without RECOVERING transition
    }

    // Step 2: Load checkpoint (L1 → L2 → L3 chain fallback)
    const cp = checkpointId
      ? this.checkpoints.getAllCheckpoints().find((c) => c.checkpoint_id === checkpointId) ?? null
      : this.checkpoints.getLatest("L1") ?? this.checkpoints.getLatest("L2") ?? this.checkpoints.getLatest("L3")

    if (!cp) {
      await this.emitStateTransition(AgentState.READY)
      return null
    }

    // Step 3: Validate consistency
    if (currentWorkspaceHash && cp.context_hash && currentWorkspaceHash !== cp.context_hash) {
      await this.emitStateTransition(AgentState.PAUSED, "workspace hash mismatch on resume")
      return {
        sessionId: this.sessionId,
        state: AgentState.PAUSED,
        dagVersion: 0,
        stepCount: this.stepCount,
        tokenUsage: this.tokenUsage,
        checkpoints: { l1: 0, l2: 0, l3: 0 },
        currentDAG: null,
      }
    }

    if (currentGitHeadHash && cp.git_head_hash && currentGitHeadHash !== cp.git_head_hash) {
      await this.emitStateTransition(AgentState.PAUSED, "Git HEAD hash mismatch on resume")
      return {
        sessionId: this.sessionId,
        state: AgentState.PAUSED,
        dagVersion: 0,
        stepCount: this.stepCount,
        tokenUsage: this.tokenUsage,
        checkpoints: { l1: 0, l2: 0, l3: 0 },
        currentDAG: null,
      }
    }

    // Step 4: Restore state machine from checkpoint
    const state = cp.execution_state as unknown as L1Snapshot | L2Snapshot
    const l1Data = "l1_data" in state ? state.l1_data : state

    if (l1Data.state_machine) {
      this.stateMachine.restore({
        current_state: l1Data.state_machine.current_state as AgentState,
        previous_state: l1Data.state_machine.previous_state as AgentState,
        transition_count: l1Data.state_machine.transition_count,
        state_history: [],
      })
    }

    // Step 5: Restore DAG progress counters
    if (l1Data.dag_progress) {
      this.stepCount = l1Data.dag_progress.completed_nodes + l1Data.dag_progress.failed_nodes
    }

    // Step 6: Transition to READY
    await this.emitStateTransition(AgentState.READY)
    return this.getSnapshot()
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<EngineSnapshot | null> {
    await this.emitStateTransition(AgentState.RECOVERING)
    return this.resume(checkpointId)
  }

  async replay(mode: ReplayMode, events: Array<{ event_id: string; session_id: string; parent_event_id: string | null; event_type: string; payload: Record<string, unknown>; sequence_index: number; timestamp: number }>): Promise<ReplayResult> {
    this.replayer.loadEvents(events)
    return this.replayer.replay(mode)
  }

  async fork(branchName: string): Promise<SessionBranch> {
    return this.branches.fork(this.sessionId, branchName)
  }

  getSnapshot(): EngineSnapshot {
    return {
      sessionId: this.sessionId,
      state: this.stateMachine.state,
      dagVersion: this.currentDAG?.version ?? 0,
      stepCount: this.stepCount,
      tokenUsage: this.tokenUsage,
      currentDAG: this.currentDAG,
      checkpoints: {
        l1: this.checkpoints.getAllCheckpoints().filter((c) => c.level === "L1").length,
        l2: this.checkpoints.getAllCheckpoints().filter((c) => c.level === "L2").length,
        l3: this.checkpoints.getAllCheckpoints().filter((c) => c.level === "L3").length,
      },
    }
  }

  getDAG(): DAG | null {
    return this.currentDAG
  }

  async pause(): Promise<void> {
    await this.createCheckpoint()
    await this.emitStateTransition(AgentState.PAUSED, "user requested")
    await this.eventBus.publish({
      type: EventType.SESSION_PAUSED,
      source: "AgentEngine",
      session_id: this.sessionId,
      data: { reason: "user requested" },
      priority: EventPriority.CRITICAL,
      timestamp: Date.now(),
      require_persistence: true,
    })
  }

  async shutdown(): Promise<void> {
    await this.stateMachine.transition(AgentState.SHUTTING_DOWN, "clean shutdown")
    await this.createCheckpoint()
    await this.skills.triggerHook(HookPoints.SESSION_END, { sessionId: this.sessionId })
    await this.eventBus.shutdown()
  }

  // ─── Shared Helpers ──────────────────────────────────────────────────────

  /** Build a reusable L1Snapshot from current engine state */
  private buildL1Snapshot(pendingQueue: string[]): L1Snapshot {
    return {
      state_machine: {
        current_state: this.stateMachine.state,
        previous_state: this.stateMachine.prevState,
        transition_count: this.stateMachine.transitions,
      },
      dag_progress: {
        version: this.currentDAG!.version,
        total_nodes: this.currentDAG!.nodes.length,
        completed_nodes: this.currentDAG!.nodes.filter((n) => n.status === "completed").length,
        failed_nodes: this.currentDAG!.nodes.filter((n) => n.status === "failed").length,
        node_statuses: Object.fromEntries(this.currentDAG!.nodes.map((n) => [n.node_id, n.status])),
      },
      pending_queue: pendingQueue,
      workspace_hash: this.workspaceHash,
    }
  }

  /** Unified node failure handling: hooks, repair, DAG update, event, replan */
  private async handleNodeFailure(node: DAGNode, errorMessage: string): Promise<void> {
    node.status = "failed"
    this.consecutiveFailures++

    await this.skills.triggerHook(HookPoints.TOOL_AFTER_CALL, {
      tool: node.capability_id,
      inputs: node.inputs,
      error: errorMessage,
      success: false,
      node_id: node.node_id,
    })

    const recoveryRule = this.repair.matchRules(node.capability_id, errorMessage)
    if (recoveryRule) {
      this.repair.recordResult(recoveryRule.repair_id, recoveryRule.success_rate > 0.5)
    }

    this.currentDAG = markNodeFailed(this.currentDAG!, node.node_id)

    const dependentCount = getTransitiveDependents(this.currentDAG!, node.node_id).size

    await this.eventBus.publish({
      type: EventType.DAG_NODE_FAILED,
      source: "AgentEngine",
      session_id: this.sessionId,
      data: {
        node_id: node.node_id,
        error: errorMessage,
        recovery_action: recoveryRule?.recovery_action,
        blocked_dependents: dependentCount,
      },
      priority: EventPriority.HIGH,
      timestamp: Date.now(),
      require_persistence: true,
    })

    const canRepeat = this.replanCount < this.config.maxRetries
      && this.currentDAG!.nodes.some((n) => n.status === "pending" || n.status === "blocked")
    if (canRepeat) {
      this.replanCount++
      let replanDag: DAG

      if (this.dagGenerator) {
        const completedNodes = this.currentDAG!.nodes.filter((n) => n.status === "completed").map((n) => n.node_id)
        replanDag = await this.dagGenerator.generateReplanDAG("", this.registry.getAll(), errorMessage, completedNodes, node.node_id)
      } else {
        const result = this.planner.replanDAG(this.currentDAG!, node.node_id, errorMessage, this.replanCount)
        replanDag = result.dag
      }

      const replanValidation = validateDAG(replanDag)
      if (replanValidation.valid) {
        this.currentDAG = replanDag
      }
    }

    if (this.replanCount >= this.config.maxRetries) {
      await this.emitStateTransition(AgentState.ERROR, `replan limit exceeded after ${this.replanCount} attempts`)
    }
  }
}

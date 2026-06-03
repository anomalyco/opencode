// progress-tracker.ts — 细粒度进度追踪，驱动 TUI 面板更新
// 同时作为 lingxi_harness 模式下的统一进度写入入口，同步更新 .harness/progress.json

import type { PhaseId } from "./config-loader.js"
import { UnifiedProgressManager } from "../progress/unified-progress-manager.js"

// ── 类型定义 ──────────────────────────────────────────────

export type PhaseStatus = "pending" | "running" | "completed" | "failed"
export type StageStatus = "pending" | "running" | "completed" | "skipped" | "failed"

export interface RalphLoopState {
  active: boolean
  activeStage: string   // Ralph Loop 当前显示在哪个 Step
  currentRound: number
  maxRounds: number
  currentPhase: "reviewing" | "fixing"  // 当前是审查中还是修正中
  rounds: Array<{ round: number; result: "pass" | "fail"; timestamp: number }>
}

export interface CoverageRetryState {
  active: boolean
  currentAttempt: number
  maxAttempts: number
  lastCoverage: number
  targetCoverage: number
}

export interface StageProgress {
  name: string
  description: string
  status: StageStatus
  startTime?: number
  endTime?: number
}

export interface PhaseProgress {
  id: PhaseId
  label: string
  status: PhaseStatus
  stages: StageProgress[]
  ralphLoop: RalphLoopState
  coverageRetry?: CoverageRetryState
  startTime?: number
  endTime?: number
}

export interface LingxiProgress {
  featureId: string
  featureName: string
  sessionId: string
  status: "running" | "completed" | "failed"
  phases: [PhaseProgress, PhaseProgress, PhaseProgress, PhaseProgress]
  startTime: number
  endTime?: number
}

// ── STAGE 定义 ────────────────────────────────────────────

export const PHASE_STAGES: Record<PhaseId, Array<{ name: string; description: string }>> = {
  prd: [
    { name: "Step_0", description: "上下文恢复" },
    { name: "Step_1", description: "配置收集" },
    { name: "Step_2", description: "并行检索" },
    { name: "Step_3", description: "任务规划" },
    { name: "Step_4", description: "文档生成" },
    { name: "Step_5", description: "审查验证" },
    { name: "Step_6", description: "完成与进度更新" },
  ],
  design: [
    { name: "Step_0", description: "上下文恢复" },
    { name: "Step_1", description: "配置收集" },
    { name: "Step_2", description: "并行检索" },
    { name: "Step_3", description: "任务规划" },
    { name: "Step_4", description: "文档生成" },
    { name: "Step_5", description: "审查验证" },
    { name: "Step_6", description: "完成与进度更新" },
  ],
  code: [
    { name: "Step_0", description: "上下文恢复" },
    { name: "Step_1", description: "配置收集" },
    { name: "Step_2", description: "并行检索" },
    { name: "Step_3", description: "环境检测 + 任务规划" },
    { name: "Step_4", description: "TDD 红灯（测试先行）" },
    { name: "Step_5", description: "代码实现" },
    { name: "Step_6", description: "TDD 绿灯（测试验证）" },
    { name: "Step_7", description: "代码审查" },
    { name: "Step_8", description: "完成与进度更新" },
  ],
  test: [
    { name: "Step_0", description: "上下文恢复" },
    { name: "Step_1", description: "配置收集" },
    { name: "Step_2", description: "并行检索" },
    { name: "Step_3", description: "环境检测 + 任务规划" },
    { name: "Step_4", description: "测试代码编写" },
    { name: "Step_5", description: "测试执行与覆盖率" },
    { name: "Step_6", description: "测试审查" },
    { name: "Step_7", description: "完成与进度更新" },
  ],
}

const PHASE_LABELS: Record<PhaseId, string> = {
  prd: "概要设计阶段",
  design: "详细设计阶段",
  code: "代码编写阶段",
  test: "单元测试阶段",
}

// ── 全局存储 ──────────────────────────────────────────────

export const lingxiTrackers = new Map<string, LingxiProgressTracker>()

// ── ProgressTracker ───────────────────────────────────────

type ProgressChangeListener = (progress: LingxiProgress) => void

/** Step 导航信息，供 system-inject 注入 */
export interface StepNavInfo {
  phaseId: PhaseId
  phaseLabel: string
  currentStep: { name: string; description: string } | null
  nextStep: { name: string; description: string } | null
}

export class LingxiProgressTracker {
  private progress: LingxiProgress
  private listeners: Set<ProgressChangeListener> = new Set()
  private progressManager?: UnifiedProgressManager

  // batch 机制：避免高频 structuredClone + notify
  private _batching = false
  private _batchDirty = false

  constructor(
    featureId: string,
    featureName: string,
    sessionId: string,
    directory?: string,
    progressManager?: UnifiedProgressManager,
  ) {
    this.progress = this.initProgress(featureId, featureName, sessionId)
    if (directory) {
      this.progressManager = progressManager ?? new UnifiedProgressManager(directory)
    }
  }

  getProgress(): LingxiProgress {
    return structuredClone(this.progress)
  }

  /** 批量更新：多次 updateStage/updatePhase 只触发一次 notify + persist */
  batch(fn: () => void): void {
    this._batching = true
    this._batchDirty = false
    try {
      fn()
    } finally {
      this._batching = false
      if (this._batchDirty) {
        this.notify()
      }
    }
  }

  updatePhase(phase: PhaseId, status: PhaseStatus): void {
    const p = this.findPhase(phase)
    p.status = status
    if (status === "running" && !p.startTime) p.startTime = Date.now()
    if (status === "completed" || status === "failed") p.endTime = Date.now()
    if (status === "completed") {
      const allDone = this.progress.phases.every(ph => ph.status === "completed")
      if (allDone) {
        this.progress.status = "completed"
        this.progress.endTime = Date.now()
      }
    }
    this.progressManager?.updatePhase(this.progress.featureId, phase, status).catch(() => {})
    this.notify()
  }

  updateStage(phase: PhaseId, stage: string, status: StageStatus): void {
    const p = this.findPhase(phase)
    const s = p.stages.find(st => st.name === stage)
    if (s) {
      s.status = status
      if (status === "running" && !s.startTime) s.startTime = Date.now()
      if (status === "completed" || status === "failed") s.endTime = Date.now()
    }
    this.progressManager?.updateStage(this.progress.featureId, phase, stage, status).catch(() => {})
    this.notify()
  }

  recordRalphLoop(phase: PhaseId, round: number, maxRounds: number, activeStage?: string): void {
    const p = this.findPhase(phase)
    p.ralphLoop.active = true
    p.ralphLoop.currentPhase = "reviewing"
    if (activeStage) p.ralphLoop.activeStage = activeStage
    p.ralphLoop.currentRound = round
    p.ralphLoop.maxRounds = maxRounds
    p.ralphLoop.rounds.push({ round, result: "fail", timestamp: Date.now() })
    this.progressManager?.updateRalphLoop(this.progress.featureId, phase, p.ralphLoop).catch(() => {})
    this.notify()
  }

  /** 修正 subagent 开始执行时调用，将当前轮次状态切换为"修正中" */
  startRalphLoopFixing(phase: PhaseId): void {
    const p = this.findPhase(phase)
    if (p.ralphLoop.active) {
      p.ralphLoop.currentPhase = "fixing"
      this.progressManager?.updateRalphLoop(this.progress.featureId, phase, p.ralphLoop).catch(() => {})
      this.notify()
    }
  }

  /** 审查完成（通过）时：最后一轮标记为 pass，清理活跃状态 */
  completeRalphLoop(phase: PhaseId): void {
    const p = this.findPhase(phase)
    if (p.ralphLoop.active) {
      // 把最后一轮结果标记为 pass
      const last = p.ralphLoop.rounds[p.ralphLoop.rounds.length - 1]
      if (last) last.result = "pass"
      p.ralphLoop.active = false
      p.ralphLoop.currentPhase = "reviewing"
      this.progressManager?.updateRalphLoop(this.progress.featureId, phase, p.ralphLoop).catch(() => {})
      this.notify()
    }
  }

  recordCoverageRetry(attempt: number, maxAttempts: number, coverage: number): void {
    const cp = this.findPhase("code")
    if (!cp.coverageRetry) {
      cp.coverageRetry = { active: true, currentAttempt: attempt, maxAttempts, lastCoverage: coverage, targetCoverage: 80 }
    } else {
      cp.coverageRetry.currentAttempt = attempt
      cp.coverageRetry.lastCoverage = coverage
    }
    if (cp.coverageRetry) {
      this.progressManager?.updateCoverageRetry(this.progress.featureId, "code", cp.coverageRetry).catch(() => {})
    }
    this.notify()
  }

  onProgressChange(listener: ProgressChangeListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 获取当前 Step 导航信息，供 system-inject 注入 */
  getCurrentStepInfo(): StepNavInfo | null {
    const runningPhase = this.progress.phases.find(p => p.status === "running")
    if (!runningPhase) return null
    const currentStep = runningPhase.stages.find(s => s.status === "running") ?? null
    const nextStep = runningPhase.stages.find(s => s.status === "pending") ?? null
    return {
      phaseId: runningPhase.id,
      phaseLabel: runningPhase.label,
      currentStep: currentStep ? { name: currentStep.name, description: currentStep.description } : null,
      nextStep: nextStep ? { name: nextStep.name, description: nextStep.description } : null,
    }
  }

  private notify(): void {
    if (this._batching) {
      this._batchDirty = true
      return
    }
    const snapshot = this.getProgress()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private findPhase(phase: PhaseId): PhaseProgress {
    return this.progress.phases.find(p => p.id === phase)!
  }

  private initProgress(featureId: string, featureName: string, sessionId: string): LingxiProgress {
    return {
      featureId,
      featureName,
      sessionId,
      status: "running",
      startTime: Date.now(),
      phases: [
        this.initPhase("prd"),
        this.initPhase("design"),
        this.initPhase("code"),
        this.initPhase("test"),
      ] as [PhaseProgress, PhaseProgress, PhaseProgress, PhaseProgress],
    }
  }

  private initPhase(id: PhaseId): PhaseProgress {
    return {
      id,
      label: PHASE_LABELS[id],
      status: id === "prd" ? "running" : "pending",
      // PRD 是第一个执行的阶段，初始化时即设置 startTime
      startTime: id === "prd" ? Date.now() : undefined,
      stages: PHASE_STAGES[id].map(s => ({ name: s.name, description: s.description, status: "pending" as StageStatus })),
      ralphLoop: { active: false, activeStage: "", currentRound: 0, maxRounds: id === "code" ? 2 : 3, currentPhase: "reviewing", rounds: [] },
      ...(id === "code" ? { coverageRetry: { active: false, currentAttempt: 0, maxAttempts: 3, lastCoverage: 0, targetCoverage: 80 } } : {}),
    }
  }
}

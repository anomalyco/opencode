import { mkdir } from "fs/promises"
import path from "path"
import type { RequirementIdentity, RequirementSource } from "../lingxi/feature-identity.js"
import type { PhaseId } from "../lingxi/config-loader.js"

export type UnifiedPhaseStatus = "pending" | "running" | "completed" | "failed"
export type UnifiedStageStatus = "pending" | "running" | "completed" | "skipped" | "failed"

export interface UnifiedStageProgress {
  name: string
  description: string
  status: UnifiedStageStatus
  startTime?: number
  endTime?: number
}

export interface UnifiedRalphLoopState {
  active: boolean
  currentRound: number
  maxRounds: number
  rounds: Array<{ round: number; result: "pass" | "fail"; timestamp: number }>
}

export interface UnifiedCoverageRetryState {
  active: boolean
  currentAttempt: number
  maxAttempts: number
  lastCoverage: number
  targetCoverage: number
}

export interface UnifiedPhaseProgress {
  id: PhaseId
  label: string
  status: UnifiedPhaseStatus
  stages: UnifiedStageProgress[]
  ralphLoop: UnifiedRalphLoopState
  coverageRetry?: UnifiedCoverageRetryState
  startTime?: number
  endTime?: number
}

export interface UnifiedFeatureSummary {
  status: "in_progress" | "completed" | "failed" | `${PhaseId}_done`
  currentPhase: PhaseId | null
  passes: Record<PhaseId, boolean>
  artifacts: {
    harnessDir: string
    docsDir: string
    prd: string
    design: string
    code: string
    test: string
  }
}

export interface UnifiedFeatureExecution {
  startTime: number
  endTime?: number
  phases: [UnifiedPhaseProgress, UnifiedPhaseProgress, UnifiedPhaseProgress, UnifiedPhaseProgress]
}

export interface UnifiedFeatureProgress {
  id: string
  title: string
  request: string
  requirementSource: RequirementSource
  sessionId: string
  createdAt: string
  updatedAt: string
  summary: UnifiedFeatureSummary
  execution: UnifiedFeatureExecution
}

export interface UnifiedProgressData {
  version: 1
  updatedAt: string
  features: UnifiedFeatureProgress[]
}

export interface StepNavInfo {
  phaseId: PhaseId
  phaseLabel: string
  currentStep: { name: string; description: string } | null
  nextStep: { name: string; description: string } | null
}

const PHASES: PhaseId[] = ["prd", "design", "code", "test"]

const PHASE_LABELS: Record<PhaseId, string> = {
  prd: "概要设计阶段",
  design: "详细设计阶段",
  code: "代码编写阶段",
  test: "单元测试阶段",
}

const PHASE_STAGES: Record<PhaseId, Array<{ name: string; description: string }>> = {
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

export class UnifiedProgressManager {
  private progressFile: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private directory: string) {
    this.progressFile = path.join(directory, ".harness", "progress.json")
  }

  async initFeature(identity: RequirementIdentity, sessionId: string): Promise<UnifiedFeatureProgress> {
    const now = new Date().toISOString()
    const data = await this.readData()
    let feature = data.features.find((item) => item.id === identity.id)

    if (!feature) {
      feature = {
        id: identity.id,
        title: identity.title,
        request: identity.request,
        requirementSource: identity.requirementSource,
        sessionId,
        createdAt: now,
        updatedAt: now,
        summary: this.buildSummary(identity.id, this.initPhases()),
        execution: {
          startTime: Date.now(),
          phases: this.initPhases(),
        },
      }
      data.features.push(feature)
    } else {
      feature.title = identity.title
      feature.request = identity.request
      feature.requirementSource = identity.requirementSource
      feature.sessionId = sessionId
      feature.updatedAt = now
      feature.summary = this.buildSummary(feature.id, feature.execution.phases)
    }

    data.updatedAt = now
    await this.writeData(data)
    return structuredClone(feature)
  }

  async updatePhase(featureId: string, phase: PhaseId, status: UnifiedPhaseStatus): Promise<void> {
    await this.mutateFeature(featureId, (feature) => {
      const phaseProgress = this.findPhase(feature, phase)
      phaseProgress.status = status
      if (status === "running" && !phaseProgress.startTime) phaseProgress.startTime = Date.now()
      if (status === "completed" || status === "failed") phaseProgress.endTime = Date.now()
      if (feature.execution.phases.every((item) => item.status === "completed")) {
        feature.execution.endTime = Date.now()
      }
    })
  }

  async updateStage(
    featureId: string,
    phase: PhaseId,
    stage: string,
    status: UnifiedStageStatus,
  ): Promise<void> {
    await this.mutateFeature(featureId, (feature) => {
      const phaseProgress = this.findPhase(feature, phase)
      const stageProgress = phaseProgress.stages.find((item) => item.name === stage)
      if (!stageProgress) return
      stageProgress.status = status
      if (status === "running" && !stageProgress.startTime) stageProgress.startTime = Date.now()
      if (status === "completed" || status === "failed") stageProgress.endTime = Date.now()
    })
  }

  async updateRalphLoop(
    featureId: string,
    phase: PhaseId,
    patch: Partial<UnifiedRalphLoopState>,
  ): Promise<void> {
    await this.mutateFeature(featureId, (feature) => {
      const phaseProgress = this.findPhase(feature, phase)
      phaseProgress.ralphLoop = { ...phaseProgress.ralphLoop, ...patch }
    })
  }

  async updateCoverageRetry(
    featureId: string,
    phase: PhaseId,
    patch: Partial<UnifiedCoverageRetryState>,
  ): Promise<void> {
    await this.mutateFeature(featureId, (feature) => {
      const phaseProgress = this.findPhase(feature, phase)
      if (!phaseProgress.coverageRetry) return
      phaseProgress.coverageRetry = { ...phaseProgress.coverageRetry, ...patch }
    })
  }

  async query(featureId?: string): Promise<UnifiedProgressData> {
    const data = await this.readData()
    if (!featureId) return data
    return {
      ...data,
      features: data.features.filter((feature) => feature.id === featureId),
    }
  }

  async getFeatureBySession(sessionId: string): Promise<UnifiedFeatureProgress | null> {
    const data = await this.readData()
    return data.features.find((feature) => feature.sessionId === sessionId) ?? null
  }

  async getCurrentStepInfoBySession(sessionId: string): Promise<StepNavInfo | null> {
    const feature = await this.getFeatureBySession(sessionId)
    if (!feature) return null
    const runningPhase = feature.execution.phases.find((phase) => phase.status === "running")
    if (!runningPhase) return null
    const currentStep = runningPhase.stages.find((stage) => stage.status === "running") ?? null
    const nextStep = runningPhase.stages.find((stage) => stage.status === "pending") ?? null
    return {
      phaseId: runningPhase.id,
      phaseLabel: runningPhase.label,
      currentStep: currentStep ? { name: currentStep.name, description: currentStep.description } : null,
      nextStep: nextStep ? { name: nextStep.name, description: nextStep.description } : null,
    }
  }

  async formatSummary(featureId?: string): Promise<string> {
    const data = await this.query(featureId)
    if (data.features.length === 0) {
      return featureId ? `Feature "${featureId}" 暂无进度记录` : "暂无进度记录"
    }

    const lines: string[] = ["## 项目进度摘要\n"]
    const labels: Record<PhaseId, string> = {
      prd: "概要设计",
      design: "详细设计",
      code: "代码编写",
      test: "单元测试",
    }

    for (const feature of data.features) {
      lines.push(`### ${feature.id}: ${feature.title}`)
      lines.push(`状态: ${feature.summary.status}`)
      if (feature.requirementSource.path) lines.push(`需求来源: ${feature.requirementSource.path}`)
      lines.push(`最后更新: ${feature.updatedAt}`)
      lines.push("阶段进度:")
      for (const phase of PHASES) {
        lines.push(`  - ${labels[phase]}: ${feature.summary.passes[phase] ? "完成" : "未完成"}`)
      }
      lines.push(`产出目录: ${feature.summary.artifacts.docsDir}`)
      lines.push("")
    }

    return lines.join("\n")
  }

  private async mutateFeature(featureId: string, mutate: (feature: UnifiedFeatureProgress) => void): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const data = await this.readData()
      const feature = data.features.find((item) => item.id === featureId)
      if (!feature) return
      mutate(feature)
      feature.summary = this.buildSummary(feature.id, feature.execution.phases)
      feature.updatedAt = new Date().toISOString()
      data.updatedAt = feature.updatedAt
      await this.writeData(data)
    })
    await this.writeQueue
  }

  private async readData(): Promise<UnifiedProgressData> {
    const file = Bun.file(this.progressFile)
    if (!(await file.exists())) {
      const empty = this.emptyData()
      await this.writeData(empty)
      return empty
    }

    try {
      const data = JSON.parse(await file.text()) as UnifiedProgressData
      if (!Array.isArray(data.features) || data.version !== 1) throw new Error("invalid progress data")
      return data
    } catch {
      const empty = this.emptyData()
      await this.writeData(empty)
      return empty
    }
  }

  private async writeData(data: UnifiedProgressData): Promise<void> {
    await mkdir(path.dirname(this.progressFile), { recursive: true })
    await Bun.write(this.progressFile, JSON.stringify(data, null, 2))
  }

  private emptyData(): UnifiedProgressData {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      features: [],
    }
  }

  private initPhases(): UnifiedFeatureExecution["phases"] {
    return [
      this.initPhase("prd"),
      this.initPhase("design"),
      this.initPhase("code"),
      this.initPhase("test"),
    ]
  }

  private initPhase(phase: PhaseId): UnifiedPhaseProgress {
    return {
      id: phase,
      label: PHASE_LABELS[phase],
      status: phase === "prd" ? "running" : "pending",
      startTime: phase === "prd" ? Date.now() : undefined,
      stages: PHASE_STAGES[phase].map((stage) => ({ ...stage, status: "pending" as const })),
      ralphLoop: { active: false, currentRound: 0, maxRounds: phase === "code" ? 2 : 3, rounds: [] },
      ...(phase === "code"
        ? { coverageRetry: { active: false, currentAttempt: 0, maxAttempts: 3, lastCoverage: 0, targetCoverage: 80 } }
        : {}),
    }
  }

  private buildSummary(featureId: string, phases: UnifiedFeatureExecution["phases"]): UnifiedFeatureSummary {
    const passes = Object.fromEntries(
      phases.map((phase) => [phase.id, phase.status === "completed"]),
    ) as Record<PhaseId, boolean>
    const failedPhase = phases.find((phase) => phase.status === "failed")
    const runningPhase = phases.find((phase) => phase.status === "running")
    const allDone = phases.every((phase) => phase.status === "completed")
    const lastDone = [...phases].reverse().find((phase) => phase.status === "completed")

    return {
      status: failedPhase ? "failed" : allDone ? "completed" : lastDone ? `${lastDone.id}_done` : "in_progress",
      currentPhase: allDone ? null : runningPhase?.id ?? nextPhaseAfter(lastDone?.id) ?? "prd",
      passes,
      artifacts: {
        harnessDir: `.harness/${featureId}`,
        docsDir: `docs/${featureId}`,
        prd: `docs/${featureId}/概要设计文档.md`,
        design: `docs/${featureId}/详细设计与程序设计文档.md`,
        code: "src/",
        test: "src/",
      },
    }
  }

  private findPhase(feature: UnifiedFeatureProgress, phase: PhaseId): UnifiedPhaseProgress {
    return feature.execution.phases.find((item) => item.id === phase)!
  }
}

function nextPhaseAfter(phase?: PhaseId): PhaseId | null {
  if (!phase) return "prd"
  const idx = PHASES.indexOf(phase)
  return PHASES[idx + 1] ?? null
}

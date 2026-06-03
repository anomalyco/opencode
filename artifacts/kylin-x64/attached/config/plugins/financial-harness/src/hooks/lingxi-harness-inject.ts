// lingxi-harness-inject.ts — 拦截 /lingxi_harness 命令，构建四阶段 mega-pipeline
// 支持断点续跑：检测 progress.json 中已有进度时，从中断点恢复

import path from "path"
import { getState } from "../state.js"
import { ConfigLoader, type PhaseId } from "../lingxi/config-loader.js"
import { LingxiOrchestrator } from "../lingxi/orchestrator.js"
import { LingxiProgressTracker, lingxiTrackers } from "../lingxi/progress-tracker.js"
import { resolveFeatureIdentity } from "../lingxi/feature-identity.js"
import { UnifiedProgressManager, type UnifiedFeatureProgress } from "../progress/unified-progress-manager.js"
import { pluginClient, pluginDirectory } from "../../index.js"

const ALL_PHASES: PhaseId[] = ["prd", "design", "code", "test"]

const PHASE_LABELS: Record<PhaseId, string> = {
  prd: "概要设计阶段",
  design: "详细设计阶段",
  code: "代码编写阶段",
  test: "单元测试阶段",
}

/**
 * 从 progress.json 中解析恢复点
 * 返回 { phase, step } 表示应该从哪个阶段的哪个 Step 恢复
 * 返回 null 表示没有可恢复的进度（应从头开始）
 */
function resolveResumePoint(feature: UnifiedFeatureProgress): { phase: PhaseId; step: string } | null {
  const phases = feature.execution.phases

  // 找到当前正在运行的阶段
  const runningPhase = phases.find(p => p.status === "running")
  if (runningPhase) {
    // 在该阶段中找到第一个未完成的 Step
    // 优先找 "running" 状态的 step（被中断的）
    const runningStep = runningPhase.stages.find(s => s.status === "running")
    if (runningStep) {
      return { phase: runningPhase.id, step: runningStep.name }
    }
    // 否则找第一个 "pending" 的 step（上一个 step 完成后还没来得及注入下一个）
    const pendingStep = runningPhase.stages.find(s => s.status === "pending")
    if (pendingStep) {
      return { phase: runningPhase.id, step: pendingStep.name }
    }
    // 所有 step 都完成了但阶段还是 running（可能是 update-progress 没调用）
    // 注入阶段完成提示
    return { phase: runningPhase.id, step: "__phase_complete__" }
  }

  // 没有 running 的阶段，找最后一个 completed 的阶段，下一个就是恢复点
  const lastCompletedIdx = [...phases].reverse().findIndex(p => p.status === "completed")
  if (lastCompletedIdx === -1) {
    // 没有任何已完成的阶段，从头开始
    return null
  }
  const lastCompletedPhaseIdx = phases.length - 1 - lastCompletedIdx
  const nextPhaseIdx = lastCompletedPhaseIdx + 1
  if (nextPhaseIdx >= phases.length) {
    // 所有阶段都完成了
    return null
  }
  const nextPhase = phases[nextPhaseIdx]
  return { phase: nextPhase.id, step: nextPhase.stages[0]?.name ?? "Step_0" }
}

/**
 * /lingxi_harness 命令处理函数
 * 由合并后的 command.execute.before Hook 调用
 * 支持断点续跑：检测已有进度时从中断点恢复
 */
export async function lingxiHarnessInjectHandler(input: any, output: any): Promise<void> {
  const sessionId: string = input.sessionID ?? input.session_id ?? ""
  const userRequest: string = input.arguments ?? ""
  const directory = pluginDirectory || process.cwd()

  // 1. 加载配置
  const configLoader = new ConfigLoader()
  let config
  try {
    config = await configLoader.load(directory)
  } catch (err) {
    config = await configLoader.loadDefault()
    output.parts = output.parts ?? []
    output.parts.push({
      type: "text",
      text: `⚠️ lingxi_harness_config.json 解析失败：${err}\n\n已使用默认配置继续执行。\n`,
    })
  }

  // 2. 断点续跑优先：当参数为空时，尝试从 progress.json 恢复未完成的 feature
  const progressManager = new UnifiedProgressManager(directory)
  let identity: Awaited<ReturnType<typeof resolveFeatureIdentity>>
  let featureId: string
  let existingFeature: UnifiedFeatureProgress | undefined
  let resumePoint: { phase: PhaseId; step: string } | null = null

  if (!userRequest.trim()) {
    // 无参数：尝试自动恢复
    const allProgress = await progressManager.query()
    const inProgressFeatures = allProgress.features.filter(f =>
      f.summary.status !== "completed" && f.summary.status !== "failed"
    )

    if (inProgressFeatures.length === 1) {
      // 唯一未完成的 feature，自动恢复
      existingFeature = inProgressFeatures[0]
      featureId = existingFeature.id
      resumePoint = resolveResumePoint(existingFeature)
      identity = {
        id: existingFeature.id,
        title: existingFeature.title,
        request: existingFeature.request,
        requirementText: existingFeature.request,
        requirementSource: existingFeature.requirementSource,
      }
      console.warn(`[financial-harness] 无参数启动，自动恢复唯一未完成 feature: ${featureId}`)
    } else if (inProgressFeatures.length > 1) {
      // 多个未完成 feature，提示用户选择
      const featureList = inProgressFeatures.map(f => {
        const phases = ALL_PHASES.map(p => {
          const pass = f.summary.passes[p]
          return pass ? `${p.toUpperCase()} ✅` : `${p.toUpperCase()} ⬜`
        }).join(" ")
        return `- ${f.id}: ${f.title}（${phases}）`
      }).join("\n")

      output.parts = output.parts ?? []
      output.parts.push({
        type: "text",
        text: `检测到多个未完成的 feature，请指定要继续的需求：\n\n${featureList}\n\n请使用 \`/lingxi_harness --feature-id <ID>\` 指定要恢复的 feature。`,
      })
      return
    } else {
      // 没有未完成的 feature，也没有参数，提示用户
      output.parts = output.parts ?? []
      output.parts.push({
        type: "text",
        text: `没有检测到未完成的 feature。请提供需求参数启动新的全链路流程。\n\n用法：\`/lingxi_harness <需求描述或需求文件路径>\``,
      })
      return
    }
  } else {
    // 有参数：正常解析 feature identity
    identity = await resolveFeatureIdentity(userRequest, directory)
    featureId = identity.id

    // 检查该 feature 是否已有进度
    const existingProgress = await progressManager.query(featureId)
    existingFeature = existingProgress.features.find(f => f.id === featureId)
    resumePoint = existingFeature ? resolveResumePoint(existingFeature) : null
  }

  // 3. 初始化进度追踪器（initFeature 不会覆盖已有进度，只更新 session 信息）
  await progressManager.initFeature(identity, sessionId)

  // 5. 初始化 tracker
  const tracker = new LingxiProgressTracker(featureId, identity.title, sessionId, directory, progressManager)
  lingxiTrackers.set(sessionId, tracker)

  // 6. 初始化目录结构
  try {
    const harnessDir = path.join(directory, ".harness")
    const featureHarnessDir = path.join(harnessDir, featureId)
    const docsDir = path.join(directory, "docs")
    await Bun.write(path.join(harnessDir, ".keep"), "")
    await Bun.write(path.join(featureHarnessDir, ".keep"), "")
    await Bun.write(path.join(docsDir, ".keep"), "")

    const gitignorePath = path.join(directory, ".gitignore")
    const gitignoreFile = Bun.file(gitignorePath)
    const gitignore = await gitignoreFile.exists() ? await gitignoreFile.text() : ""
    if (!gitignore.includes(".harness/")) {
      await Bun.write(gitignorePath, gitignore.trimEnd() + "\n.harness/\n")
    }
  } catch {
    // 目录初始化失败不阻塞
  }

  // 7. 构建 Orchestrator
  const orchestrator = new LingxiOrchestrator(config, featureId, directory, {
    title: identity.title,
    request: identity.request,
    requirementSource: identity.requirementSource,
  })

  // 8. 根据是否有恢复点，决定注入策略
  if (resumePoint) {
    // ── 断点续跑模式 ──
    const resumePhase = resumePoint.phase
    const resumeStep = resumePoint.step
    const resumePhaseIdx = ALL_PHASES.indexOf(resumePhase)
    const remainingPhases = ALL_PHASES.slice(resumePhaseIdx + 1)

    // 标记 SessionState
    const state = getState(sessionId)
    state.currentModule = "lingxi_harness"
    state.isLingxiHarness = true
    state.lingxiCurrentPhase = resumePhase
    state.lingxiPhaseQueue = remainingPhases
    state.lingxiFeatureId = featureId
    state.lingxiFeatureTitle = identity.title
    state.lingxiRequirementSource = identity.requirementSource
    state.lingxiConfig = config
    state.lingxiClient = pluginClient

    // 构建恢复 pipeline
    const allSteps = await orchestrator.getStepNames(resumePhase)

    if (resumeStep === "__phase_complete__") {
      // 阶段所有 step 已完成，注入阶段完成提示
      state.lingxiCurrentStep = undefined
      state.lingxiStepQueue = []
      tracker.updateStage(resumePhase, allSteps[allSteps.length - 1], "completed")

      const phaseCompleteText = `${resumePhase} 阶段所有 Step 已完成。请调用 update-progress(feature="${featureId}", featureName="${identity.title}", module="${resumePhase}", status="done") 进入下一阶段。`

      // 构建恢复上下文 + 阶段完成提示
      const resumeHeader = buildResumeHeader(featureId, identity.title, resumePhase, existingFeature!)
      output.parts = output.parts ?? []
      output.parts.push({ type: "text", text: `${resumeHeader}\n\n${phaseCompleteText}` })
    } else {
      // 从具体 Step 恢复
      const stepIdx = allSteps.indexOf(resumeStep)
      state.lingxiCurrentStep = resumeStep
      state.lingxiStepQueue = stepIdx >= 0 ? allSteps.slice(stepIdx + 1) : []
      tracker.updateStage(resumePhase, resumeStep, "running")

      // 构建恢复上下文 + Step pipeline
      const resumeHeader = buildResumeHeader(featureId, identity.title, resumePhase, existingFeature!)
      const stepPipeline = await orchestrator.buildStepPrompt(resumePhase, resumeStep)

      output.parts = output.parts ?? []
      output.parts.push({ type: "text", text: `${resumeHeader}\n\n${stepPipeline}` })
    }

    console.warn(`[financial-harness] 断点续跑：${featureId} 从 ${resumePhase}/${resumeStep} 恢复`)
  } else {
    // ── 全新启动模式（原有逻辑） ──
    tracker.updateStage("prd", "Step_0", "running")

    const state = getState(sessionId)
    state.currentModule = "lingxi_harness"
    state.isLingxiHarness = true
    state.lingxiCurrentPhase = "prd"
    state.lingxiPhaseQueue = ["design", "code", "test"]
    state.lingxiFeatureId = featureId
    state.lingxiFeatureTitle = identity.title
    state.lingxiRequirementSource = identity.requirementSource
    state.lingxiConfig = config
    state.lingxiClient = pluginClient

    const prdSteps = await orchestrator.getStepNames("prd")
    state.lingxiCurrentStep = prdSteps[0] ?? "Step_0"
    state.lingxiStepQueue = prdSteps.slice(1)
    const pipeline = await orchestrator.buildFirstPhase()

    output.parts = output.parts ?? []
    output.parts.push({ type: "text", text: pipeline })

    console.warn(`[financial-harness] 全新启动：${featureId} 从 prd/Step_0 开始`)
  }
}

/**
 * 构建断点续跑的上下文 header
 * 告知 Agent 当前恢复状态和已完成的阶段
 */
function buildResumeHeader(
  featureId: string,
  title: string,
  resumePhase: PhaseId,
  feature: UnifiedFeatureProgress,
): string {
  const completedPhases = feature.execution.phases
    .filter(p => p.status === "completed")
    .map(p => `${PHASE_LABELS[p.id]} ✅`)

  const currentPhaseProgress = feature.execution.phases.find(p => p.id === resumePhase)
  const completedSteps = currentPhaseProgress?.stages
    .filter(s => s.status === "completed")
    .map(s => `${s.name}(${s.description})`)
    ?? []

  return `# LINGXI_HARNESS — 断点续跑恢复
# Feature ID: ${featureId}
# Feature Title: ${title}
# 恢复模式: 从上次中断点继续执行

## 已完成阶段
${completedPhases.length > 0 ? completedPhases.map(p => `- ${p}`).join("\n") : "- 无"}

## 当前阶段已完成的 Step
${completedSteps.length > 0 ? completedSteps.map(s => `- ${s} ✅`).join("\n") : "- 无"}

## 恢复说明
- 上述阶段和 Step 已完成，不需要重新执行
- 直接从下方注入的 Step 继续执行
- 如需回顾上下文，读取 .harness/${featureId}/index.md 和相关检索上下文文件`
}


// lingxi-harness-inject.ts — 拦截 /lingxi_harness 命令，构建四阶段 mega-pipeline

import path from "path"
import { getState } from "../state.js"
import { ConfigLoader } from "../lingxi/config-loader.js"
import { LingxiOrchestrator } from "../lingxi/orchestrator.js"
import { LingxiProgressTracker, lingxiTrackers } from "../lingxi/progress-tracker.js"
import { resolveFeatureIdentity } from "../lingxi/feature-identity.js"
import { UnifiedProgressManager } from "../progress/unified-progress-manager.js"
import { pluginClient, pluginDirectory } from "../../index.js"

/**
 * /lingxi_harness 命令处理函数
 * 由合并后的 command.execute.before Hook 调用
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

  // 2. 从真实需求源解析 Feature Identity
  const identity = await resolveFeatureIdentity(userRequest, directory)
  const featureId = identity.id

  // 3. 初始化进度追踪器
  const progressManager = new UnifiedProgressManager(directory)
  await progressManager.initFeature(identity, sessionId)
  const tracker = new LingxiProgressTracker(featureId, identity.title, sessionId, directory, progressManager)
  lingxiTrackers.set(sessionId, tracker)
  tracker.updateStage("prd", "Step_0", "running")

  // 4. 标记 SessionState（含阶段队列和共享数据）
  const state = getState(sessionId)
  state.currentModule = "lingxi_harness"
  state.isLingxiHarness = true
  state.lingxiCurrentPhase = "prd"
  state.lingxiPhaseQueue = ["design", "code", "test"]  // 剩余阶段队列（PRD 已在执行）
  state.lingxiFeatureId = featureId
  state.lingxiFeatureTitle = identity.title
  state.lingxiRequirementSource = identity.requirementSource
  state.lingxiConfig = config
  state.lingxiClient = pluginClient  // hook input 不包含 client，必须使用插件初始化闭包中的 SDK client

  // 5. 初始化目录结构
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

  // 6. 构建第一阶段 Pipeline（渐进注入：只注入 PRD 阶段）
  const orchestrator = new LingxiOrchestrator(config, featureId, directory, {
    title: identity.title,
    request: identity.request,
    requirementSource: identity.requirementSource,
  })
  const prdSteps = await orchestrator.getStepNames("prd")
  state.lingxiCurrentStep = prdSteps[0] ?? "Step_0"
  state.lingxiStepQueue = prdSteps.slice(1)
  const pipeline = await orchestrator.buildFirstPhase()

  // 7. 注入第一阶段 Pipeline
  output.parts = output.parts ?? []
  output.parts.push({ type: "text", text: pipeline })
}


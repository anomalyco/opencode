// file-tracker.ts — tool.execute.after Hook
// 追踪三标记、测试文件、文件修改、测试运行、审查行为，并同步子 session 状态
// + lingxi_harness 模式下的细粒度 STAGE 进度推断

import { getState, isTestFile, isTemplateOrSpec, sessions, parentMap } from "../state.js"
import { inferLingxiProgress } from "./lingxi-progress-hook.js"
import { lingxiTrackers } from "../lingxi/progress-tracker.js"
import type { PhaseId } from "../lingxi/config-loader.js"

/** 判断是否为审查行为（Momus/Oracle Agent 的工具调用） */
function isReviewAction(toolName: string, args: Record<string, unknown>): boolean {
  // 根因 I 修正：检测 task 工具委派行为（Sisyphus 通过 task 委派 Momus/Oracle）
  if (toolName === "task") {
    const desc = String(args.description ?? args.prompt ?? "").toLowerCase()
    if (
      desc.includes("momus") || desc.includes("审查") || desc.includes("review") ||
      desc.includes("oracle") || desc.includes("架构评估") || desc.includes("architecture")
    ) {
      return true
    }
  }
  // 审查行为特征：read 工具读取文档文件，或 bash 执行审查命令
  if (toolName === "read") {
    const fp = String(args.filePath ?? args.file_path ?? "")
    return fp.endsWith(".md") && (fp.includes("prd") || fp.includes("design") || fp.includes("test"))
  }
  if (toolName === "bash") {
    const cmd = String(args.command ?? "")
    return cmd.includes("review") || cmd.includes("check") || cmd.includes("validate")
  }
  return false
}



export const fileTrackerHook = {
  "tool.execute.after": async (input: any, output: any) => {
    const sessionId: string = input.sessionID ?? input.session_id ?? ""
    const toolName: string = input.tool ?? ""
    const args: Record<string, unknown> = input.args ?? {}

    // ── 子 session 父子关系建立（备用机制）────────────────
    // 当 session.created 事件未触发时，通过 task/delegate_task 工具调用建立父子关系
    if (toolName === "task" || toolName === "delegate_task" || toolName.includes("delegate")) {
      const childSessionId = String(output?.sessionId ?? output?.session_id ?? output?.id ?? "")
      if (childSessionId && childSessionId !== sessionId) {
        parentMap.set(childSessionId, sessionId)
      }
    }

    // ── 子 session 豁免：subagent 的工具调用不追踪 ──
    if (sessionId && parentMap.has(sessionId)) return

    const state = getState(sessionId)

    // ── Step_0 用户选择追踪 ─────────────────────────────
    // 捕获 question 工具的回答，识别"跳过规约"、"不使用模板"、本地文件路径选择
    if (toolName === "question" || toolName === "ask" || toolName.includes("question")) {
      // question 工具的 output 结构可能是多种形式，尽量兼容
      const rawOutput = output?.answers ?? output?.answer ?? output?.value ?? output?.result ?? output ?? ""

      // ── 分别处理两个问题的回答（模板 / 规约）──────────
      if (Array.isArray(rawOutput) && rawOutput.length >= 2) {
        const templateAnswer = String(rawOutput[0]?.answer ?? rawOutput[0]?.value ?? rawOutput[0] ?? "")
        const specAnswer = String(rawOutput[1]?.answer ?? rawOutput[1]?.value ?? rawOutput[1] ?? "")
        const templateLower = templateAnswer.toLowerCase()
        const specLower = specAnswer.toLowerCase()

        // 模板回答处理
        const templateIsPath = templateAnswer.includes("/") || templateAnswer.includes("\\") || (templateAnswer.endsWith(".md") && !["default", "不使用", "不使用模板"].includes(templateAnswer.trim()))
        if (templateIsPath) {
          // 本地模板：跳过 Hook 层固定章节验证，Agent 审查层基于完整内容做严格审查
          state.useLocalTemplate = true
          state.pendingLocalRead = true
          // 不设置 noTemplate — 用户使用了模板，只是来源是本地文件
        } else if (
          templateLower.includes("不使用") ||
          templateLower.includes("no template") ||
          templateLower.includes("notemplate") ||
          templateLower === "none"
        ) {
          state.noTemplate = true
          state.stageProgress.templateRead = true
        }

        // 规约回答处理
        const specIsPath = specAnswer.includes("/") || specAnswer.includes("\\") || (specAnswer.endsWith(".md") && !["留空", "skip", ""].includes(specAnswer.trim()))
        if (specIsPath) {
          // 本地规约：等待 read 工具触发 specRetrieved
          state.pendingLocalSpec = true
        } else if (
          specAnswer.trim() === "" ||
          specLower.includes("留空") ||
          specLower.includes("跳过") ||
          specLower === "skip"
        ) {
          state.skipSpec = true
          state.stageProgress.specRetrieved = true  // 视为已完成，不阻塞流程
        }
      } else {
        // 兜底：无法区分两个问题时，用合并文本做模糊匹配（向后兼容）
        const answerText = Array.isArray(rawOutput)
          ? rawOutput.map((a: any) => String(a?.answer ?? a?.value ?? a ?? "")).join("\n")
          : String(rawOutput)
        const answerLower = answerText.toLowerCase()

        // 用户选择"留空"跳过规约
        if (
          answerText.trim() === "" ||
          answerLower.includes("留空") ||
          answerLower.includes("跳过") ||
          answerLower === "skip"
        ) {
          state.skipSpec = true
          state.stageProgress.specRetrieved = true
        }
        // 用户选择"不使用模板"
        if (
          answerLower.includes("不使用") ||
          answerLower.includes("no template") ||
          answerLower.includes("notemplate") ||
          answerLower === "none"
        ) {
          state.noTemplate = true
          state.stageProgress.templateRead = true
        }
        // 用户输入本地文件路径
        if (answerText.includes("/") || answerText.includes("\\")) {
          state.useLocalTemplate = true
          state.pendingLocalRead = true
        }
      }

      // 同步到父 session（question 回答在主 session 中捕获，但子 session 也需要知道）
      const parentId = parentMap.get(sessionId)
      if (parentId) {
        const parentState = sessions.get(parentId)
        if (parentState) {
          if (state.noTemplate) parentState.noTemplate = true
          if (state.useLocalTemplate) parentState.useLocalTemplate = true
          if (state.skipSpec) parentState.skipSpec = true
          if (state.pendingLocalRead) parentState.pendingLocalRead = true
          if (state.pendingLocalSpec) parentState.pendingLocalSpec = true
          if (state.stageProgress.templateRead) parentState.stageProgress.templateRead = true
          if (state.stageProgress.specRetrieved) parentState.stageProgress.specRetrieved = true
        }
      }
    }

    // ── 三标记追踪（需求 3）──────────────────────────────
    // 根因 B 修正：OpenCode 的 MCP 工具名格式为 "serverName_toolName"
    // 例如 "financial-spec_get_spec"、"websearch_web_search_exa"
    // 必须使用 includes()/startsWith() 模糊匹配，不能用 === 精确匹配
    if (
      toolName === "mcp" ||
      toolName.includes("get_spec") ||
      toolName.includes("search_spec") ||
      toolName.startsWith("financial-spec_")
    ) {
      state.stageProgress.specRetrieved = true
    }
    if (
      toolName === "websearch" ||
      toolName === "web_search" ||
      toolName.includes("websearch") ||
      toolName.includes("web_search")
    ) {
      state.stageProgress.specRetrieved = true  // 降级替代
    }
    if (toolName === "bash") {
      const cmd = String(args.command ?? "")
      if (cmd.includes("get_spec")) {
        state.stageProgress.specRetrieved = true
      }
    }
    if (toolName === "grep" || toolName === "glob") {
      state.stageProgress.codebaseAnalyzed = true
    }
    // bash 执行 find/ls/dir 等也算代码库分析
    if (toolName === "bash") {
      const cmd = String(args.command ?? "")
      if (
        cmd.includes("find ") || cmd.includes(" ls") || cmd.includes("dir ") ||
        cmd.includes("glob") || cmd.includes("grep") || cmd.includes("rg ")
      ) {
        state.stageProgress.codebaseAnalyzed = true
      }
    }
    if (toolName === "read") {
      const fp = String(args.filePath ?? args.file_path ?? "")
      if (isTemplateOrSpec(fp)) {
        state.stageProgress.templateRead = true
      }
      // 本地模板路径：pendingLocalRead 机制（不依赖文件路径关键词）
      if (state.pendingLocalRead && fp) {
        state.stageProgress.templateRead = true
        state.pendingLocalRead = false  // 只触发一次
      }
      // 本地规约路径：pendingLocalSpec 机制
      if (state.pendingLocalSpec && fp) {
        state.stageProgress.specRetrieved = true
        state.pendingLocalSpec = false  // 只触发一次
      }
    }
    // get-template / list-templates 工具调用也算模板读取
    if (
      toolName === "get-template" ||
      toolName === "list-templates" ||
      toolName.includes("get-template") ||
      toolName.includes("list-template") ||
      toolName.includes("get_template") ||
      toolName.includes("list_template")
    ) {
      state.stageProgress.templateRead = true
    }

    // ── 测试文件追踪（需求 5）────────────────────────────
    if (toolName === "write" || toolName === "edit") {
      const fp = String(args.filePath ?? args.file_path ?? "")
      if (isTestFile(fp)) {
        state.stageProgress.testsWritten = true
      }
      // 文件修改追踪（需求 11）
      if (fp) {
        state.filesModified.push(fp)
      }
    }

    // ── 测试运行追踪（需求 5/8）──────────────────────────
    if (toolName === "bash") {
      const cmd = String(args.command ?? "")
      const outText = String(output?.output ?? output?.stdout ?? "")
      if (cmd.includes("pytest") && outText.includes("passed")) {
        state.stageProgress.testsPassed = true
      }
    }

    // ── 审查行为追踪（需求 7）────────────────────────────
    if (isReviewAction(toolName, args)) {
      state.stageProgress.reviewDone = true
      state.stageProgress.reviewRounds = Math.min(
        state.stageProgress.reviewRounds + 1,
        3,
      )
    }

    // ── 子 session 状态同步到父 session（单向合并）────────
    const parentId = parentMap.get(sessionId)
    if (parentId) {
      const parentState = sessions.get(parentId)
      if (parentState) {
        const sp = state.stageProgress
        const pp = parentState.stageProgress
        if (sp.specRetrieved) pp.specRetrieved = true
        if (sp.codebaseAnalyzed) pp.codebaseAnalyzed = true
        if (sp.templateRead) pp.templateRead = true
        if (sp.testsWritten) pp.testsWritten = true
        if (sp.testsPassed) pp.testsPassed = true
        if (sp.reviewDone) pp.reviewDone = true
        if (sp.reviewRounds > pp.reviewRounds) pp.reviewRounds = sp.reviewRounds
      }
    }

    // ── lingxi_harness 模式：细粒度 STAGE 进度推断 ──────────
    inferLingxiProgress(input, output)

    // ── lingxi_harness 模式：阶段切换（渐进注入）──────────
    // 注意：Step 级渐进注入已移至 update-step.ts 工具内部执行，
    // 因为 tool.execute.after 对插件内置工具不触发。
    // 监听 update-progress 调用，当某阶段完成时自动注入下一阶段 Pipeline
    if (
      state.isLingxiHarness &&
      state.lingxiPhaseQueue &&
      state.lingxiPhaseQueue.length > 0 &&
      (toolName === "update-progress" || toolName.includes("update-progress") || toolName.includes("update_progress"))
    ) {
      const mod = String(args.module ?? "")
      const status = String(args.status ?? "")

      if (status === "done" && mod === state.lingxiCurrentPhase) {
        const hasUnfinishedSteps = Boolean(state.lingxiCurrentStep) || Boolean(state.lingxiStepQueue?.length)
        if (hasUnfinishedSteps) {
          const tracker = lingxiTrackers.get(sessionId)
          tracker?.updatePhase(mod, "running")
          if (state.lingxiCurrentStep) {
            tracker?.updateStage(mod, state.lingxiCurrentStep, "running")
          }

          const client = state.lingxiClient
          const currentStep = state.lingxiCurrentStep ?? "当前 Step"
          const correction = `update-progress 被拒绝：${mod} 阶段仍有未完成 Step。当前应继续 ${currentStep}，完成后调用 update-step(feature="${state.lingxiFeatureId}", module="${mod}", step="${currentStep}", status="done")。只有阶段最后一个 Step 完成并收到系统提示后，才允许调用 update-progress。`
          // 延迟到 session idle 后注入纠正提示
          state.pendingInjection = { type: "step", sessionId, text: correction }
          console.warn(`[financial-harness] update-progress 拒绝提示已排队，等待 session idle`)
          return
        }

        const nextPhase = state.lingxiPhaseQueue.shift()!
        const completedPhase = state.lingxiCurrentPhase!

        // 更新状态
        state.lingxiCurrentPhase = nextPhase
        state.currentModule = nextPhase
        const tracker = lingxiTrackers.get(sessionId)
        tracker?.updatePhase(nextPhase, "running")
        tracker?.updateStage(nextPhase, "Step_0", "running")

        // 动态注入下一阶段 Pipeline（延迟到 session idle 后）
        try {
          const { LingxiOrchestrator } = await import("../lingxi/orchestrator.js")
          const orchestrator = new LingxiOrchestrator(
            state.lingxiConfig,
            state.lingxiFeatureId!,
            input.directory ?? process.cwd(),
            {
              title: state.lingxiFeatureTitle,
              requirementSource: state.lingxiRequirementSource,
            },
          )
          const stepNames = await orchestrator.getStepNames(nextPhase)
          state.lingxiCurrentStep = stepNames[0] ?? "Step_0"
          state.lingxiStepQueue = stepNames.slice(1)
          const transitionText = await orchestrator.buildPhaseTransition(completedPhase, nextPhase)

          // 存入 pendingInjection，由 session.idle 事件触发注入
          state.pendingInjection = { type: "phase-transition", sessionId, text: transitionText }
          console.warn(`[financial-harness] 阶段切换已排队，等待 session idle: ${completedPhase} → ${nextPhase}`)
        } catch (err) {
          // 阶段切换失败不阻塞当前执行
          console.error(`[financial-harness] 阶段切换准备失败 (${completedPhase} → ${nextPhase}):`, err)
        }
      }
    }
  },
}

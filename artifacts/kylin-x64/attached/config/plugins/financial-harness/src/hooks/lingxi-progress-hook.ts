// lingxi-progress-hook.ts — lingxi_harness 模式下的细粒度 Step 进度推断
// 通过 tool.execute.after 事件，根据工具调用模式推断当前 Step

import { lingxiTrackers, type LingxiProgressTracker } from "../lingxi/progress-tracker.js"
import { getState } from "../state.js"
import type { PhaseId } from "../lingxi/config-loader.js"

const MODULE_TO_PHASE: Record<string, PhaseId> = {
  prd: "prd",
  design: "design",
  code: "code",
  test: "test",
}

// Step 名称映射（与 PHASE_STAGES 对齐）
// PRD/Design: Step_0..Step_6, Code: Step_0..Step_8, Test: Step_0..Step_7
// 审查 Step：PRD/Design → Step_5, Code → Step_7, Test → Step_6
const REVIEW_STEP: Record<PhaseId, string> = {
  prd: "Step_5",
  design: "Step_5",
  code: "Step_7",
  test: "Step_6",
}

/**
 * lingxi_harness 进度推断处理函数
 * 由合并后的 tool.execute.after Hook 调用（与 file-tracker 共存）
 */
export function inferLingxiProgress(input: any, output: any): void {
  const sessionId: string = input.sessionID ?? input.session_id ?? ""
  const tracker = lingxiTrackers.get(sessionId)
  if (!tracker) return

  const state = getState(sessionId)
  if (!state.isLingxiHarness) return

  const toolName: string = input.tool ?? ""
  const args: Record<string, unknown> = input.args ?? {}
  const phase = state.lingxiCurrentPhase
  if (!phase) return

  // ── update-progress 工具调用 → 阶段完成 / Ralph Loop 上报 ──
  if (toolName === "update-progress" || toolName.includes("update-progress") || toolName.includes("update_progress")) {
    const mod = String(args.module ?? "")
    const status = String(args.status ?? "")
    const mappedPhase = MODULE_TO_PHASE[mod]
    if (!mappedPhase) return

    // ── Ralph Loop 上报（review_round 存在时处理）──
    const reviewRound = args.review_round !== undefined ? Number(args.review_round) : undefined
    if (reviewRound !== undefined) {
      const maxRounds = Number(args.max_rounds ?? 3)
      const reviewPassed = args.review_passed === true
      // review_stage 允许 pipeline 显式指定 Ralph Loop 显示在哪个 Step（如 Code Step_6 测试失败）
      // 未指定时回退到 REVIEW_STEP 默认映射
      const reviewStage = args.review_stage ? String(args.review_stage) : REVIEW_STEP[mappedPhase]

      if (!reviewPassed) {
        tracker.recordRalphLoop(mappedPhase, reviewRound, maxRounds, reviewStage)
        tracker.updateStage(mappedPhase, reviewStage, "running")
      } else {
        tracker.completeRalphLoop(mappedPhase)
        tracker.updateStage(mappedPhase, reviewStage, "completed")
        if (status !== "done") return
      }
    }

    if (mappedPhase && status === "done") {
      tracker.batch(() => {
        tracker.completeRalphLoop(mappedPhase)
        // 标记所有 Step 为 completed
        const progress = tracker.getProgress()
        const phaseProgress = progress.phases.find(p => p.id === mappedPhase)
        if (phaseProgress) {
          for (const stage of phaseProgress.stages) {
            if (stage.status !== "completed") {
              tracker.updateStage(mappedPhase, stage.name, "completed")
            }
          }
        }
        tracker.updatePhase(mappedPhase, "completed")

      })
    }
    return
  }

  // ── 辅助：补全指定 Step 之前的所有 Step 为 completed ──
  function completeStepsBefore(phaseId: PhaseId, targetStep: string): void {
    const progress = tracker!.getProgress()
    const phaseProgress = progress.phases.find(p => p.id === phaseId)
    if (!phaseProgress) return
    for (const stage of phaseProgress.stages) {
      if (stage.name === targetStep) break
      if (stage.status === "pending") {
        tracker!.updateStage(phaseId, stage.name, "completed")
      }
    }
  }

  // ── delegate_task 工具调用 → 推断 Step ──
  if (toolName === "task" || toolName === "delegate_task" || toolName.includes("delegate")) {
    const desc = String(args.description ?? args.prompt ?? "").toLowerCase()
    const subagentType = String(args.subagent_type ?? args.subagentType ?? "").toLowerCase()
    const isMomus = subagentType === "momus" || desc.includes("momus") || desc.includes("审查") || desc.includes("review")
    // Ralph Loop 修正阶段：writing/deep 在 Ralph Loop 活跃时被委派，说明是修正 subagent
    const ralphLoop = tracker.getProgress().phases.find(p => p.id === phase)?.ralphLoop
    const isRalphFixing = ralphLoop?.active && !isMomus &&
      (desc.includes("writing") || desc.includes("deep") || desc.includes("修正") || desc.includes("补充"))

    tracker.batch(() => {
      if (isRalphFixing) {
        // Ralph Loop 修正中：切换当前轮次状态为"修正中"
        tracker.startRalphLoopFixing(phase)
        return
      }

      if (desc.includes("librarian") || desc.includes("explore") || desc.includes("grep") || desc.includes("glob")) {
        // Step_1 开始：补全 Step_0 为 completed
        completeStepsBefore(phase, "Step_1")
        tracker.updateStage(phase, "Step_1", "running")
      } else if (desc.includes("task_plan") || desc.includes("任务规划") || desc.includes("任务列表")) {
        // Step_2 开始：补全 Step_0/Step_1 为 completed
        completeStepsBefore(phase, "Step_2")
        tracker.updateStage(phase, "Step_2", "running")
      } else if (isMomus) {
        // 审查阶段：使用 REVIEW_STEP 映射
        const reviewStep = REVIEW_STEP[phase]
        if (reviewStep) {
          completeStepsBefore(phase, reviewStep)
          tracker.updateStage(phase, reviewStep, "running")
        }
      } else if (desc.includes("hephaestus") || desc.includes("deep")) {
        // Code 阶段的 TDD 红灯/绿灯
        if (phase === "code") {
          const progress = tracker.getProgress()
          const codePhase = progress.phases.find(p => p.id === "code")
          if (codePhase) {
            const step3 = codePhase.stages.find(s => s.name === "Step_3")
            const step4 = codePhase.stages.find(s => s.name === "Step_4")
            if (step3?.status === "pending") {
              completeStepsBefore("code", "Step_3")
              tracker.updateStage("code", "Step_3", "running")
            } else if (step3?.status === "completed" && step4?.status === "pending") {
              tracker.updateStage("code", "Step_4", "running")
            }
          }
        }
      } else if (desc.includes("writing") || desc.includes("文档") || desc.includes("生成")) {
        // PRD/Design 文档生成 → Step_3
        completeStepsBefore(phase, "Step_3")
        tracker.updateStage(phase, "Step_3", "running")
      }
    })
    return
  }

  // ── query-progress 工具调用 → Step_0 ──
  if (toolName === "query-progress" || toolName.includes("query-progress") || toolName.includes("query_progress")) {
    const step0 = tracker.getProgress().phases.find(p => p.id === phase)?.stages.find(s => s.name === "Step_0")
    if (step0?.status === "pending") {
      tracker.updateStage(phase, "Step_0", "running")
    }
    return
  }

  // ── grep/glob → Step_1 进行中 ──
  if (toolName === "grep" || toolName === "glob") {
    tracker.batch(() => {
      completeStepsBefore(phase, "Step_1")
      tracker.updateStage(phase, "Step_1", "running")
    })
    return
  }

  // ── 测试/覆盖率命令 → Test Step_5（测试执行与覆盖率）──
  // Code 阶段不检测覆盖率，只关注测试是否通过（覆盖率由 Test 阶段负责）
  if (toolName === "bash" && phase === "test") {
    const cmd = String(args.command ?? "")
    const outText = String(output?.output ?? output?.stdout ?? "")

    const isCoverageCmd =
      (cmd.includes("pytest") && cmd.includes("--cov")) ||
      (cmd.includes("mvn") && (cmd.includes("test") || cmd.includes("verify"))) ||
      (cmd.includes("gradle") && cmd.includes("test")) ||
      (cmd.includes("jest") && cmd.includes("--coverage")) ||
      (cmd.includes("vitest") && cmd.includes("--coverage")) ||
      cmd.includes("jacoco")

    if (isCoverageCmd) {
      tracker.batch(() => {
        // Test → Step_5（测试执行与覆盖率）
        completeStepsBefore(phase, "Step_5")
        tracker.updateStage(phase, "Step_5", "running")

        // 检测覆盖率
        const covMatchPy = outText.match(/TOTAL\s+\d+\s+\d+\s+(\d+)%/)
        const covMatchJava = outText.match(/Total.*?(\d+)%/)
        const covMatchJs = outText.match(/All files[^|]*\|\s*(\d+\.?\d*)/)
        const covMatch = covMatchPy ?? covMatchJava ?? covMatchJs

        if (covMatch) {
          const coverage = parseInt(covMatch[1], 10)
          if (coverage < 80) {
            const progress = tracker.getProgress()
            const retry = progress.phases.find(p => p.id === "test")?.coverageRetry
            const attempt = (retry?.currentAttempt ?? 0) + 1
            tracker.recordCoverageRetry(attempt, 3, coverage)
          } else {
            tracker.updateStage(phase, "Step_5", "completed")
          }
        }
      })
    }
  }
}

// session-restore.ts — event + experimental.session.compacting Hook
// session.created: 建立父子关系 + 注入进度摘要
// session.deleted: 清理状态
// session.status (idle): 触发 pendingInjection 延迟注入
// compacting: 保留进度状态和任务计划路径引用

import { sessions, parentMap, getState } from "../state.js"
import { UnifiedProgressManager } from "../progress/unified-progress-manager.js"
import { pluginClient } from "../../index.js"

export const sessionRestoreHook = {
  event: async ({ event }: { event: any }) => {
    if (event.type === "session.created") {
      const props = event.properties ?? {}
      const createdSessionId: string = props.id ?? props.info?.id ?? ""
      if (!createdSessionId) return

      // 建立父子 session 关系（子 session 状态继承）
      if (props.parentID || props.info?.parentID) {
        const parentID = props.parentID || props.info?.parentID
        parentMap.set(createdSessionId, parentID)

        // 子 session 继承父 session 的 lingxi_harness 模式标记
        // 确保子 Agent 在写代码时能正确豁免检索验证
        const parentState = sessions.get(parentID)
        if (parentState?.isLingxiHarness) {
          const childState = getState(createdSessionId)
          childState.isLingxiHarness = true
          childState.lingxiCurrentPhase = parentState.lingxiCurrentPhase
          childState.lingxiCurrentStep = parentState.lingxiCurrentStep
          childState.lingxiStepQueue = parentState.lingxiStepQueue
          childState.lingxiFeatureId = parentState.lingxiFeatureId
          childState.lingxiFeatureTitle = parentState.lingxiFeatureTitle
          childState.lingxiRequirementSource = parentState.lingxiRequirementSource
          childState.currentModule = parentState.currentModule
          sessions.set(createdSessionId, childState)
        }
      }

      // 仅对顶层 session 注入进度摘要（需求 11.1）
      if (!props.parentID && !props.info?.parentID) {
        try {
          const pm = new UnifiedProgressManager(process.cwd())
          const progressText = await pm.formatSummary()
          const gitResult = await Bun.spawn(
            ["git", "log", "--oneline", "-10"],
            { stdout: "pipe", stderr: "ignore" },
          )
          const gitLog = await new Response(gitResult.stdout).text().catch(() => "")
          if (progressText && progressText !== "暂无进度记录") {
            await event.client?.session?.promptAsync?.({
              path: { id: createdSessionId },
              body: {
                parts: [{
                  type: "text",
                  text: `📋 上次工作状态\n${progressText}\n📝 最近提交\n${gitLog.trim()}\n💡 建议：根据进度继续下一阶段`,
                }],
                noReply: true,
              },
            })
          }
        } catch {
          // 静默失败，不影响正常使用
        }
      }
    }

    // ── session idle 后触发 pendingInjection ──
    if (event.type === "session.status") {
      const props = event.properties ?? {}
      const idleSessionId: string = props.sessionID ?? ""
      const status = props.status
      if (!idleSessionId || status?.type !== "idle") return

      const state = sessions.get(idleSessionId)
      if (!state?.pendingInjection) return

      const injection = state.pendingInjection
      state.pendingInjection = undefined  // 清空，防止重复注入

      const client = state.lingxiClient ?? pluginClient
      if (!client?.session?.promptAsync) {
        console.error(`[financial-harness] pendingInjection 注入失败：promptAsync 不可用 (session=${idleSessionId})`)
        return
      }

      try {
        await client.session.promptAsync({
          path: { id: injection.sessionId },
          body: { parts: [{ type: "text", text: injection.text }] },
        })
        console.warn(`[financial-harness] pendingInjection 注入成功 (type=${injection.type}, session=${idleSessionId})`)
      } catch (err) {
        console.error(`[financial-harness] pendingInjection 注入失败:`, err)
      }
    }

    if (event.type === "session.deleted") {
      const deletedSessionId: string = event.properties?.id ?? event.properties?.info?.id ?? ""
      if (deletedSessionId) {
        sessions.delete(deletedSessionId)
        parentMap.delete(deletedSessionId)
      }
    }
  },

  "experimental.session.compacting": async (input: any, output: any) => {
    const compactSessionId: string = input.sessionID ?? input.session_id ?? ""
    const state = sessions.get(compactSessionId)
    if (!state) return

    const mod = state.currentModule || "unknown"
    const sp = state.stageProgress
    output.context = output.context ?? []
    output.context.push(
      `[Financial Harness 状态] 模块: ${mod}, ` +
      `检索: spec=${sp.specRetrieved} template=${sp.templateRead} codebase=${sp.codebaseAnalyzed}, ` +
      `审查: ${sp.reviewDone ? `完成(${sp.reviewRounds}轮)` : "未开始"}\n` +
      `[文件结构] 进度文件: .harness/progress.json | 文档输出: docs/<feature>/${mod}.md | 临时文件: .harness/<feature>/${mod}_task_plan.md\n` +
      `[恢复方法] 调用 query-progress 查询进度，读取 docs/<feature>/ 下的上游文档恢复上下文`,
    )
  },
}

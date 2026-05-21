// system-inject.ts — experimental.chat.system.transform Hook
// 注入金融约束规则 + 模块路由 + 当前 STAGE 进度状态（总量 ≤ 2KB）
//
// NOTE: Disabled in enterprise offline package (Qwen3.5 incompatible).
// See 编译方案/opencode-offline-v1.4.7-win-x64/plugins/financial-harness/src/hooks/system-inject.ts

import path from "path"
import { sessions, parentMap } from "../state.js"
import { lingxiTrackers } from "../lingxi/progress-tracker.js"

const TOOLS_DIR = path.join(import.meta.dir, "../../harness-tools")
const MAX_BYTES = 2048

export const systemInjectHook = {
  "experimental.chat.system.transform": async (input: any, output: any) => {
    // ── 子 session 豁免：subagent 不注入额外 system prompt ──
    const sessionId: string = input.sessionID ?? ""
    if (sessionId && parentMap.has(sessionId)) return

    const parts: string[] = []

    // ── 读取金融约束规则 ──────────────────────────────────
    try {
      const rulesPath = path.join(TOOLS_DIR, "harness-rules.md")
      const rulesFile = Bun.file(rulesPath)
      if (await rulesFile.exists()) {
        const rules = await rulesFile.text()
        parts.push(`<financial-rules>\n${rules.slice(0, 800)}\n</financial-rules>`)
      }
    } catch {
      // 规则文件不存在，跳过
    }

    // ── 注入模块路由规则 ──────────────────────────────────
    parts.push(
      `<module-routing>
模块触发：/prd→PRD文档 | /design→架构设计 | /code→TDD编码 | /test→测试编写
上游关联：Design→PRD | Code→PRD+Design | Test→PRD+Design+Code
</module-routing>`,
    )

    // ── 动态注入 STAGE 进度状态 ───────────────────────────
    for (const [, state] of sessions) {
      if (!state.currentModule) continue
      const sp = state.stageProgress
      const tddLine =
        state.currentModule === "code"
          ? `\nTDD: tests=${sp.testsWritten ? "✅" : "⬜"} passed=${sp.testsPassed ? "✅" : "⬜"}`
          : ""
      parts.push(
        `<stage-progress module="${state.currentModule}">
检索: spec=${sp.specRetrieved ? "✅" : "⬜"} codebase=${sp.codebaseAnalyzed ? "✅" : "⬜"} template=${sp.templateRead ? "✅" : "⬜"}
审查: ${sp.reviewDone ? `完成（${sp.reviewRounds}/3轮）` : "未开始"}${tddLine}
</stage-progress>`,
      )
    }

    // ── Lingxi Step 级导航（混合方案：Phase 级注入 + Step 级 system 提示）──
    if (sessionId) {
      const tracker = lingxiTrackers.get(sessionId)
      if (tracker) {
        const nav = tracker.getCurrentStepInfo()
        if (nav) {
          const cur = nav.currentStep ? `${nav.currentStep.name} — ${nav.currentStep.description}` : "完成"
          const nxt = nav.nextStep ? `${nav.nextStep.name} — ${nav.nextStep.description}` : "阶段完成"
          parts.push(
            `<lingxi-step-nav phase="${nav.phaseId}" label="${nav.phaseLabel}">
当前: ${cur}
下一步: ${nxt}
⚠️ 请专注完成当前 Step，完成后再进入下一步。
</lingxi-step-nav>`,
          )
        }
      }
    }

    // ── 总量控制 ≤ 2KB ────────────────────────────────────
    const combined = parts.join("\n")
    const truncated = combined.length <= MAX_BYTES ? combined : combined.slice(0, MAX_BYTES)

    output.system = output.system ?? []
    if (output.system.length > 0) {
      output.system[0] = output.system[0] + "\n" + truncated
    } else {
      output.system.push(truncated)
    }
  },
}

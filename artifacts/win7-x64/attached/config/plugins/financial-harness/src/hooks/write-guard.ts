// write-guard.ts — tool.execute.before Hook
// 统一写入前拦截：检索验证 + TDD 强制

import { getState, isDocOrCode, isTestFile, isCodeFile, parentMap } from "../state.js"

export const writeGuardHook = {
  "tool.execute.before": async (input: any, output: any) => {
    const toolName: string = input.tool ?? ""
    if (toolName !== "write" && toolName !== "edit") return

    const sessionId = input.sessionID ?? input.session_id ?? ""

    // ── 子 session 豁免：subagent 的写入不拦截 ──
    if (sessionId && parentMap.has(sessionId)) return

    const filePath: string =
      output?.args?.filePath ?? output?.args?.file_path ?? input?.args?.filePath ?? ""
    if (!filePath) return

    const state = getState(sessionId)

    // ── 1. 检索验证 ──────────────────────────────────────
    const isLingxiHarnessPhase = state.isLingxiHarness &&
      (state.currentModule === "code" || state.currentModule === "test" || state.lingxiCurrentPhase !== undefined)
    const isDirectAgentCall = !state.currentModule
    if (isDocOrCode(filePath) && !isLingxiHarnessPhase && !isDirectAgentCall) {
      const missing: string[] = []
      if (!state.skipSpec && !state.stageProgress.specRetrieved) missing.push("规约检索")
      if (!state.stageProgress.codebaseAnalyzed) missing.push("代码库分析（grep/glob）")
      const stage1InProgress = state.stageProgress.specRetrieved || state.stageProgress.codebaseAnalyzed
      if (!state.noTemplate && !state.stageProgress.templateRead && !stage1InProgress) {
        missing.push("模板/规约读取")
      }
      if (missing.length > 0) {
        throw new Error(
          `Step_1 未完成，以下检索动作尚未执行：\n${missing.map((m) => `  - ${m}`).join("\n")}`,
        )
      }
    }

    // ── 2. TDD 强制 ──────────────────────────────────────
    if (
      state.currentModule === "code" &&
      isCodeFile(filePath) &&
      !isTestFile(filePath)
    ) {
      if (!state.stageProgress.testsWritten) {
        const ext = filePath.split(".").pop() ?? "code"
        const testHint: Record<string, string> = {
          py:   "test_*.py 或 *_test.py",
          java: "*Test.java 或 *Tests.java",
          ts:   "*.test.ts 或 *.spec.ts",
          js:   "*.test.js 或 *.spec.js",
          go:   "*_test.go",
          cs:   "*Tests.cs 或 *Test.cs",
          kt:   "*Test.kt",
          scala: "*Spec.scala 或 *Test.scala",
        }
        const hint = testHint[ext] ?? "对应语言的测试文件"
        throw new Error(
          `Step_3 未完成：TDD 要求先编写测试用例（红灯阶段），再开始编码实现。请先创建 ${hint} 文件。`,
        )
      }
    }
  },
}

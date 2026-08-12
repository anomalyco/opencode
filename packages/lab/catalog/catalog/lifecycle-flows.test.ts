import { describe, expect, test } from "bun:test"
import { executableFlows, executableScenarios, executableStates } from "../scenarios"
import { catalogScenarioRuntime, catalogViewport } from "../scenarios/runtime"
import { shellLifecycleFlow } from "../scenarios/tools/shell-lifecycle"
import { subagentLifecycleFlow } from "../scenarios/subagents/subagent-lifecycle"
import { sessionTabsFlow } from "../scenarios/session-tabs"
import { patchSuccessFlow } from "../scenarios/tools/patch-success"
import { flowGroups } from "./authored/flows"
import { screens } from "./authored/screens"

describe("catalog lifecycle scenarios", () => {
  test("registers canonical executable state addresses", () => {
    expect(shellLifecycleFlow.states.map((state) => state.address)).toEqual([
      "shell-lifecycle/thinking-streaming",
      "shell-lifecycle/shell-input-streaming",
      "shell-lifecycle/shell-output-streaming",
      "shell-lifecycle/shell-execute-succeeded",
      "shell-lifecycle/shell-execute-failed",
    ])
    expect(subagentLifecycleFlow.states.map((state) => state.address)).toEqual([
      "subagent-lifecycle/subagent-running",
      "subagent-lifecycle/subagent-completed",
      "subagent-lifecycle/subagent-session",
    ])
    expect(sessionTabsFlow.states.map((state) => state.address)).toEqual([
      "session-tabs-lifecycle/session-tabs-running",
      "session-tabs-lifecycle/session-tabs-idle",
    ])
    expect(patchSuccessFlow.states.map((state) => state.address)).toContain(
      "patch-success-lifecycle/permission-fullscreen",
    )
    expect(executableFlows).toContain(shellLifecycleFlow)
    expect(executableFlows).toContain(subagentLifecycleFlow)
    expect(executableStates.map((state) => state.address)).toContain("shell-lifecycle/shell-execute-failed")
    expect(executableStates.map((state) => state.address)).toContain("subagent-lifecycle/subagent-session")
  })

  test("authors screens and replayable flows from executable scenarios", () => {
    const authored = Object.values(flowGroups).flatMap((group) => Object.entries(group.flows))
    for (const scenario of executableScenarios) {
      for (const state of scenario.states) {
        const authoredScreen = Object.entries(screens).find(([id]) => id === state.id)?.[1]
        expect(authoredScreen === state.metadata.screen).toBe(true)
      }
      expect(authored.find(([id]) => id === scenario.id)?.[1].replayable).toBe(true)
    }
    expect(flowGroups["tool-use"].flows["shell-lifecycle"].replayable).toBe(true)
    expect(flowGroups.subagents.flows["subagent-lifecycle"].replayable).toBe(true)
    expect(flowGroups["session-management"].flows["session-tabs-lifecycle"].replayable).toBe(true)
  })

  test("declares the one dynamic response-mode scenario", () => {
    expect(executableScenarios.filter((scenario) => scenario.llmMode === "serve").map((scenario) => scenario.id))
      .toEqual(["subagent-lifecycle"])
  })

  test("isolates scenarios that cannot safely reset their TUI client", () => {
    expect(executableScenarios.filter((scenario) => scenario.clientIsolation === "isolated").map((scenario) => scenario.id))
      .toEqual(["assistant-lifecycle", "question-lifecycle", "read-file-lifecycle", "session-tabs-lifecycle"])
  })

  test("builds the shared capture and reproduce driver runtime", () => {
    const runtime = catalogScenarioRuntime({ opencode: "/tmp/opencode", theme: "rosepine" })
    expect(runtime.opencode).toEqual({ dev: "/tmp/opencode" })
    expect(runtime.tui?.viewport).toEqual(catalogViewport)
    expect(runtime.project?.files).toMatchObject({
      "fixture.txt": "before\n",
      "src/ledger.ts": expect.stringContaining("total"),
    })
    expect(runtime.tools).toBeFunction()
    expect(runtime.setup).toBeFunction()
  })
})

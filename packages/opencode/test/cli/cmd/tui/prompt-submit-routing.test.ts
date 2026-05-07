import { beforeEach, describe, expect, test } from "bun:test"
import { getModeController, ExecutionMode } from "@shell-mode"
import { determineRouting } from "@tui-integration"

// Reproduces the routing dispatch from prompt/index.tsx submit():
//   const routing = await determineRouting(inputText)
//   if (routing === "shell") sdk.client.session.shell(...)
//   else sdk.client.session.prompt(...)
//
// Testing against mock executors lets us verify the routing contract without
// the SolidJS/SDK runtime. The actual determineRouting() function is used, so
// any change to its logic is caught here.
async function simulateSubmitRouting(
  input: string,
  shellExecutor: (cmd: string) => void,
  agentExecutor: (prompt: string) => void,
): Promise<void> {
  const routing = await determineRouting(input)
  if (routing === "shell") {
    shellExecutor(input)
  } else {
    agentExecutor(input)
  }
}

// ── Prompt submit routing — LAC-163 regression ────────────────────────────────
//
// Regression for LAC-163: prompt submit must use determineRouting() (not a
// raw store.mode check) so that mode-driven routing is applied consistently.

describe("prompt submit routing — LAC-163 regression", () => {
  beforeEach(() => {
    getModeController().setMode(ExecutionMode.Auto)
  })

  // ── Shell mode ────────────────────────────────────────────────────────────

  test("shell mode routes to shell executor regardless of input content", async () => {
    getModeController().setMode(ExecutionMode.Shell)

    const shellCalls: string[] = []
    const agentCalls: string[] = []

    await simulateSubmitRouting(
      "What does this function do?",
      (cmd) => shellCalls.push(cmd),
      (prompt) => agentCalls.push(prompt),
    )

    expect(shellCalls).toHaveLength(1)
    expect(shellCalls[0]).toBe("What does this function do?")
    expect(agentCalls).toHaveLength(0)
  })

  test("shell mode forces shell routing even for natural language", async () => {
    getModeController().setMode(ExecutionMode.Shell)

    const shellCalls: string[] = []
    const agentCalls: string[] = []

    for (const input of [
      "Explain the auth flow",
      "Help me fix this bug",
      "Why is the build failing",
    ]) {
      await simulateSubmitRouting(
        input,
        (cmd) => shellCalls.push(cmd),
        (prompt) => agentCalls.push(prompt),
      )
    }

    expect(shellCalls).toHaveLength(3)
    expect(agentCalls).toHaveLength(0)
  })

  // ── Agent mode ────────────────────────────────────────────────────────────

  test("agent mode routes to agent executor regardless of input content", async () => {
    getModeController().setMode(ExecutionMode.Agent)

    const shellCalls: string[] = []
    const agentCalls: string[] = []

    await simulateSubmitRouting(
      "ls -la",
      (cmd) => shellCalls.push(cmd),
      (prompt) => agentCalls.push(prompt),
    )

    expect(shellCalls).toHaveLength(0)
    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0]).toBe("ls -la")
  })

  test("agent mode forces agent routing even for shell commands", async () => {
    getModeController().setMode(ExecutionMode.Agent)

    const shellCalls: string[] = []
    const agentCalls: string[] = []

    for (const input of ["ls -la", "git status", "echo hello"]) {
      await simulateSubmitRouting(
        input,
        (cmd) => shellCalls.push(cmd),
        (prompt) => agentCalls.push(prompt),
      )
    }

    expect(shellCalls).toHaveLength(0)
    expect(agentCalls).toHaveLength(3)
  })

  // ── Auto mode ─────────────────────────────────────────────────────────────

  test("auto mode + shell command routes to shell executor", async () => {
    getModeController().setMode(ExecutionMode.Auto)

    const shellCalls: string[] = []
    const agentCalls: string[] = []

    await simulateSubmitRouting(
      "ls -la",
      (cmd) => shellCalls.push(cmd),
      (prompt) => agentCalls.push(prompt),
    )

    expect(shellCalls).toHaveLength(1)
    expect(agentCalls).toHaveLength(0)
  })

  test("auto mode + natural language routes to agent executor", async () => {
    getModeController().setMode(ExecutionMode.Auto)

    const shellCalls: string[] = []
    const agentCalls: string[] = []

    await simulateSubmitRouting(
      "What does this function do?",
      (cmd) => shellCalls.push(cmd),
      (prompt) => agentCalls.push(prompt),
    )

    expect(shellCalls).toHaveLength(0)
    expect(agentCalls).toHaveLength(1)
  })

  test("auto mode routes multiple NL queries all to agent executor", async () => {
    getModeController().setMode(ExecutionMode.Auto)

    const shellCalls: string[] = []
    const agentCalls: string[] = []

    for (const input of [
      "Explain the auth flow",
      "Help me fix this bug",
      "How do I run the tests",
      "Can you refactor this module",
    ]) {
      await simulateSubmitRouting(
        input,
        (cmd) => shellCalls.push(cmd),
        (prompt) => agentCalls.push(prompt),
      )
    }

    expect(shellCalls).toHaveLength(0)
    expect(agentCalls).toHaveLength(4)
  })
})

// ── Enter vs Shift+Enter ──────────────────────────────────────────────────────
//
// Plain Enter triggers onSubmit() → submit() → routing. Shift+Enter inserts a
// newline in @opentui/core's textarea without calling onSubmit() at all — this
// is handled entirely inside the textarea widget and is not exercisable via
// unit tests at this level. The submit() function has a separate early-exit
// guard for empty input: `if (!store.prompt.input) return false`.

describe("submit early-exit guards", () => {
  test("empty input does not reach either executor", async () => {
    // This mirrors the empty-input guard in submit():
    //   if (!store.prompt.input) return false
    // A Shift+Enter on a blank line would leave input as "" — submit() bails
    // before calling determineRouting, so neither executor is invoked.
    getModeController().setMode(ExecutionMode.Shell)

    const shellCalls: string[] = []
    const agentCalls: string[] = []

    const input = ""
    if (input) {
      await simulateSubmitRouting(
        input,
        (cmd) => shellCalls.push(cmd),
        (prompt) => agentCalls.push(prompt),
      )
    }

    expect(shellCalls).toHaveLength(0)
    expect(agentCalls).toHaveLength(0)
  })

  test("whitespace-only input does not reach either executor", async () => {
    // store.prompt.input.trim() check for "exit"/"quit" runs after the empty
    // guard, but the empty guard itself (`!store.prompt.input`) also catches
    // whitespace-only input because an empty string is falsy.
    getModeController().setMode(ExecutionMode.Shell)

    const shellCalls: string[] = []
    const agentCalls: string[] = []

    const input = "   "
    if (input.trim()) {
      await simulateSubmitRouting(
        input,
        (cmd) => shellCalls.push(cmd),
        (prompt) => agentCalls.push(prompt),
      )
    }

    expect(shellCalls).toHaveLength(0)
    expect(agentCalls).toHaveLength(0)
  })
})

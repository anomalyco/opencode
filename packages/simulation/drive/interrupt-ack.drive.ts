// Black-box simulation: interrupting a turn mid-tool acknowledges immediately and
// leaves the session usable.
//
//   opencode-drive run packages/simulation/drive/interrupt-ack.drive.ts
//
// Run from the repository root: the simulation launches this checkout's server and TUI.
// The turn is held open by a Drive-controlled shell tool that never settles on its
// own, so the interrupt gesture races real server-side cleanup instead of an
// already-finished drain.
import { Effect } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"

export default OpenCodeDriver.use(
  {
    opencode: { dev: process.cwd() },
    project: {
      git: true,
      files: { "README.md": "# Interrupt fixture\n" },
    },
    tools: ["shell"],
  },
  ({ ui, llm, tools }) =>
    Effect.gen(function* () {
      const shells = yield* tools.control("shell")
      yield* llm.queue(
        Llm.toolCall({ index: 0, id: "call_slow", name: "shell", input: { command: "make build" } }),
        Llm.finish("tool-calls"),
      )
      yield* ui.submit("Build the project")

      const shell = yield* shells.take("call_slow")
      yield* shell.progress("building...\n")
      yield* ui.screenshot("mid-tool")

      // Double Esc while the tool call is still running: the interrupt must acknowledge
      // without waiting out cleanup, and the tool observes native interruption.
      yield* ui.press("escape")
      yield* ui.press("escape")
      yield* shell.awaitInterrupted()
      yield* ui.waitFor("interrupted")
      yield* ui.screenshot("interrupted")

      // A repeated gesture during or after teardown is a safe no-op, never an error.
      yield* ui.press("escape")
      yield* ui.press("escape")

      // The session stays usable: the next prompt runs a fresh turn.
      yield* llm.queue(Llm.text("Still here."))
      yield* ui.submit("Are you still there?")
      yield* ui.waitFor("Still here.")
      yield* ui.screenshot("recovered")
    }),
)

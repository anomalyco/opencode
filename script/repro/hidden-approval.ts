import { Effect, Stream } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"
import path from "node:path"

// Run from this checkout; OPENCODE_DEV selects the unmodified base or the fix checkout.
// OPENCODE_REPRO_BEFORE=1 OPENCODE_DEV=/path/to/base opencode-drive run script/repro/hidden-approval.ts
// OPENCODE_DEV=$PWD opencode-drive run script/repro/hidden-approval.ts
const before = process.env.OPENCODE_REPRO_BEFORE === "1"
const label = before ? "BEFORE" : "AFTER"
const viewport = { cols: 100, rows: 30 }

export default OpenCodeDriver.use(
  {
    opencode: {
      dev: process.env.OPENCODE_DEV ?? process.cwd(),
      env: { BUN_OPTIONS: `--preload=${path.resolve("script/repro/hidden-approval-preload.ts")}` },
    },
    project: { git: true, files: { "src/example.ts": "export const example = true\n" } },
    config: {
      autoupdate: false,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "glob", resource: "*", effect: "ask" },
      ],
    },
    tui: { viewport },
    keepArtifacts: true,
  },
  ({ ui, tui, tuis, llm, opencode }) =>
    Effect.gen(function* () {
      yield* llm.title(() => Effect.succeed("Waiting for search approval"))
      yield* llm.serve((_request, index) =>
        index === 0
          ? Stream.make(
              Llm.text("I will find the TypeScript files once you approve the search."),
              Llm.toolCall({
                index: 0,
                id: "call_search",
                name: "glob",
                input: { pattern: "**/*.ts", path: ".", limit: 10 },
              }),
              Llm.finish("tool-calls"),
            )
          : Stream.make(Llm.text("Search complete. Found src/example.ts.")),
      )
      yield* ui.submit("Find the TypeScript files.")
      yield* ui.waitFor("Allow once", { timeout: 20_000 })
      const session = (yield* opencode.session.list({ limit: 1 })).data[0]
      if (!session) return yield* Effect.die("No session created")
      const initial = yield* opencode.permission.list({ sessionID: session.id })
      if (initial.length !== 1) return yield* Effect.die("Expected one pending approval")
      yield* ui.screenshot(`${label.toLowerCase()}-initial-approval`)

      // This is the real automatic sweep, not a manual cache invalidation.
      yield* Effect.sleep("10 seconds")
      const pending = yield* opencode.permission.list({ sessionID: session.id })
      if (pending.length !== (before ? 0 : 1))
        return yield* Effect.die(`Unexpected pending approval count: ${pending.length}`)
      if (pending[0] && pending[0].id !== initial[0]?.id) return yield* Effect.die("Approval identity changed")

      yield* tui.close()
      const reopened = yield* tuis.launch({ viewport, recording: true })
      if (!reopened.recording) return yield* Effect.die("Recording unavailable")
      yield* reopened.ui.submit("/sessions")
      yield* reopened.ui.waitFor("Waiting for search approval")
      yield* reopened.ui.enter()
      yield* reopened.ui.waitFor("Find the TypeScript files.", { timeout: 20_000 })
      if (before && (yield* reopened.ui.matches("Allow once")))
        return yield* Effect.die("Baseline unexpectedly retained its approval")
      if (!before) yield* reopened.ui.waitFor("Allow once")
      yield* reopened.recording.mark(
        `${label}: reopened after cleanup (${before ? "approval lost; still active" : "same approval retained"})`,
      )
      yield* reopened.ui.screenshot(`${label.toLowerCase()}-reopened`)
      yield* Effect.sleep("3 seconds")
      yield* reopened.recording.mark(`${label}: press Enter to approve`)
      yield* reopened.ui.enter()
      if (!before) yield* reopened.ui.waitFor("Search complete.", { timeout: 15_000 })
      yield* Effect.sleep("3 seconds")
      yield* reopened.ui.screenshot(`${label.toLowerCase()}-result`)
      const active = yield* opencode.session.active()
      if (Boolean(active[session.id]) !== before) return yield* Effect.die("Unexpected execution status")
      console.log(JSON.stringify({ label, pending: pending.length, active: Boolean(active[session.id]) }))
      console.log("video:", yield* reopened.recording.finish())
      yield* opencode.session.interrupt({ sessionID: session.id })
      yield* opencode.session.wait({ sessionID: session.id })
    }),
)

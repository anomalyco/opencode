import { Effect, Stream } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"

const label = process.env.DEMO_LABEL ?? "AFTER"

// Run from the repository root with `opencode-drive run script/drive/shell-output.ts`.
// Set OPENCODE_DEV to an immutable base worktree and DEMO_LABEL=BEFORE for comparison.
// Only the conversation is simulated; shell execution and output reads are real.
export default OpenCodeDriver.use(
  {
    opencode: { dev: process.env.OPENCODE_DEV ?? process.cwd() },
    keepArtifacts: true,
    tui: { recording: true, keypressOverlay: true, viewport: { cols: 90, rows: 30 } },
    config: { autoupdate: false, username: "Demo" },
    tuiConfig: { theme: { name: "opencode", mode: "dark" }, animations: false, tabs: { enabled: false } },
    project: {
      git: true,
      files: {
        "README.md": "# Shell output demo\nDeterministic real shell output.\n",
        "render-scene.sh": [
          "#!/bin/sh",
          "i=1",
          'while [ "$i" -le 40 ]; do printf "Frame %02d: rendered successfully\\n" "$i"; i=$((i+1)); done',
          "while [ ! -f continue ]; do sleep 0.1; done",
          'while [ "$i" -le 48 ]; do printf "Frame %02d: rendered successfully\\n" "$i"; i=$((i+1)); sleep 0.25; done',
          "while [ ! -f finish ]; do sleep 0.1; done",
          "printf 'Diagnostics: no errors\\n' >&2",
          "printf 'Render complete: 48 frames saved.\\n'",
        ].join("\n"),
      },
    },
  },
  ({ ui, llm, tui, opencode, artifacts }) =>
    Effect.gen(function* () {
      const recording = tui.recording
      if (!recording) return yield* Effect.fail(new Error("Recording required"))
      yield* llm.serve(() => Stream.make(Llm.text("Ready to inspect the render job.")))
      yield* ui.submit("Inspect the render job.")
      yield* ui.waitFor("Ready to inspect the render job.")
      const sessions = yield* opencode.session.list({ limit: 1, order: "desc" })
      const session = sessions.data[0]
      if (!session) return yield* Effect.fail(new Error("Session missing"))
      yield* opencode.session.rename({ sessionID: session.id, title: "Shell output demo" })
      yield* opencode.shell.create({ command: "sh render-scene.sh", timeout: 0, metadata: { sessionID: session.id } })
      yield* ui.arrow("down")
      yield* ui.arrow("right")
      yield* ui.waitFor("sh render-scene.sh")
      yield* recording.mark(`${label}: select a running shell`)
      yield* Effect.sleep(1000)
      yield* ui.enter()
      yield* Effect.sleep(1000)
      yield* recording.mark(`${label}: Enter ${label === "AFTER" ? "opens live output" : "does nothing"}`)
      console.log("opened:", yield* ui.screenshot(`${label.toLowerCase()}-opened`))
      yield* Effect.promise(() => Bun.write(`${artifacts}/files/continue`, "go"))
      yield* Effect.sleep(2800)
      yield* ui.press("home")
      yield* recording.mark(`${label}: ${label === "AFTER" ? "Home scrolls to earlier output" : "no output to scroll"}`)
      yield* Effect.sleep(1500)
      console.log("scrolled:", yield* ui.screenshot(`${label.toLowerCase()}-scrolled`))
      yield* ui.press("end")
      yield* recording.mark(`${label}: ${label === "AFTER" ? "End follows the latest output" : "no output to follow"}`)
      yield* Effect.sleep(1000)
      yield* Effect.promise(() => Bun.write(`${artifacts}/files/finish`, "go"))
      yield* Effect.sleep(1600)
      yield* recording.mark(
        `${label}: ${label === "AFTER" ? "result stays open after exit" : "finished shell disappears"}`,
      )
      console.log("exited:", yield* ui.screenshot(`${label.toLowerCase()}-exited`))
      yield* Effect.sleep(2000)
      yield* ui.resize({ cols: 40, rows: 24 })
      yield* Effect.sleep(500)
      console.log("narrow:", yield* ui.screenshot(`${label.toLowerCase()}-narrow`))
      yield* ui.resize({ cols: 90, rows: 30 })
      yield* Effect.sleep(500)
      yield* ui.press("escape")
      yield* recording.mark(`${label}: Esc back`)
      yield* Effect.sleep(1000)
      console.log("back:", yield* ui.screenshot(`${label.toLowerCase()}-back`))
      return console.log("video:", yield* recording.finish())
    }),
)

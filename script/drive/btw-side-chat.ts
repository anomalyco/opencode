import { Effect, Stream } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"

// Run from the repository root with `opencode-drive run script/drive/btw-side-chat.ts`.
// The conversation and the agent's shell command are simulated; /btw, the side panel, the note the
// side chat relays on its own and its delivery at the agent's next step are real.
const side = "quick side question about the conversation so far"

export default OpenCodeDriver.use(
  {
    opencode: { dev: process.env.OPENCODE_DEV ?? process.cwd() },
    keepArtifacts: true,
    tools: ["shell"],
    tui: { recording: true, keypressOverlay: true, viewport: { cols: 150, rows: 40 } },
    config: {
      autoupdate: false,
      username: "Demo",
      model: "simulation/claude-opus-5-5",
      providers: {
        simulation: {
          name: "Anthropic",
          models: {
            "claude-opus-5-5": {
              name: "Claude Opus 5.5",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 128_000, output: 16_000 },
            },
          },
        },
      },
    },
    tuiConfig: { theme: { name: "opencode", mode: "dark" }, animations: false, tabs: { mode: "off" } },
    project: {
      name: "client",
      git: true,
      files: {
        "test/reconnect.test.ts": "test('reconnects', async () => {\n  await sleep(50)\n})\n",
      },
    },
  },
  ({ ui, llm, tui, tools, artifacts }) =>
    Effect.gen(function* () {
      const recording = tui.recording
      if (!recording) return yield* Effect.fail(new Error("Recording required"))
      const shells = yield* tools.control("shell")
      const shots: string[] = []
      const shot = (name: string) => ui.screenshot(name).pipe(Effect.tap((path) => Effect.sync(() => shots.push(path))))

      yield* llm.serve((request) => {
        const body = JSON.stringify(request.body)
        if (body.includes(side)) {
          const asked = body.slice(body.lastIndexOf("User: "))
          if (asked.includes("tell the agent"))
            return Stream.make(
              Llm.text(
                "Passing that on, so it keeps the fake clock.\n\n<to-agent>\nKeep the injected fake clock and don't raise the timeout; a longer wait only hides the race.\n</to-agent>",
                { delay: 4, chunkSize: 24 },
              ),
            )
          if (asked.includes("injecting the clock"))
            return Stream.make(
              Llm.text(
                "Yes. With a fake clock the test decides when the retry fires, so timer resolution stops mattering.\n\nA bigger timeout would only hide it:\n\n- it slows every run\n- a busy CI machine can still go past it",
                { delay: 4, chunkSize: 24 },
              ),
            )
          return Stream.make(
            Llm.text(
              "Windows' default timer resolution is about **15.6 ms**. Unless a process asks for finer timers, `setTimeout(fn, 50)` fires on the next tick after 50 ms, which can be as late as 64 ms.\n\nmacOS and Linux use high-resolution timers, so the same test rarely slips there.",
              { delay: 4, chunkSize: 24 },
            ),
          )
        }
        if (body.includes("from a /btw side conversation"))
          return Stream.make(
            Llm.text(
              "20/20 passed. Got your note from the side chat: I'm keeping the fake clock and not raising the timeout. The test now waits for the `reconnected` event instead of sleeping.",
              { delay: 4, chunkSize: 24 },
            ),
          )
        return Stream.make(
          Llm.text("The test sleeps a fixed 50 ms before asserting. I'll inject the clock, then rerun it 20 times."),
          Llm.toolCall({
            index: 0,
            id: "call_rerun",
            name: "shell",
            input: { command: "bun test reconnect --rerun-each 20", description: "Rerun the reconnect test" },
          }),
          Llm.finish("tool-calls"),
        )
      })

      yield* ui.waitFor("Claude Opus 5.5", { timeout: 30000 })
      yield* ui.submit("The reconnect test fails about 1 in 5 runs on Windows. Find out why and fix it.")
      const rerun = yield* shells.take("call_rerun")
      yield* rerun.progress("bun test v1.3.14\n")
      yield* recording.mark("The agent is working")
      yield* Effect.sleep(1200)

      yield* ui.submit("/btw why would timers fire late on Windows?")
      yield* ui.waitFor("15.6 ms", { timeout: 20000 })
      yield* recording.mark("/btw opens a side chat beside the session")
      yield* Effect.sleep(1500)
      yield* shot("side-chat-answer")

      yield* ui.submit("so is injecting the clock enough?")
      yield* ui.waitFor("busy CI machine", { timeout: 20000 })
      yield* recording.mark("Follow-ups stay in the side chat")
      yield* Effect.sleep(1500)
      yield* shot("side-chat-follow-up")

      yield* ui.submit("ok, tell the agent to keep the fake clock and not bump the timeout")
      yield* ui.waitFor("Passing that on", { timeout: 20000 })
      yield* ui.waitFor("Keep the injected fake clock", { timeout: 10000 })
      yield* recording.mark("Asked to tell the agent, the side chat sends a note on its own")
      yield* Effect.sleep(1500)
      yield* shot("side-chat-relayed")

      yield* rerun.progress("bun test v1.3.14\n\n 20 pass\n 0 fail\n")
      yield* rerun.succeed({ output: "bun test v1.3.14\n\n 20 pass\n 0 fail\n", exit: 0 })
      yield* ui.waitFor("Got your note", { timeout: 20000 })
      yield* recording.mark("The agent reads it at its next step")
      yield* Effect.sleep(2000)
      yield* shot("agent-used-side-chat")

      yield* ui.resize({ cols: 100, rows: 34 })
      yield* Effect.sleep(800)
      yield* recording.mark("Narrow terminals show the side chat full screen")
      yield* shot("narrow")
      yield* Effect.sleep(1200)
      yield* ui.press("escape")
      yield* Effect.sleep(800)
      yield* recording.mark("esc closes it; the footer keeps the thread one click away")
      yield* shot("narrow-closed")
      yield* Effect.sleep(1500)
      console.log(JSON.stringify({ artifacts, shots }, null, 2))
    }),
)

import { Deferred, Effect, Stream } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"
import { AbsolutePath } from "../../packages/schema/src/schema"
import { Database } from "bun:sqlite"

const label = process.env.DEMO_LABEL ?? "AFTER"
const evict = process.env.DEMO_EVICT !== "false"

// Run with OPENCODE_DRIVE_DB=proof.sqlite. Only model output and fixture_hold are
// simulated. The debug endpoint closes the real graph without waiting an hour.
// Dynamic tools avoid the static adapter issue: anomalyco/opencode-drive#116.
export default OpenCodeDriver.use(
  {
    opencode: { dev: process.env.OPENCODE_DEV ?? process.cwd() },
    keepArtifacts: true,
    tui: { recording: true, viewport: { cols: 100, rows: 30 } },
    config: {
      autoupdate: false,
      username: "Demo",
      agents: { reviewer: { mode: "subagent", description: "Review the fixture" } },
    },
    tuiConfig: { theme: { name: "opencode", mode: "dark" }, animations: false, tabs: { mode: "off" } },
    project: { git: true, files: { "README.md": "# Parent fixture\n", "child/README.md": "# Child fixture\n" } },
  },
  ({ ui, llm, tui, opencode, artifacts, tools }) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const held = yield* Deferred.make<void>()
      yield* tools.attach({
        tools: [
          {
            name: "fixture_hold",
            description: "Wait for the fixture",
            inputSchema: { type: "object", properties: {} },
            options: { codemode: false },
          },
        ],
      })
      let parentRequests = 0
      let childRequests = 0
      yield* llm.serve((request) => {
        const body = JSON.stringify(request)
        if (body.includes("You are a subagent spawned")) {
          childRequests++
          if (childRequests === 1)
            return Stream.make(
              Llm.toolCall({ index: 0, id: "call_hold", name: "fixture_hold", input: {} }),
              Llm.finish("tool-calls"),
            )
          return Stream.fromEffect(
            Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))),
          ).pipe(Stream.flatMap(() => Stream.make(Llm.text("CHILD_REVIEW_COMPLETE"))))
        }
        parentRequests++
        if (parentRequests === 1)
          return Stream.make(
            Llm.toolCall({
              index: 0,
              id: "call_review",
              name: "subagent",
              input: {
                agent: "reviewer",
                description: "Review fixture",
                prompt: "Review the child fixture",
                background: true,
              },
            }),
            Llm.finish("tool-calls"),
          )
        return Stream.make(
          Llm.text(
            parentRequests === 2 ? "Review is running in the background." : "Review received. All checks passed.",
          ),
        )
      })
      yield* ui.waitFor("Simulated Model", { timeout: 30000 })
      yield* ui.submit("Run the fixture review in the background.")
      yield* ui.waitFor("Review is running in the background.", { timeout: 30000 })
      const parent = (yield* opencode.session.list({ limit: 20 })).data.find((session) => !session.parentID)
      if (!parent) return yield* Effect.fail(new Error("Parent missing"))
      const child = (yield* opencode.session.list({ parentID: parent.id })).data[0]
      if (!child) return yield* Effect.fail(new Error("Child missing"))
      const hold = yield* tools.take("call_hold")
      yield* opencode.session.move({ sessionID: child.id, directory: AbsolutePath.make(`${artifacts}/files/child`) })
      yield* hold.finish({ structured: {}, content: [{ type: "text", text: "Fixture ready" }] })
      yield* Deferred.await(held).pipe(Effect.timeout("30 seconds"))
      const moved = yield* opencode.session.get({ sessionID: child.id })
      if (moved.location.directory !== `${artifacts}/files/child`)
        return yield* Effect.fail(new Error("Child did not move"))
      yield* opencode.session.wait({ sessionID: parent.id })
      if (evict) {
        yield* opencode.debug.location.evict({ location: { directory: parent.location.directory } })
        yield* opencode.location.get({ location: { directory: parent.location.directory } })
      }
      if (tui.recording)
        yield* tui.recording.mark(`${label}: parent idle${evict ? ", original location evicted" : " (control)"}`)
      yield* Deferred.succeed(release, undefined)
      yield* opencode.session.wait({ sessionID: child.id })
      const resumed = yield* ui.waitFor("Review received. All checks passed.", { timeout: 5000 }).pipe(
        Effect.as(true),
        Effect.catchTag("UiWaitTimeoutError", () => Effect.succeed(false)),
      )
      const messages = yield* opencode.message.list({ sessionID: parent.id })
      const childMessages = yield* opencode.message.list({ sessionID: child.id })
      const completed = childMessages.data.some(
        (message) =>
          message.type === "assistant" &&
          message.finish === "stop" &&
          message.content.some((part) => part.type === "text" && part.text === "CHILD_REVIEW_COMPLETE"),
      )
      const notifications = messages.data.filter(
        (message) => message.type === "synthetic" && message.metadata?.source === "subagent",
      ).length
      const marker = yield* Effect.acquireUseRelease(
        Effect.sync(() => new Database(`${artifacts}/logs/opencode/proof.sqlite`, { readonly: true })),
        (database) =>
          Effect.sync(() =>
            database
              .query<
                { status: string; output: string },
                [string]
              >("SELECT json_extract(value, '$.status') AS status, json_extract(value, '$.output') AS output FROM kv WHERE key LIKE 'job.background/%' AND json_extract(value, '$.recovery.childSessionID') = ?")
              .get(child.id),
          ),
        (database) => Effect.sync(() => database.close()),
      )
      const proof = { label, evict, resumed, completed, notifications, parentRequests, childRequests, marker }
      console.log(JSON.stringify(proof, null, 2))
      yield* Effect.promise(() => Bun.write(`${artifacts}/proof.json`, JSON.stringify(proof, null, 2)))
      if (
        !completed ||
        notifications !== (resumed ? 1 : 0) ||
        (resumed ? marker !== null : marker?.status !== "completed")
      )
        return yield* Effect.fail(new Error("Inconsistent completion evidence"))
      if (evict) {
        yield* opencode.debug.location.evict({ location: { directory: parent.location.directory } })
        yield* opencode.location.get({ location: { directory: parent.location.directory } })
        const rebuilt = yield* opencode.message.list({ sessionID: parent.id })
        if (rebuilt.data.filter((message) => message.type === "synthetic").length !== notifications)
          return yield* Effect.fail(new Error("Location rebuild duplicated notification"))
      }
      if (tui.recording)
        yield* tui.recording.mark(
          `${label}: ${resumed ? "completion resumes parent" : "child finished; parent never resumed"}`,
        )
      yield* Effect.sleep("2 seconds")
      console.log("screenshot", yield* ui.screenshot("completion"))
      if (tui.recording) console.log("video", yield* tui.recording.finish())
      if (resumed !== (label === "AFTER" || !evict))
        return yield* Effect.fail(new Error("Unexpected completion delivery"))
    }),
)

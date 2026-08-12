import { defineScript, Llm } from "../../../src/index.js"
import { Deferred, Effect, Schedule, Stream } from "effect"

const shellCallID = "call_multi_shell"
const questionCallID = "call_multi_question"
const readCallID = "call_multi_read"
const globCallID = "call_multi_glob"
const question = "Which runtime should the multi-tool probe use?"

export default defineScript({
  project: {
    files: {
      "fixture.txt": "multi-tool fixture\n",
    },
  },
  config: {
    autoupdate: false,
    permissions: [
      { action: "*", resource: "*", effect: "ask" },
      { action: "shell", resource: "*", effect: "allow" },
    ],
  },
  tools: ["shell"],
  run: ({ ui, llm, opencode, artifacts, tools }) =>
    Effect.scoped(Effect.gen(function* () {
      const shells = yield* tools.control("shell")
      const executionInterrupted = yield* Deferred.make<void>()
      const toolSettlements: Array<string> = []

      yield* opencode.event.subscribe().pipe(
        Stream.runForEach((event) => {
          if (event.type === "session.tool.success" || event.type === "session.tool.failed")
            toolSettlements.push(`${event.type}:${event.data.id}`)
          if (event.type === "session.execution.interrupted")
            return Deferred.succeed(executionInterrupted, undefined).pipe(Effect.asVoid)
          return Effect.void
        }),
        Effect.forkScoped,
      )

      yield* llm.queue(
        Llm.toolCall({
          index: 0,
          id: shellCallID,
          name: "shell",
          input: { command: "hold multi-tool shell" },
        }),
        Llm.toolCall({
          index: 1,
          id: questionCallID,
          name: "question",
          input: {
            questions: [
              {
                question,
                header: "Runtime",
                options: [
                  { label: "Bun", description: "Use Bun for the probe." },
                  { label: "Node", description: "Use Node for the probe." },
                ],
                multiple: false,
              },
            ],
          },
        }),
        Llm.toolCall({
          index: 2,
          id: readCallID,
          name: "read",
          input: { path: "fixture.txt" },
        }),
        Llm.toolCall({
          index: 3,
          id: globCallID,
          name: "glob",
          input: { pattern: "**/*.txt", path: ".", limit: 100 },
        }),
        Llm.finish("tool-calls"),
      )
      yield* llm.queue(Llm.text("multi-tool-interleaving-complete"))

      yield* ui.submit("Run a shell, ask a question, and read the fixture concurrently.")
      const shell = yield* shells.take(shellCallID)
      yield* shell.progress("multi-tool shell remains active\n")
      const sessionID = yield* poll(
        opencode.session.list({ limit: 1, order: "desc" }).pipe(
          Effect.map((sessions) => sessions.data[0]?.id),
        ),
        "current session",
      )
      const permissions = yield* poll(
        opencode.permission.list({ sessionID }).pipe(
          Effect.map((items) => {
            const questionPermission = items.find(
              (item) => item.source?.type === "tool" && item.source.id === questionCallID,
            )
            const readPermission = items.find(
              (item) => item.source?.type === "tool" && item.source.id === readCallID,
            )
            const globPermission = items.find(
              (item) => item.source?.type === "tool" && item.source.id === globCallID,
            )
            return questionPermission && readPermission && globPermission
              ? { question: questionPermission, read: readPermission, glob: globPermission }
              : undefined
          }),
        ),
        "question, read, and glob permissions",
      )

      yield* opencode.permission.reply({
        sessionID,
        requestID: permissions.question.id,
        reply: "once",
      })
      const form = yield* poll(
        Effect.all({
          forms: opencode.form.list({ sessionID }),
          permissions: opencode.permission.list({ sessionID }),
        }).pipe(
          Effect.map(({ forms, permissions: current }) =>
            forms[0] &&
            current.some((item) => item.id === permissions.read.id) &&
            current.some((item) => item.id === permissions.glob.id)
              ? forms[0]
              : undefined,
          ),
        ),
        "question form behind the read and glob permissions",
      )
      yield* saveFrame(artifacts, "permission-over-form", yield* ui.capture())
      yield* ui.screenshot("permission-over-form")
      yield* ui.waitFor("Permission required", { timeout: 10_000 })

      yield* opencode.permission.reply({
        sessionID,
        requestID: permissions.glob.id,
        reply: "once",
      })
      yield* poll(
        opencode.message.list({ sessionID, limit: 20, order: "desc" }).pipe(
          Effect.map((messages) => {
            const glob = messages.data
              .flatMap((message) => message.type === "assistant" ? message.content : [])
              .find((part) => part.type === "tool" && part.id === globCallID)
            return glob?.type === "tool" && glob.state.status === "completed"
              ? glob
              : undefined
          }),
        ),
        "glob completion while read permission remains",
      )
      const remaining = yield* opencode.permission.list({ sessionID })
      if (!remaining.some((item) => item.id === permissions.read.id))
        return yield* Effect.fail(new Error("read permission disappeared before rejection"))

      yield* opencode.permission.reply({
        sessionID,
        requestID: permissions.read.id,
        reply: "reject",
      })
      yield* ui.waitFor(question, { timeout: 10_000 })
      yield* saveFrame(artifacts, "form-with-running-shell", yield* ui.capture())
      yield* ui.screenshot("form-with-running-shell")

      yield* ui.enter()
      yield* poll(
        opencode.form.state({ sessionID, formID: form.id }).pipe(
          Effect.map((state) => state.status === "answered" ? state : undefined),
        ),
        "answered question form",
      )

      yield* shell.succeed({ output: "multi-tool shell completed\n", exit: 0 })
      yield* Deferred.await(executionInterrupted)
      yield* ui.submit("Recover after the rejected concurrent tool.")
      yield* ui.waitFor("multi-tool-interleaving-complete", { timeout: 15_000 })
      const messages = yield* opencode.message.list({ sessionID, limit: 20, order: "desc" })
      const toolParts = messages.data.flatMap((message) =>
        message.type === "assistant"
          ? message.content.filter((part) => part.type === "tool")
          : [],
      )
      const statuses = new Map(toolParts.map((tool) => [tool.id, tool.state.status]))
      if (
        statuses.get(shellCallID) !== "completed" ||
        statuses.get(questionCallID) !== "completed" ||
        statuses.get(globCallID) !== "completed" ||
        statuses.get(readCallID) !== "error"
      )
        return yield* Effect.fail(
          new Error(`unexpected final tool states: ${JSON.stringify(Object.fromEntries(statuses))}`),
        )
      const expected = [
        `session.tool.success:${globCallID}`,
        `session.tool.success:${questionCallID}`,
        `session.tool.success:${shellCallID}`,
        `session.tool.failed:${readCallID}`,
      ]
      const relevant = toolSettlements.filter((item) => expected.includes(item))
      if (relevant.join("\n") !== expected.join("\n"))
        return yield* Effect.fail(
          new Error(`unexpected tool settlement order: ${JSON.stringify(relevant)}`),
        )
      return undefined
    })),
})

function poll<A, E, R>(effect: Effect.Effect<A | undefined, E, R>, description: string) {
  return Effect.repeat(effect, {
    until: (value): value is A => value !== undefined,
    schedule: Schedule.spaced(50),
  }).pipe(
    Effect.timeoutOrElse({
      duration: 10_000,
      orElse: () => Effect.fail(new Error(`timed out waiting for ${description}`)),
    }),
  )
}

function saveFrame(artifacts: string, name: string, frame: unknown) {
  return Effect.tryPromise(() =>
    Bun.write(`${artifacts}/${name}.frame.json`, JSON.stringify(frame, null, 2)),
  ).pipe(Effect.asVoid)
}

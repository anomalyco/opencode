import { Cause, Effect, Exit, Option } from "effect"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import { AppProcess } from "@opencode-ai/core/process"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../daemon"
import { createTimelineHost, type TimelineHost } from "../../../ui/timeline"

const integrationID = "opencode"
const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.console.commands.login,
  Effect.fn("cli.console.login")(function* (input) {
    const timeline = yield* Effect.acquireRelease(
      Effect.promise(() => createTimelineHost()),
      (value) => request(() => value.close()).pipe(Effect.ignore),
    )
    const exit = yield* login(timeline, Option.getOrUndefined(input.url)).pipe(
      Effect.raceFirst(AppProcess.waitForAbort(timeline.signal)),
      Effect.exit,
    )
    if (Exit.isSuccess(exit)) return

    const cancelled = timeline.signal.aborted
    yield* request(() => timeline.failure(cancelled ? "Authorization cancelled" : errorMessage(exit.cause))).pipe(
      Effect.ignore,
    )
    process.exitCode = cancelled ? 130 : 1
  }),
)

const login = Effect.fn("cli.console.login.run")(function* (timeline: TimelineHost, server?: string) {
  yield* request(() => timeline.intro("Log in"))
  yield* request(() => timeline.pending("Connecting to OpenCode..."))

  const transport = yield* Daemon.transport({ mode: "shared" })
  const client = OpenCode.make({ baseUrl: transport.url, headers: transport.headers })
  const found = yield* request((signal) => client.integration.get({ integrationID, location }, { signal }))
  const integration = yield* required(found.data, "OpenCode Console integration is unavailable")
  const method = yield* required(
    integration.methods.find((candidate) => candidate.type === "oauth"),
    "OpenCode Console login is unavailable",
  )

  yield* request(() => timeline.pending("Starting authorization..."))
  const started = yield* request((signal) =>
    client.integration.connect.oauth(
      {
        integrationID,
        methodID: method.id,
        inputs: server ? { server } : {},
        location,
      },
      { signal },
    ),
  )
  const attempt = started.data
  yield* Effect.addFinalizer(() =>
    request(() =>
      client.integration.attempt.cancel(
        { attemptID: attempt.attemptID, location },
        { signal: AbortSignal.timeout(5_000) },
      ),
    ).pipe(Effect.ignore),
  )
  if (attempt.mode !== "auto") yield* Effect.fail(new Error("OpenCode Console requires a device login"))

  yield* request(() => timeline.item(`Go to: ${attempt.url}`))
  yield* request(() => timeline.item(attempt.instructions))
  yield* request(async () => {
    const { default: open } = await import("open")
    await open(attempt.url)
  }).pipe(Effect.ignore)
  yield* request(() => timeline.pending("Waiting for authorization..."))

  const status = yield* waitForConsoleLogin(client, attempt.attemptID)
  if (status.status === "failed") yield* Effect.fail(new Error(status.message))
  if (status.status === "expired") yield* Effect.fail(new Error("Device code expired"))

  yield* request(() => timeline.success("Connected to OpenCode Console"))
  yield* request(() => timeline.outro("Done"))
})

const waitForConsoleLogin = Effect.fn("cli.console.login.wait")(function* (
  client: OpenCodeClient,
  attemptID: string,
) {
  while (true) {
    const response = yield* request((signal) =>
      client.integration.attempt.status({ attemptID, location }, { signal }),
    )
    if (response.data.status !== "pending") return response.data
    yield* Effect.sleep(500)
  }
})

function request<A>(task: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({
    try: task,
    catch: (cause) => cause,
  })
}

function required<A>(value: A | null | undefined, message: string) {
  return value === null || value === undefined ? Effect.fail(new Error(message)) : Effect.succeed(value)
}

function errorMessage(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

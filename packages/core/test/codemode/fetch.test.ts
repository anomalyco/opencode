import { afterAll, beforeAll, expect, test } from "bun:test"
import { CodeMode, Tool } from "@opencode/codemode"
import { CodeModeExecution } from "@opencode/core/codemode/execution"
import { CodeModeFetch } from "@opencode/core/codemode/fetch"
import { Permission } from "@opencode/core/permission"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { CallID } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { permissionService } from "../lib/permission"

// A response the program holds is saved through the fetch extension's snapshot hooks.

const context = {
  sessionID: Session.ID.make("ses_fetch"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_fetch"),
  id: CallID.make("call_fetch"),
  progress: () => Effect.void,
}

let server: ReturnType<typeof Bun.serve>
let release = Promise.withResolvers<void>()
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname === "/slow") await release.promise
      return new Response(`{"page":1}`, { status: 201, headers: { "x-id": "7" } })
    },
  })
})
afterAll(() => server.stop(true))

// A durable tool whose work never ends on its own, so a run can suspend while it runs.
let begun = Promise.withResolvers<void>()
const job = Tool.make({
  description: "Runs a job",
  input: Schema.Struct({}),
  output: Schema.Number,
  durable: {
    start: () => Effect.sync(() => begun.resolve()).pipe(Effect.as("job")),
    attach: () => Effect.never,
    cancel: () => Effect.void,
  },
})
const runtime = CodeMode.make({ tools: { job }, extensions: [CodeModeFetch.extension] })
const services = <A, E>(effect: Effect.Effect<A, E, CodeModeExecution.Service | Permission.Service>) =>
  effect.pipe(
    Effect.provideService(CodeModeExecution.Service, context),
    Effect.provideService(Permission.Service, permissionService({ assert: () => Effect.void })),
  )

test("a response the program holds survives a suspend and a resume from bytes", async () => {
  begun = Promise.withResolvers<void>()
  const code = `
    const res = await fetch("${server.url.origin}/page")
    const text = res.text
    await tools.job({})
    return [res.status, res.statusText, res.ok, res.redirected, res.url, res.headers.get("x-id"), res.headers.has("x-id"),
      await text(), (await res.json()).page, (await res.bytes()).length, Object.keys(res)]`
  const suspended = await Effect.runPromise(
    services(
      Effect.scoped(
        Effect.gen(function* () {
          const execution = yield* runtime.execute(code, undefined, { runId: "f" })
          yield* Effect.promise(() => begun.promise)
          yield* Effect.sleep(1)
          return yield* execution.suspend
        }),
      ),
    ),
  )
  if (suspended.ok !== "suspended") throw new Error(JSON.stringify(suspended))
  const resumed = await Effect.runPromise(
    services(
      Effect.scoped(
        Effect.flatMap(
          runtime.resume(CodeMode.toBytes(suspended.state), { [suspended.pending[0]!.key]: { ok: true, value: 1 } }),
          (execution) => execution.result,
        ),
      ),
    ),
  )
  expect(resumed).toEqual({
    ok: true,
    value: [
      201,
      "Created",
      true,
      false,
      `${server.url.origin}/page`,
      "7",
      true,
      `{"page":1}`,
      1,
      10,
      ["url", "status", "statusText", "ok", "redirected", "headers", "text", "json", "bytes"],
    ],
    toolCalls: [{ name: "job" }],
  })
})

test("a fetch in flight blocks a suspend", async () => {
  release = Promise.withResolvers<void>()
  const error = await Effect.runPromise(
    services(
      Effect.scoped(
        Effect.gen(function* () {
          const execution = yield* runtime.execute(
            `return (await fetch("${server.url.origin}/slow")).status`,
            undefined,
            {
              runId: "g",
            },
          )
          yield* Effect.sleep(20)
          const refused = yield* Effect.flip(execution.suspend)
          release.resolve()
          expect(yield* execution.result).toMatchObject({ ok: true, value: 201 })
          return refused
        }),
      ),
    ),
  )
  expect(error.running).toEqual([{ key: "g:0", path: "fetch" }])
})

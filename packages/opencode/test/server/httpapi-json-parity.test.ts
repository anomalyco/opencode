import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/experimental"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/session"
import { MessageID, PartID } from "../../src/session/schema"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function app(experimental: boolean) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = experimental
  return InstanceRoutes(websocket)
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
}

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

async function seedSessions(directory: string) {
  return await Instance.provide({
    directory,
    fn: () =>
      runSession(
        Effect.gen(function* () {
          const svc = yield* Session.Service
          const parent = yield* svc.create({ title: "parent" })
          yield* svc.create({ title: "child", parentID: parent.id })
          const message = yield* svc.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: parent.id,
            agent: "build",
            model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
            time: { created: Date.now() },
          })
          yield* svc.updatePart({
            id: PartID.ascending(),
            sessionID: parent.id,
            messageID: message.id,
            type: "text",
            text: "hello",
          })
          return { parent, message }
        }),
      ),
  })
}

async function readJson(
  label: string,
  app: ReturnType<typeof InstanceRoutes>,
  directory: string,
  path: string,
  headers: HeadersInit,
) {
  const response = await Instance.provide({
    directory,
    fn: () => app.request(path, { headers }),
  })
  if (response.status !== 200) throw new Error(`${label} returned ${response.status}: ${await response.text()}`)
  return await response.json()
}

async function expectJsonParity(input: {
  label: string
  legacy: ReturnType<typeof InstanceRoutes>
  httpapi: ReturnType<typeof InstanceRoutes>
  directory: string
  path: string
  headers: HeadersInit
}) {
  const legacy = await readJson(input.label, input.legacy, input.directory, input.path, input.headers)
  const httpapi = await readJson(input.label, input.httpapi, input.directory, input.path, input.headers)
  expect({ label: input.label, body: httpapi }).toEqual({ label: input.label, body: legacy })
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("HttpApi JSON parity", () => {
  test("matches legacy JSON shape for session read endpoints", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    const seeded = await seedSessions(tmp.path)
    const legacy = app(false)
    const httpapi = app(true)

    await [
      { label: "session.list roots", path: `${SessionPaths.list}?roots=true`, headers },
      { label: "session.list all", path: SessionPaths.list, headers },
      { label: "session.get", path: pathFor(SessionPaths.get, { sessionID: seeded.parent.id }), headers },
      { label: "session.children", path: pathFor(SessionPaths.children, { sessionID: seeded.parent.id }), headers },
      { label: "session.messages", path: pathFor(SessionPaths.messages, { sessionID: seeded.parent.id }), headers },
      {
        label: "session.message",
        path: pathFor(SessionPaths.message, { sessionID: seeded.parent.id, messageID: seeded.message.id }),
        headers,
      },
      {
        label: "experimental.session",
        path: `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, limit: "10" })}`,
        headers,
      },
    ].reduce(
      (promise, input) => promise.then(() => expectJsonParity({ ...input, legacy, httpapi, directory: tmp.path })),
      Promise.resolve(),
    )
  })
})

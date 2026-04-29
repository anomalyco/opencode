import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/experimental"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/session"
import { MessageID, PartID } from "../../src/session/schema"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function app(experimental: boolean) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = experimental
  return Server.Default().app
}
type TestApp = ReturnType<typeof app>

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

const seedSessions = Effect.gen(function* () {
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
})

function withTmp<A, E, R>(
  options: Parameters<typeof tmpdir>[0],
  fn: (tmp: Awaited<ReturnType<typeof tmpdir>>) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => fn(tmp).pipe(provideInstance(tmp.path))))
}

function readJson(label: string, serverApp: TestApp, path: string, headers: HeadersInit) {
  return Effect.promise(async () => {
    const response = await serverApp.request(path, { headers })
    if (response.status !== 200) throw new Error(`${label} returned ${response.status}: ${await response.text()}`)
    return await response.json()
  })
}

function expectJsonParity(input: {
  label: string
  legacy: TestApp
  httpapi: TestApp
  path: string
  headers: HeadersInit
}) {
  return Effect.gen(function* () {
    const legacy = yield* readJson(input.label, input.legacy, input.path, input.headers)
    const httpapi = yield* readJson(input.label, input.httpapi, input.path, input.headers)
    expect({ label: input.label, body: httpapi }).toEqual({ label: input.label, body: legacy })
    return httpapi
  })
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("HttpApi JSON parity", () => {
  it.live(
    "matches legacy JSON shape for session read endpoints",
    withTmp({ git: true, config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const headers = { "x-opencode-directory": tmp.path }
        const seeded = yield* seedSessions.pipe(Effect.provide(Session.defaultLayer))
        const legacy = app(false)
        const httpapi = app(true)

        const rootsFalse = yield* expectJsonParity({
          label: "session.list roots false",
          legacy,
          httpapi,
          path: `${SessionPaths.list}?roots=false`,
          headers,
        })
        expect((rootsFalse as Session.Info[]).map((session) => session.id)).toContain(seeded.parent.id)
        expect((rootsFalse as Session.Info[]).length).toBe(2)

        const experimentalRootsFalse = yield* expectJsonParity({
          label: "experimental.session roots false",
          legacy,
          httpapi,
          path: `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, limit: "10", roots: "false" })}`,
          headers,
        })
        expect((experimentalRootsFalse as Session.GlobalInfo[]).length).toBe(2)

        const experimentalArchivedFalse = yield* expectJsonParity({
          label: "experimental.session archived false",
          legacy,
          httpapi,
          path: `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, limit: "10", archived: "false" })}`,
          headers,
        })
        expect((experimentalArchivedFalse as Session.GlobalInfo[]).length).toBe(2)

        yield* Effect.forEach(
          [
            { label: "session.list roots", path: `${SessionPaths.list}?roots=true`, headers },
            { label: "session.list all", path: SessionPaths.list, headers },
            { label: "session.get", path: pathFor(SessionPaths.get, { sessionID: seeded.parent.id }), headers },
            {
              label: "session.children",
              path: pathFor(SessionPaths.children, { sessionID: seeded.parent.id }),
              headers,
            },
            {
              label: "session.messages",
              path: pathFor(SessionPaths.messages, { sessionID: seeded.parent.id }),
              headers,
            },
            {
              label: "session.messages empty before",
              path: `${pathFor(SessionPaths.messages, { sessionID: seeded.parent.id })}?before=`,
              headers,
            },
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
          ],
          (input) => expectJsonParity({ ...input, legacy, httpapi }),
          { concurrency: 1 },
        )
      }),
    ),
  )
})

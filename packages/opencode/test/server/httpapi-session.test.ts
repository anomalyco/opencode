import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/session"
import { Session } from "../../src/session"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return InstanceRoutes(websocket)
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
}

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

async function createSession(directory: string, input?: Session.CreateInput) {
  return Instance.provide({
    directory,
    fn: async () => runSession(Session.Service.use((svc) => svc.create(input))),
  })
}

async function createTextMessage(directory: string, sessionID: SessionID, text: string) {
  return Instance.provide({
    directory,
    fn: async () =>
      runSession(
        Effect.gen(function* () {
          const svc = yield* Session.Service
          const info = yield* svc.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID,
            agent: "build",
            model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
            time: { created: Date.now() },
          })
          yield* svc.updatePart({
            id: PartID.ascending(),
            sessionID,
            messageID: info.id,
            type: "text",
            text,
          })
          return info
        }),
      ),
  })
}

async function json<T>(response: Response) {
  if (response.status !== 200) throw new Error(await response.text())
  return (await response.json()) as T
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("session HttpApi", () => {
  test("serves read routes through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    const parent = await createSession(tmp.path, { title: "parent" })
    const child = await createSession(tmp.path, { title: "child", parentID: parent.id })
    const message = await createTextMessage(tmp.path, parent.id, "hello")
    await createTextMessage(tmp.path, parent.id, "world")

    expect((await json<Session.Info[]>(await app().request(`${SessionPaths.list}?roots=true`, { headers }))).map((item) => item.id)).toContain(parent.id)

    expect(await json<Record<string, unknown>>(await app().request(SessionPaths.status, { headers }))).toEqual({})

    expect(await json<Session.Info>(await app().request(pathFor(SessionPaths.get, { sessionID: parent.id }), { headers }))).toMatchObject({ id: parent.id, title: "parent" })

    expect((await json<Session.Info[]>(await app().request(pathFor(SessionPaths.children, { sessionID: parent.id }), { headers }))).map((item) => item.id)).toEqual([child.id])

    expect(await json<unknown[]>(await app().request(pathFor(SessionPaths.todo, { sessionID: parent.id }), { headers }))).toEqual([])

    expect(await json<unknown[]>(await app().request(pathFor(SessionPaths.diff, { sessionID: parent.id }), { headers }))).toEqual([])

    const messages = await app().request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1`, { headers })
    const messagePage = await json<MessageV2.WithParts[]>(messages)
    expect(messages.headers.get("x-next-cursor")).toBeTruthy()
    expect(messagePage[0]?.parts[0]).toMatchObject({ type: "text" })

    expect(await json<MessageV2.WithParts>(await app().request(pathFor(SessionPaths.message, { sessionID: parent.id, messageID: message.id }), { headers }))).toMatchObject({ info: { id: message.id } })
  })
})

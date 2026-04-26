import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { PermissionID } from "../../src/permission/schema"
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
          const part = yield* svc.updatePart({
            id: PartID.ascending(),
            sessionID,
            messageID: info.id,
            type: "text",
            text,
          })
          return { info, part }
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

    expect(
      (await json<Session.Info[]>(await app().request(`${SessionPaths.list}?roots=true`, { headers }))).map(
        (item) => item.id,
      ),
    ).toContain(parent.id)

    expect(await json<Record<string, unknown>>(await app().request(SessionPaths.status, { headers }))).toEqual({})

    expect(
      await json<Session.Info>(await app().request(pathFor(SessionPaths.get, { sessionID: parent.id }), { headers })),
    ).toMatchObject({ id: parent.id, title: "parent" })

    expect(
      (
        await json<Session.Info[]>(
          await app().request(pathFor(SessionPaths.children, { sessionID: parent.id }), { headers }),
        )
      ).map((item) => item.id),
    ).toEqual([child.id])

    expect(
      await json<unknown[]>(await app().request(pathFor(SessionPaths.todo, { sessionID: parent.id }), { headers })),
    ).toEqual([])

    expect(
      await json<unknown[]>(await app().request(pathFor(SessionPaths.diff, { sessionID: parent.id }), { headers })),
    ).toEqual([])

    const messages = await app().request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1`, {
      headers,
    })
    const messagePage = await json<MessageV2.WithParts[]>(messages)
    const nextCursor = messages.headers.get("x-next-cursor")
    expect(nextCursor).toBeTruthy()
    expect(messagePage[0]?.parts[0]).toMatchObject({ type: "text" })

    expect(
      (
        await app().request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?before=${nextCursor}`, {
          headers,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await app().request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1&before=invalid`, {
          headers,
        })
      ).status,
    ).toBe(400)

    expect(
      await json<MessageV2.WithParts>(
        await app().request(pathFor(SessionPaths.message, { sessionID: parent.id, messageID: message.info.id }), {
          headers,
        }),
      ),
    ).toMatchObject({ info: { id: message.info.id } })
  })

  test("serves lifecycle mutation routes through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false, share: "disabled" } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }

    const created = await json<Session.Info>(
      await app().request(SessionPaths.create, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "created" }),
      }),
    )
    expect(created.title).toBe("created")

    const updated = await json<Session.Info>(
      await app().request(pathFor(SessionPaths.update, { sessionID: created.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify({ title: "updated", time: { archived: 1 } }),
      }),
    )
    expect(updated).toMatchObject({ id: created.id, title: "updated", time: { archived: 1 } })

    const forked = await json<Session.Info>(
      await app().request(pathFor(SessionPaths.fork, { sessionID: created.id }), {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      }),
    )
    expect(forked.id).not.toBe(created.id)

    expect(
      await json<boolean>(
        await app().request(pathFor(SessionPaths.abort, { sessionID: created.id }), { method: "POST", headers }),
      ),
    ).toBe(true)

    expect(
      await json<boolean>(
        await app().request(pathFor(SessionPaths.remove, { sessionID: created.id }), { method: "DELETE", headers }),
      ),
    ).toBe(true)
  })

  test("serves message mutation routes through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const session = await createSession(tmp.path, { title: "messages" })
    const first = await createTextMessage(tmp.path, session.id, "first")
    const second = await createTextMessage(tmp.path, session.id, "second")

    const updated = await json<MessageV2.Part>(
      await app().request(
        pathFor(SessionPaths.updatePart, {
          sessionID: session.id,
          messageID: first.info.id,
          partID: first.part.id,
        }),
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ ...first.part, text: "updated" }),
        },
      ),
    )
    expect(updated).toMatchObject({ id: first.part.id, type: "text", text: "updated" })

    expect(
      await json<boolean>(
        await app().request(
          pathFor(SessionPaths.deletePart, {
            sessionID: session.id,
            messageID: first.info.id,
            partID: first.part.id,
          }),
          { method: "DELETE", headers },
        ),
      ),
    ).toBe(true)

    expect(
      await json<boolean>(
        await app().request(pathFor(SessionPaths.deleteMessage, { sessionID: session.id, messageID: second.info.id }), {
          method: "DELETE",
          headers,
        }),
      ),
    ).toBe(true)
  })

  test("serves remaining non-LLM session mutation routes through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const session = await createSession(tmp.path, { title: "remaining" })

    expect(
      await json<Session.Info>(
        await app().request(pathFor(SessionPaths.revert, { sessionID: session.id }), {
          method: "POST",
          headers,
          body: JSON.stringify({ messageID: MessageID.ascending() }),
        }),
      ),
    ).toMatchObject({ id: session.id })

    expect(
      await json<Session.Info>(
        await app().request(pathFor(SessionPaths.unrevert, { sessionID: session.id }), {
          method: "POST",
          headers,
        }),
      ),
    ).toMatchObject({ id: session.id })

    expect(
      await json<boolean>(
        await app().request(
          pathFor(SessionPaths.permissions, {
            sessionID: session.id,
            permissionID: String(PermissionID.ascending()),
          }),
          {
            method: "POST",
            headers,
            body: JSON.stringify({ response: "once" }),
          },
        ),
      ),
    ).toBe(true)
  })
})

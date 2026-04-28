import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { PermissionID } from "../../src/permission/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/session"
import { Session } from "@/session/session"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
}

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

function createSession(directory: string, input?: Session.CreateInput) {
  return Effect.promise(
    async () =>
      await Instance.provide({
        directory,
        fn: () => runSession(Session.Service.use((svc) => svc.create(input))),
      }),
  )
}

function createTextMessage(directory: string, sessionID: SessionID, text: string) {
  return Effect.promise(
    async () =>
      await Instance.provide({
        directory,
        fn: () =>
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
      }),
  )
}

function request(path: string, init?: RequestInit) {
  return Effect.promise(async () => app().request(path, init))
}

function json<T>(response: Response) {
  return Effect.promise(async () => {
    if (response.status !== 200) throw new Error(await response.text())
    return (await response.json()) as T
  })
}

function requestJson<T>(path: string, init?: RequestInit) {
  return request(path, init).pipe(Effect.flatMap(json<T>))
}

function withTmp<A, E, R>(
  options: Parameters<typeof tmpdir>[0],
  fn: (tmp: Awaited<ReturnType<typeof tmpdir>>) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap(fn))
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("session HttpApi", () => {
  it.live(
    "serves read routes through Hono bridge",
    withTmp({ git: true, config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const headers = { "x-opencode-directory": tmp.path }
        const parent = yield* createSession(tmp.path, { title: "parent" })
        const child = yield* createSession(tmp.path, { title: "child", parentID: parent.id })
        const message = yield* createTextMessage(tmp.path, parent.id, "hello")
        yield* createTextMessage(tmp.path, parent.id, "world")

        const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?roots=true`, { headers })
        expect(listed.map((item) => item.id)).toContain(parent.id)
        expect(Object.hasOwn(listed[0]!, "parentID")).toBe(false)

        expect(yield* requestJson<Record<string, unknown>>(SessionPaths.status, { headers })).toEqual({})

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: parent.id }), { headers }),
        ).toMatchObject({ id: parent.id, title: "parent" })

        expect(
          (yield* requestJson<Session.Info[]>(pathFor(SessionPaths.children, { sessionID: parent.id }), {
            headers,
          })).map((item) => item.id),
        ).toEqual([child.id])

        expect(
          yield* requestJson<unknown[]>(pathFor(SessionPaths.todo, { sessionID: parent.id }), { headers }),
        ).toEqual([])

        expect(
          yield* requestJson<unknown[]>(pathFor(SessionPaths.diff, { sessionID: parent.id }), { headers }),
        ).toEqual([])

        const messages = yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1`, {
          headers,
        })
        const messagePage = yield* json<MessageV2.WithParts[]>(messages)
        const nextCursor = messages.headers.get("x-next-cursor")
        expect(nextCursor).toBeTruthy()
        expect(messagePage[0]?.parts[0]).toMatchObject({ type: "text" })

        expect(
          (yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?before=${nextCursor}`, {
            headers,
          })).status,
        ).toBe(400)
        expect(
          (yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1&before=invalid`, {
            headers,
          })).status,
        ).toBe(400)

        expect(
          yield* requestJson<MessageV2.WithParts>(
            pathFor(SessionPaths.message, { sessionID: parent.id, messageID: message.info.id }),
            { headers },
          ),
        ).toMatchObject({ info: { id: message.info.id } })
      }),
    ),
  )

  it.live(
    "serves lifecycle mutation routes through Hono bridge",
    withTmp({ git: true, config: { formatter: false, lsp: false, share: "disabled" } }, (tmp) =>
      Effect.gen(function* () {
        const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }

        const createdEmpty = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
        })
        expect(createdEmpty.id).toBeTruthy()

        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "created" }),
        })
        expect(created.title).toBe("created")

        const updated = yield* requestJson<Session.Info>(pathFor(SessionPaths.update, { sessionID: created.id }), {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: "updated", time: { archived: 1 } }),
        })
        expect(updated).toMatchObject({ id: created.id, title: "updated", time: { archived: 1 } })

        const forked = yield* requestJson<Session.Info>(pathFor(SessionPaths.fork, { sessionID: created.id }), {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        })
        expect(forked.id).not.toBe(created.id)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.abort, { sessionID: created.id }), {
            method: "POST",
            headers,
          }),
        ).toBe(true)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.remove, { sessionID: created.id }), {
            method: "DELETE",
            headers,
          }),
        ).toBe(true)
      }),
    ),
  )

  it.live(
    "serves message mutation routes through Hono bridge",
    withTmp({ git: true, config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
        const session = yield* createSession(tmp.path, { title: "messages" })
        const first = yield* createTextMessage(tmp.path, session.id, "first")
        const second = yield* createTextMessage(tmp.path, session.id, "second")

        const updated = yield* requestJson<MessageV2.Part>(
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
        )
        expect(updated).toMatchObject({ id: first.part.id, type: "text", text: "updated" })

        expect(
          yield* requestJson<boolean>(
            pathFor(SessionPaths.deletePart, {
              sessionID: session.id,
              messageID: first.info.id,
              partID: first.part.id,
            }),
            { method: "DELETE", headers },
          ),
        ).toBe(true)

        expect(
          yield* requestJson<boolean>(
            pathFor(SessionPaths.deleteMessage, { sessionID: session.id, messageID: second.info.id }),
            { method: "DELETE", headers },
          ),
        ).toBe(true)
      }),
    ),
  )

  it.live(
    "serves remaining non-LLM session mutation routes through Hono bridge",
    withTmp({ git: true, config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
        const session = yield* createSession(tmp.path, { title: "remaining" })

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.revert, { sessionID: session.id }), {
            method: "POST",
            headers,
            body: JSON.stringify({ messageID: MessageID.ascending() }),
          }),
        ).toMatchObject({ id: session.id })

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.unrevert, { sessionID: session.id }), {
            method: "POST",
            headers,
          }),
        ).toMatchObject({ id: session.id })

        expect(
          yield* requestJson<boolean>(
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
        ).toBe(true)
      }),
    ),
  )
})

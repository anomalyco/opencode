import { expect, test } from "bun:test"
import {
  ClientError,
  type FileNotFoundError,
  type SessionInfo,
  type SessionNotFoundError,
  type UnauthorizedError,
} from "@opencode/client/promise"
import { Data } from "effect"
import { createSessionMutations } from "./data"
import { createApiForServer } from "./api"

// SAFETY: mutation filtering reads only the session ID.
const session = { id: "ses_test" } as SessionInfo

test("keeps a successful removal applied until its event arrives", async () => {
  const release = Promise.withResolvers<void>()
  const mutation = createSessionMutations(async () => release.promise)

  const request = mutation.remove(session.id)
  expect(mutation.apply([session])).toEqual([])
  release.resolve()
  await request
  expect(mutation.apply([session])).toEqual([])

  mutation.deleted(session.id)
  expect(mutation.apply([session])).toEqual([session])
})

test("rolls back a failed removal", async () => {
  const release = Promise.withResolvers<void>()

  const mutation = createSessionMutations(async () => {
    await release.promise
    throw new Error("offline")
  })

  const request = mutation.remove(session.id)
  expect(mutation.apply([session])).toEqual([])
  release.resolve()
  await expect(request).rejects.toThrow("offline")
  expect(mutation.apply([session])).toEqual([session])
})

const missing = Data.taggedEnum<SessionNotFoundError>().SessionNotFoundError({
  sessionID: session.id,
  message: "Session not found",
})

test.each([
  { name: "the exact missing session", status: 404, body: missing, removed: true },
  { name: "a different missing session", status: 404, body: { ...missing, sessionID: "ses_other" }, removed: false },
  {
    name: "an unrelated 404",
    status: 404,
    body: Data.taggedEnum<FileNotFoundError>().FileNotFoundError({ path: "file", message: "File not found" }),
    removed: false,
  },
  {
    name: "unauthorized",
    status: 401,
    body: Data.taggedEnum<UnauthorizedError>().UnauthorizedError({ message: "Unauthorized" }),
    removed: false,
  },
  { name: "a missing-session body with bad request status", status: 400, body: missing, removed: false },
  { name: "a missing-session body with unauthorized status", status: 401, body: missing, removed: false },
  { name: "forbidden", status: 403, body: missing, removed: false },
  { name: "server failure", status: 500, body: missing, removed: false },
])("settles a removal for $name through the Promise client", async ({ status, body, removed }) => {
  const response = Promise.withResolvers<Response>()
  const sent = Promise.withResolvers<URL>()

  const api = createApiForServer({
    server: { url: "http://server-a.test" },
    fetch: Object.assign(
      async (url: RequestInfo | URL) => {
        sent.resolve(new URL(String(url)))

        return response.promise
      },
      { preconnect() {} },
    ),
  })

  const mutation = createSessionMutations((sessionID) => api.session.remove({ sessionID }))
  const request = mutation.remove(session.id)
  expect(mutation.apply([session])).toEqual([])
  expect((await sent.promise).href).toBe(`http://server-a.test/api/session/${session.id}`)
  response.resolve(Response.json(body, { status }))

  if (removed) await request

  if (!removed) await expect(request).rejects.toBeInstanceOf(Error)
  expect(mutation.apply([session])).toEqual(removed ? [] : [session])
})

test.each([
  { name: "wrapped 404", error: new Error("missing", { cause: { body: missing, status: 404 } }), removed: true },
  { name: "wrapped 401", error: new Error("missing", { cause: { body: missing, status: 401 } }), removed: false },
  { name: "wrapped 500", error: new Error("missing", { cause: { body: missing, status: 500 } }), removed: false },
  { name: "transport failure", error: new ClientError("Transport", { cause: missing }), removed: false },
  { name: "interruption", error: new DOMException("Aborted", "AbortError"), removed: false },
])("settles $name without accepting unrelated failures", async ({ error, removed }) => {
  const mutation = createSessionMutations(async () => {
    throw error
  })

  const request = mutation.remove(session.id)

  if (removed) await request

  if (!removed) await expect(request).rejects.toBe(error)
  expect(mutation.apply([session])).toEqual(removed ? [] : [session])
})

test("repeated missing-session deletions stay applied without affecting another server", async () => {
  const response = Promise.withResolvers<Response>()
  const sent = Promise.withResolvers<void>()

  const api = createApiForServer({
    server: { url: "http://server-a.test" },
    fetch: Object.assign(
      async () => {
        sent.resolve()

        return (await response.promise).clone()
      },
      { preconnect() {} },
    ),
  })

  const origin = createSessionMutations((sessionID) => api.session.remove({ sessionID }))
  const other = createSessionMutations(async () => undefined)
  const request = origin.remove(session.id)
  await sent.promise
  expect(origin.apply([session])).toEqual([])
  expect(other.apply([session])).toEqual([session])
  response.resolve(Response.json(missing, { status: 404 }))
  await request
  await origin.remove(session.id)
  expect(origin.apply([session])).toEqual([])
  expect(other.apply([session])).toEqual([session])
})

test("a repeated deletion failure cannot undo an already missing session", async () => {
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  const pending = [first, second]
  const mutation = createSessionMutations(() => pending.shift()!.promise)
  const missingRequest = mutation.remove(session.id)
  const failedRequest = mutation.remove(session.id)
  first.reject(missing)
  await missingRequest
  second.reject(new Error("offline"))
  await expect(failedRequest).rejects.toThrow("offline")
  expect(mutation.apply([session])).toEqual([])
})

import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createDesktopData, createSessionMutations } from "./data"

const session: SessionInfo = {
  id: "ses_test",
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  location: { directory: "/project" },
}

test("keeps a removed session hidden after its deletion event, for lists cached before it", async () => {
  const release = Promise.withResolvers<void>()
  const mutation = createSessionMutations(async () => release.promise)

  const request = mutation.remove(session.id)
  expect(mutation.apply([session])).toEqual([])
  release.resolve()
  await request
  expect(mutation.apply([session])).toEqual([])

  mutation.deleted(session.id)
  expect(mutation.apply([session])).toEqual([])
})

test("hides a session another client deleted", () => {
  const mutation = createSessionMutations(async () => {})
  mutation.deleted(session.id)
  expect(mutation.apply([session])).toEqual([])
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

test("treats SessionNotFoundError on removal as already deleted", async () => {
  const mutation = createSessionMutations(async () => {
    throw JSON.parse('{"_tag":"SessionNotFoundError","sessionID":"ses_test","message":"Session not found: ses_test"}')
  })

  await expect(mutation.remove(session.id)).resolves.toBeUndefined()
  expect(mutation.apply([session])).toEqual([])
})

test("shows a deleted session again once it is restored", () => {
  const mutation = createSessionMutations(async () => {})
  mutation.deleted(session.id)
  expect(mutation.apply([session])).toEqual([])

  mutation.restore(session.id)
  expect(mutation.apply([session])).toEqual([session])
})

test("lists a session again when it is re-imported after being deleted in the same window", async () => {
  await createRoot(async (dispose) => {
    const listeners = new Map<string, Set<(event: unknown) => void>>()
    const [store, setStore] = createStore<{ sessions: SessionInfo[] }>({ sessions: [session] })
    const emit = (type: string, data: unknown) =>
      listeners.get(type)?.forEach((listener) => listener({ type, created: 0, data }))
    // SAFETY: the desktop wrapper only reads `on`, `session.list`, `session.remember` and `session.forget`.
    const data = createDesktopData({
      data: {
        on(type: string, listener: (event: unknown) => void) {
          listeners.set(type, (listeners.get(type) ?? new Set()).add(listener))
          return () => listeners.get(type)?.delete(listener)
        },
        session: {
          list: () => store.sessions,
          remember: (info: SessionInfo) =>
            setStore("sessions", (all) => [...all.filter((x) => x.id !== info.id), info]),
          forget: (id: string) => setStore("sessions", (all) => all.filter((x) => x.id !== id)),
        },
      } as unknown as Parameters<typeof createDesktopData>[0]["data"],
      remove: async () => {},
    })

    await data.session.remove(session.id)
    emit("session.deleted", { sessionID: session.id })
    expect(data.session.list()).toEqual([])

    data.session.remember(session)
    expect(data.session.list()).toEqual([session])
    expect(data.session.apply([session])).toEqual([session])

    await data.session.remove(session.id)
    emit("session.deleted", { sessionID: session.id })
    emit("session.created", { sessionID: session.id, info: session })
    data.session.remember(session)
    expect(data.session.apply([session])).toEqual([session])
    dispose()
  })
})

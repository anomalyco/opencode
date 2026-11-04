import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionResolutionState } from "@/session/resolution-machine"
import { createSessionResolution } from "@/session/session-resolution"

type Session = { id: string; directory: string }

const sessionOf = (id: string): Session => ({ id, directory: `/dir/${id}` })

function resolved<Scope>(state: SessionResolutionState<Session, Scope>) {
  return state.status === "ready" ? state.session : undefined
}

// Fake session store: get reads a reactive cache, sync returns a
// deferred promise the test settles or fails explicitly.
function createFixture(initial: Record<string, Session> = {}) {
  const [cache, setCache] = createSignal(initial)
  const deferred = new Map<string, PromiseWithResolvers<void>>()
  const resolves: string[] = []
  const messageSyncs: string[] = []
  const signals: AbortSignal[] = []
  const messages = { syncs: messageSyncs, signals, ...Promise.withResolvers<void>() }

  return {
    resolves,
    messages,
    sessions: {
      get: (id: string) => cache()[id],
      sync: (id: string) => {
        resolves.push(id)
        const entry = deferred.get(id) ?? Promise.withResolvers<void>()
        deferred.set(id, entry)

        return entry.promise
      },
      hydrate: (id: string, options?: { signal?: AbortSignal }) => {
        messages.syncs.push(id)

        if (options?.signal) messages.signals.push(options.signal)

        return messages.promise
      },
    },
    settle(id: string, directory = `/dir/${id}`) {
      setCache({ ...cache(), [id]: { id, directory } })
      deferred.get(id)?.resolve()
      deferred.delete(id)
    },
    fail(id: string, error: Error) {
      deferred.get(id)?.reject(error)
      // The real store does not cache failures: the inflight request entry is
      // dropped on rejection so the next resolve retries.
      deferred.delete(id)
    },
    remove(id: string) {
      const next = { ...cache() }
      delete next[id]
      setCache(next)
    },
  }
}

// Two microtask ticks: one for the resolve promise handed back by the fixture,
// one for the .then/.catch chain inside createSessionResolution.
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

test("refreshes the current session on reconnect while keeping cached content visible", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture({ ses_a: sessionOf("ses_a") })
    const [connection, setConnection] = createStore({ connected: false })

    const current = createSessionResolution(
      () => "ses_a",
      () => fixture.sessions,
      { connected: () => connection.connected },
    )

    expect(resolved(current())).toEqual(sessionOf("ses_a"))
    expect(fixture.resolves).toEqual([])
    await flush()
    setConnection("connected", true)
    expect(fixture.resolves).toEqual(["ses_a"])
    fixture.settle("ses_a")
    await flush()

    setConnection("connected", false)
    expect(resolved(current())).toEqual(sessionOf("ses_a"))
    expect(fixture.resolves).toEqual(["ses_a"])
    setConnection("connected", true)
    expect(fixture.resolves).toEqual(["ses_a", "ses_a"])
    expect(resolved(current())).toEqual(sessionOf("ses_a"))
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_a"])
    // Each reconnect's load replaces the previous one, which may still be retrying.
    expect(fixture.messages.signals.map((signal) => signal.aborted)).toEqual([true, false])
    fixture.settle("ses_a", "/worktrees/moved")
    await flush()
    expect(resolved(current())?.directory).toBe("/worktrees/moved")
    dispose()
  })
})

test("starts metadata and messages in parallel once the route has a session ID", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal<string>()
    const current = createSessionResolution(id, () => fixture.sessions)

    expect(current().status).toBe("idle")
    await flush()
    expect(fixture.resolves).toEqual([])
    expect(fixture.messages.syncs).toEqual([])

    setId("ses_a")
    expect(fixture.resolves).toEqual(["ses_a"])
    expect(fixture.messages.syncs).toEqual(["ses_a"])

    fixture.messages.resolve()
    await flush()
    expect(current().status).toBe("resolving")

    fixture.settle("ses_a")
    await flush()
    expect(resolved(current())?.id).toBe("ses_a")

    dispose()
  })
})

test("message failure does not fail metadata resolution", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()

    const current = createSessionResolution(
      () => "ses_a",
      () => fixture.sessions,
    )

    await flush()
    fixture.messages.reject(new Error("message sync failed"))
    await flush()
    expect(current().status).toBe("resolving")

    fixture.settle("ses_a")
    await flush()
    expect(resolved(current())?.id).toBe("ses_a")

    dispose()
  })
})

// Session tabs on the same server share one route instance, so navigating to
// another session changes the id in place; resolution must follow it instead
// of reporting the new session as missing.
test("re-resolves when navigating to an uncached session without a remount", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture({ ses_a: sessionOf("ses_a") })
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    expect(resolved(current())?.id).toBe("ses_a")
    expect(fixture.resolves).toEqual([])
    expect(fixture.messages.syncs).toEqual(["ses_a"])

    setId("ses_b")
    expect(current().status).toBe("resolving")
    expect(fixture.resolves).toEqual(["ses_b"])
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_b"])
    expect(fixture.messages.signals.map((signal) => signal.aborted)).toEqual([true, false])

    fixture.settle("ses_b")
    await flush()
    expect(resolved(current())?.id).toBe("ses_b")

    dispose()
  })
})

// A late failure from a session the user already navigated away from must not
// poison the currently viewed session.
test("ignores a stale resolution failure after the target changes", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    setId("ses_b")
    fixture.fail("ses_a", new Error("resolve failed"))
    await flush()

    expect(current().status).toBe("resolving")
    fixture.settle("ses_b")
    await flush()
    expect(resolved(current())?.id).toBe("ses_b")

    dispose()
  })
})

test("returning to a pruned session re-resolves instead of reporting not found", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    fixture.settle("ses_a")
    await flush()

    setId("ses_b")
    fixture.settle("ses_b")
    await flush()

    fixture.remove("ses_a")
    setId("ses_a")
    expect(current().status).toBe("resolving")
    expect(fixture.resolves).toEqual(["ses_a", "ses_b", "ses_a"])
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_b", "ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(resolved(current())?.id).toBe("ses_a")

    dispose()
  })
})

// A resolution that fails while its session is unfocused must not leave a
// poisoned status behind: revisiting that session retries cleanly.
test("revisiting a session whose resolution failed while unfocused retries cleanly", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    setId("ses_b")
    fixture.fail("ses_a", new Error("resolve failed"))
    await flush()

    setId("ses_a")
    expect(current().status).toBe("resolving")
    expect(fixture.resolves).toEqual(["ses_a", "ses_b", "ses_a"])
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_b", "ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(resolved(current())?.id).toBe("ses_a")

    dispose()
  })
})

// The session accessor is reactive: replacing the data store (for example after
// the server context is rebuilt) must gate out the old store's results and
// re-resolve against the new one instead of fabricating a not-found.
test("re-resolves against a replaced session store", async () => {
  await createRoot(async (dispose) => {
    const first = createFixture()
    const second = createFixture()
    const [store, setStore] = createSignal(first.sessions)
    const current = createSessionResolution(() => "ses_a", store)

    await flush()
    first.settle("ses_a")
    await flush()
    expect(resolved(current())?.id).toBe("ses_a")

    setStore(second.sessions)
    expect(current().status).toBe("resolving")
    await flush()
    expect(second.resolves).toEqual(["ses_a"])
    expect(first.messages.syncs).toEqual(["ses_a"])
    expect(second.messages.syncs).toEqual(["ses_a"])

    second.settle("ses_a")
    await flush()
    expect(resolved(current())?.id).toBe("ses_a")

    dispose()
  })
})

// The viewed session is pinned in the cache, so disappearing after it resolved
// means it was deleted. The next tab on the same route still resolves.
test("reports a deleted session as not found until the route targets another session", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    fixture.settle("ses_a")
    await flush()
    expect(resolved(current())?.id).toBe("ses_a")

    fixture.remove("ses_a")
    expect(current().status).toBe("not-found")

    setId("ses_b")
    expect(current().status).toBe("resolving")
    fixture.settle("ses_b")
    await flush()
    expect(resolved(current())?.id).toBe("ses_b")

    dispose()
  })
})

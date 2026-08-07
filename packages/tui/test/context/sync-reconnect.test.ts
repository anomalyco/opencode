import { expect, test } from "bun:test"
import { createReconnectCoordinator, type ReconnectFailure } from "../../src/context/sync-reconnect"

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) throw new Error("deferred promise is not initialized")
      resolvePromise(value)
    },
  }
}

test("ignores epoch one, snapshots before bootstrap, and coalesces a storm into one trailing pass", async () => {
  const firstBootstrap = deferred<void>()
  const bootstraps: number[] = []
  const snapshots: string[][] = []
  const forced: string[] = []
  const failures: ReconnectFailure[] = []
  const sessionError = new Error("inflight failed")
  let targets = ["ses_full", "ses_inflight"]
  const coordinator = createReconnectCoordinator({
    bootstrap: async () => {
      bootstraps.push(bootstraps.length + 1)
      if (bootstraps.length === 1) await firstBootstrap.promise
    },
    targets: () => {
      snapshots.push([...targets])
      return targets
    },
    exists: () => true,
    forceSync: async (sessionID) => {
      forced.push(sessionID)
      if (sessionID === "ses_inflight" && forced.filter((item) => item === sessionID).length === 1) throw sessionError
    },
    onError: (failure) => failures.push(failure),
  })

  await coordinator.connected()
  expect(bootstraps).toEqual([])

  const active = coordinator.connected()
  await Promise.resolve()
  expect(snapshots).toEqual([["ses_full", "ses_inflight"]])

  targets = ["ses_new"]
  const trailing = coordinator.connected()
  void coordinator.connected()
  firstBootstrap.resolve()
  await active
  await trailing

  expect(bootstraps).toEqual([1, 2])
  expect(snapshots).toEqual([["ses_full", "ses_inflight"], ["ses_new"]])
  expect(forced).toEqual(["ses_full", "ses_inflight", "ses_new", "ses_inflight"])
  expect(failures).toEqual([{ boundary: "session", sessionID: "ses_inflight", error: sessionError }])
})

test("filters deleted targets only after bootstrap succeeds and keeps targets when bootstrap fails", async () => {
  const forced: string[] = []
  const failures: ReconnectFailure[] = []
  const bootstrapError = new Error("bootstrap failed")
  let bootstrapFails = false
  const coordinator = createReconnectCoordinator({
    bootstrap: async () => {
      if (bootstrapFails) throw bootstrapError
    },
    targets: () => ["ses_present", "ses_deleted"],
    exists: (sessionID) => sessionID === "ses_present",
    forceSync: async (sessionID) => {
      forced.push(sessionID)
    },
    onError: (failure) => failures.push(failure),
  })

  await coordinator.connected()
  await coordinator.connected()
  bootstrapFails = true
  await coordinator.connected()

  expect(forced).toEqual(["ses_present", "ses_present", "ses_deleted"])
  expect(failures).toEqual([{ boundary: "bootstrap", error: bootstrapError }])
})

test("disposal during an active pass cancels queued and future work", async () => {
  const blocked = deferred<void>()
  const forced: string[] = []
  const failures: ReconnectFailure[] = []
  const coordinator = createReconnectCoordinator({
    bootstrap: () => blocked.promise,
    targets: () => ["ses_loaded"],
    exists: () => true,
    forceSync: async (sessionID) => {
      forced.push(sessionID)
    },
    onError: (failure) => failures.push(failure),
  })

  await coordinator.connected()
  const active = coordinator.connected()
  await Promise.resolve()
  void coordinator.connected()
  coordinator.dispose()
  blocked.resolve()
  await active
  await coordinator.connected()

  expect(forced).toEqual([])
  expect(failures).toEqual([])
})

test("an epoch arriving during the trailing pass schedules another pass", async () => {
  const releases = [deferred<void>(), deferred<void>()]
  const entered = [deferred<void>(), deferred<void>(), deferred<void>()]
  let bootstraps = 0
  const coordinator = createReconnectCoordinator({
    bootstrap: async () => {
      const index = bootstraps++
      entered[index].resolve()
      await releases[index]?.promise
    },
    targets: () => [],
    exists: () => true,
    forceSync: async () => {},
    onError: () => {},
  })

  await coordinator.connected()
  const active = coordinator.connected()
  await entered[0].promise
  void coordinator.connected()
  releases[0].resolve()
  await entered[1].promise
  void coordinator.connected()
  releases[1].resolve()
  await active

  expect(bootstraps).toBe(3)
})

test("an epoch arriving during ownership release waits for its reconciliation pass", async () => {
  const handoffReady = deferred<void>()
  let bootstraps = 0
  let running = 0
  let maxRunning = 0
  let handoff: Promise<void> | undefined
  let coordinator: ReturnType<typeof createReconnectCoordinator>
  coordinator = createReconnectCoordinator({
    bootstrap: async () => {
      bootstraps += 1
      running += 1
      maxRunning = Math.max(maxRunning, running)
      if (bootstraps === 1) {
        queueMicrotask(() =>
          queueMicrotask(() =>
            queueMicrotask(() =>
              queueMicrotask(() => {
                handoff = coordinator.connected()
                handoffReady.resolve()
              }),
            ),
          ),
        )
      }
      running -= 1
    },
    targets: () => [],
    exists: () => true,
    forceSync: async () => {},
    onError: () => {},
  })

  await coordinator.connected()
  const active = coordinator.connected()
  await handoffReady.promise
  if (!handoff) throw new Error("ownership handoff promise is not initialized")
  await handoff
  const afterHandoff = bootstraps
  await coordinator.connected()
  await active

  expect({ afterHandoff, afterNextEpoch: bootstraps, maxRunning }).toEqual({
    afterHandoff: 2,
    afterNextEpoch: 3,
    maxRunning: 1,
  })
})

test("disposal suppresses failures settled after a session pass", async () => {
  const forced = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const failures: ReconnectFailure[] = []
  const coordinator = createReconnectCoordinator({
    bootstrap: async () => {},
    targets: () => ["ses_loaded"],
    exists: () => true,
    forceSync: () => {
      entered.resolve()
      return forced.promise
    },
    onError: (failure) => failures.push(failure),
  })

  await coordinator.connected()
  const active = coordinator.connected()
  await entered.promise
  coordinator.dispose()
  forced.reject(new Error("settled after disposal"))
  await active

  expect(failures).toEqual([])
})

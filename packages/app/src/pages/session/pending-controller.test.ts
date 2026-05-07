import { describe, expect, test } from "bun:test"
import type { SessionPending } from "@opencode-ai/sdk/v2/client"
import {
  createPendingSnapshotCoordinator,
  derivePendingControllerState,
  getEditCancelBlockReason,
  getEditSaveBlockReason,
  getForegroundSubmitBlockReason,
  getHistoryMutationBlockReason,
  getPendingItemActionBlockReason,
  getPendingMoveLaneBlockReason,
  getQueueSubmitBlockReason,
  getResumeBlockReason,
  getStartEditBlockReason,
  getSteerSubmitBlockReason,
  getVisibleEditingItemID,
  resolveFollowupLane,
  shouldClearLocalStopProjection,
} from "./pending-controller"

const pending = (input: Partial<SessionPending> = {}): SessionPending => ({
  paused: false,
  steer: [],
  queue: [],
  ...input,
})

const base = (input: Partial<Parameters<typeof derivePendingControllerState>[0]> = {}) => ({
  existingSession: true,
  runtime: "idle" as const,
  pendingKnowledge: "known" as const,
  pending: pending(),
  localEditID: undefined,
  composerHasDraft: false,
  refreshInFlight: false,
  followupMutationInFlight: false,
  historyMutationInFlight: false,
  stopProjectionActive: false,
  ...input,
})

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe("pending controller", () => {
  test("existing idle session with unknown pending blocks foreground submit", () => {
    expect(getForegroundSubmitBlockReason(base({ pendingKnowledge: "unknown" }))).toBe("pending_unknown")
  })

  test("hydrate resolves empty and enables foreground submit", () => {
    const state = derivePendingControllerState(base())
    expect(state.mode).toBe("idleClear")
    expect(state.canForegroundSubmit).toBe(true)
  })

  test("hydrate resolves queued items and blocks foreground submit", () => {
    expect(
      getForegroundSubmitBlockReason(
        base({
          pending: pending({ queue: [{ id: "q1" } as SessionPending["queue"][number]] }),
        }),
      ),
    ).toBe("blocked_by_pending")
  })

  test("refreshing does not block queue submit", () => {
    expect(
      getQueueSubmitBlockReason(
        base({
          runtime: "busy",
          refreshInFlight: true,
        }),
      ),
    ).toBeUndefined()
  })

  test("busy session with unknown pending does not advertise queue submit", () => {
    const state = derivePendingControllerState(
      base({
        runtime: "busy",
        pendingKnowledge: "unknown",
        preferredFollowupLane: "steer",
      }),
    )
    expect(state.canForegroundSubmit).toBe(false)
    expect(getQueueSubmitBlockReason(base({ runtime: "busy", pendingKnowledge: "unknown" }))).toBe("pending_unknown")
    expect(state.canQueueSubmit).toBe(false)
    expect(state.canSteerSubmit).toBe(false)
    expect(state.primaryFollowupLane).toBeUndefined()
  })

  test("refreshing does not block edit save for an active local edit", () => {
    expect(
      getEditSaveBlockReason(
        base({
          pending: pending({ queue: [{ id: "item-1" } as SessionPending["queue"][number]] }),
          localEditID: "item-1",
          refreshInFlight: true,
        }),
      ),
    ).toBeUndefined()
  })

  test("stale refresh cannot wedge controller into mutating mode", () => {
    const state = derivePendingControllerState(
      base({
        refreshInFlight: true,
      }),
    )
    expect(state.networkAxis).toBe("refreshing")
    expect(state.mode).toBe("idleClear")
  })

  test("history mutation is blocked while editing self", () => {
    expect(
      getHistoryMutationBlockReason(
        base({
          pending: pending({ queue: [{ id: "item-1" } as SessionPending["queue"][number]] }),
          localEditID: "item-1",
        }),
      ),
    ).toBe("editing_in_progress")
  })

  test("pending row actions are blocked while editing self", () => {
    expect(
      getPendingItemActionBlockReason(
        base({
          pending: pending({ queue: [{ id: "item-1" } as SessionPending["queue"][number]] }),
          localEditID: "item-1",
        }),
      ),
    ).toBe("editing_in_progress")
  })

  test("history mutation is blocked while pending followups remain", () => {
    expect(
      getHistoryMutationBlockReason(
        base({
          pending: pending({ queue: [{ id: "item-1" } as SessionPending["queue"][number]] }),
        }),
      ),
    ).toBe("blocked_by_pending")
  })

  test("history mutation is allowed while the scheduler is paused but empty", () => {
    expect(
      getHistoryMutationBlockReason(
        base({
          pending: pending({ paused: true }),
        }),
      ),
    ).toBeUndefined()
  })

  test("stop remains available while editing self during busy runtime", () => {
    const state = derivePendingControllerState(
      base({
        runtime: "busy",
        pending: pending({ queue: [{ id: "item-1" } as SessionPending["queue"][number]] }),
        localEditID: "item-1",
      }),
    )
    expect(state.mode).toBe("editingSelfBusy")
    expect(state.canStop).toBe(true)
  })

  test("busy enables both queue and steer submits", () => {
    const state = derivePendingControllerState(
      base({
        runtime: "busy",
      }),
    )
    expect(state.mode).toBe("busy")
    expect(state.canQueueSubmit).toBe(true)
    expect(state.canSteerSubmit).toBe(true)
    expect(state.primaryFollowupLane).toBe("steer")
  })

  test("busy can steer honors queue as preferred follow-up lane", () => {
    const state = derivePendingControllerState(
      base({
        runtime: "busy",
        preferredFollowupLane: "queue",
      }),
    )
    expect(state.canQueueSubmit).toBe(true)
    expect(state.canSteerSubmit).toBe(true)
    expect(state.primaryFollowupLane).toBe("queue")
  })

  test("server stop request blocks steer explicitly", () => {
    const state = derivePendingControllerState(
      base({
        runtime: "busy",
        pending: pending({ stopRequested: true }),
      }),
    )
    expect(getSteerSubmitBlockReason(base({ runtime: "busy", pending: pending({ stopRequested: true }) }))).toBe(
      "blocked_by_pending",
    )
    expect(state.primaryFollowupLane).toBeUndefined()
  })

  test("idle with queued items blocks foreground submit", () => {
    expect(
      getForegroundSubmitBlockReason(
        base({
          pending: pending({ queue: [{ id: "q1" } as SessionPending["queue"][number]] }),
        }),
      ),
    ).toBe("blocked_by_pending")
  })

  test("paused queue-only state allows foreground submit to bypass the queue", () => {
    expect(
      getForegroundSubmitBlockReason(
        base({
          pending: pending({
            paused: true,
            queue: [{ id: "q1" } as SessionPending["queue"][number]],
          }),
        }),
      ),
    ).toBeUndefined()
  })

  test("paused idle queue-only state enables resume", () => {
    expect(
      getResumeBlockReason(
        base({
          pending: pending({
            paused: true,
            queue: [{ id: "q1" } as SessionPending["queue"][number]],
          }),
        }),
      ),
    ).toBeUndefined()
  })

  test("busy paused queue-only state does not show resume during an active turn", () => {
    expect(
      getResumeBlockReason(
        base({
          runtime: "busy",
          pending: pending({
            paused: true,
            queue: [{ id: "q1" } as SessionPending["queue"][number]],
          }),
        }),
      ),
    ).toBe("blocked_by_pending")
  })

  test("busy paused queue-only state does not allow moving queued items to steer", () => {
    expect(
      getPendingMoveLaneBlockReason(
        base({
          runtime: "busy",
          pending: pending({
            paused: true,
            queue: [{ id: "q1" } as SessionPending["queue"][number]],
          }),
        }),
        "steer",
      ),
    ).toBe("cannot_steer_now")
  })

  test("server-confirmed paused pending clears stale local stop projection without showing busy resume", () => {
    const state = derivePendingControllerState(
      base({
        runtime: "busy",
        stopProjectionActive: true,
        pending: pending({
          paused: true,
          queue: [{ id: "q1" } as SessionPending["queue"][number]],
        }),
      }),
    )

    expect(state.projectionAxis).toBe("none")
    expect(state.canResume).toBe(false)
  })

  test("server stop request keeps stop projection active until stop finishes", () => {
    const state = derivePendingControllerState(
      base({
        runtime: "busy",
        stopProjectionActive: true,
        pending: pending({
          paused: true,
          stopRequested: true,
          queue: [{ id: "q1" } as SessionPending["queue"][number]],
        }),
      }),
    )

    expect(state.projectionAxis).toBe("stopProjected")
  })

  test("resume is blocked while a local edit is active", () => {
    expect(
      getResumeBlockReason(
        base({
          pending: pending({
            paused: true,
            queue: [{ id: "item-1" } as SessionPending["queue"][number]],
          }),
          localEditID: "item-1",
        }),
      ),
    ).toBe("editing_in_progress")
  })

  test("queue submit is blocked while another followup mutation is in flight", () => {
    expect(
      getQueueSubmitBlockReason(
        base({
          runtime: "busy",
          followupMutationInFlight: true,
        }),
      ),
    ).toBe("mutation_in_flight")
  })

  test("save-edit is blocked while another followup mutation is in flight", () => {
    expect(
      getEditSaveBlockReason(
        base({
          followupMutationInFlight: true,
          pending: pending({ queue: [{ id: "item-1" } as SessionPending["queue"][number]] }),
          localEditID: "item-1",
        }),
      ),
    ).toBe("mutation_in_flight")
  })

  test("cancel-edit is blocked while another followup mutation is in flight", () => {
    expect(
      getEditCancelBlockReason(
        base({
          followupMutationInFlight: true,
          pending: pending({ queue: [{ id: "item-1" } as SessionPending["queue"][number]] }),
          localEditID: "item-1",
        }),
      ),
    ).toBe("mutation_in_flight")
  })

  test("existing session with unknown pending hydrates before accepting input", () => {
    const state = derivePendingControllerState(base({ pendingKnowledge: "unknown" }))
    expect(state.canForegroundSubmit).toBe(false)
    expect(state.mode).toBe("hydratingExisting")
  })

  test("local edit stays active while the item remains present", () => {
    const state = derivePendingControllerState(
      base({
        pending: pending({ queue: [{ id: "item-1" } as SessionPending["queue"][number]] }),
        localEditID: "item-1",
      }),
    )
    expect(state.editAxis).toBe("editingSelf")
    expect(state.mode).toBe("editingSelfIdle")
  })

  test("visible editing item stays visible while pending state is still hydrating", () => {
    expect(
      getVisibleEditingItemID(
        base({
          pendingKnowledge: "unknown",
          localEditID: "item-1",
        }),
      ),
    ).toBe("item-1")
  })

  test("visible editing item clears once the pending item disappears", () => {
    expect(
      getVisibleEditingItemID(
        base({
          pending: pending({ queue: [{ id: "item-2" } as SessionPending["queue"][number]] }),
          localEditID: "item-1",
        }),
      ),
    ).toBeUndefined()
  })

  test("stop projection presents steer items as paused queue work", () => {
    const state = derivePendingControllerState(
      base({
        runtime: "busy",
        stopProjectionActive: true,
        pending: pending({
          paused: false,
          steer: [{ id: "s1" } as SessionPending["steer"][number]],
        }),
      }),
    )
    expect(state.pendingShape).toBe("queueOnly")
    expect(state.effectivePending?.steer).toEqual([])
    expect(state.effectivePending?.queue.map((item) => item.id)).toEqual(["s1"])
    expect(state.effectivePending?.paused).toBe(true)
  })

  test("server-confirmed stop request blocks new follow-ups but still allows row resolution", () => {
    const input = base({
      runtime: "busy",
      pending: pending({ stopRequested: true, queue: [{ id: "item-1" } as SessionPending["queue"][number]] }),
    })
    expect(getQueueSubmitBlockReason(input)).toBe("blocked_by_pending")
    expect(getPendingItemActionBlockReason(input)).toBeUndefined()
    expect(getStartEditBlockReason(input)).toBeUndefined()
  })

  test("projected stop request still allows row resolution", () => {
    const input = base({
      runtime: "busy",
      stopProjectionActive: true,
      pending: pending({ queue: [{ id: "item-1" } as SessionPending["queue"][number]] }),
    })
    expect(getPendingItemActionBlockReason(input)).toBeUndefined()
    expect(
      getStartEditBlockReason(
        input,
      ),
    ).toBeUndefined()
  })

  test("starting edit requires an empty composer", () => {
    expect(
      getStartEditBlockReason(
        base({
          composerHasDraft: true,
          pending: pending({ queue: [{ id: "q1" } as SessionPending["queue"][number]] }),
        }),
      ),
    ).toBe("editing_requires_empty_composer")
  })

  test("moving an item to steer is allowed while busy", () => {
    expect(
      getPendingMoveLaneBlockReason(
        base({
          runtime: "busy",
        }),
        "steer",
      ),
    ).toBeUndefined()
  })

  test("moving an item to steer is blocked while stop is requested", () => {
    expect(
      getPendingMoveLaneBlockReason(
        base({
          runtime: "busy",
          pending: pending({ stopRequested: true }),
        }),
        "steer",
      ),
    ).toBe("cannot_steer_now")
  })

  test("modifier lane override falls back to the available primary lane", () => {
    expect(
      resolveFollowupLane({
        primaryFollowupLane: "steer",
        override: true,
        canQueueSubmit: false,
        canSteerSubmit: true,
      }),
    ).toBe("steer")
    expect(
      resolveFollowupLane({
        primaryFollowupLane: "queue",
        override: true,
        canQueueSubmit: true,
        canSteerSubmit: false,
      }),
    ).toBe("queue")
  })

  test("modifier lane override blocks when neither lane is available", () => {
    expect(
      resolveFollowupLane({
        primaryFollowupLane: "steer",
        override: true,
        canQueueSubmit: false,
        canSteerSubmit: false,
      }),
    ).toBeUndefined()
  })
})

describe("local stop projection reconciliation", () => {
  const projection = (input: Partial<Parameters<typeof shouldClearLocalStopProjection>[0]> = {}) => ({
    projected: true,
    pending: pending(),
    runtime: "busy" as const,
    projectedAtUserMessageID: "message_1",
    latestUserMessageID: "message_1",
    ...input,
  })

  test("keeps the immediate optimistic stop projection for the same user message", () => {
    expect(shouldClearLocalStopProjection(projection())).toBe(false)
  })

  test("server stop request keeps the stop projection active", () => {
    expect(
      shouldClearLocalStopProjection(
        projection({
          pending: pending({ stopRequested: true }),
          latestUserMessageID: "message_2",
        }),
      ),
    ).toBe(false)
  })

  test("server-confirmed paused pending clears the local projection", () => {
    expect(
      shouldClearLocalStopProjection(
        projection({
          pending: pending({
            paused: true,
            queue: [{ id: "q1" } as SessionPending["queue"][number]],
          }),
        }),
      ),
    ).toBe(true)
  })

  test("a later user message clears stale stop projection", () => {
    expect(
      shouldClearLocalStopProjection(
        projection({
          latestUserMessageID: "message_2",
        }),
      ),
    ).toBe(true)
  })

  test("a later user message clears stale projection even when new pending items exist", () => {
    expect(
      shouldClearLocalStopProjection(
        projection({
          pending: pending({
            queue: [{ id: "q1" } as SessionPending["queue"][number]],
          }),
          latestUserMessageID: "message_2",
        }),
      ),
    ).toBe(true)
  })

  test("null marker waits until the first user message is visible", () => {
    expect(
      shouldClearLocalStopProjection(
        projection({
          projectedAtUserMessageID: null,
          latestUserMessageID: undefined,
        }),
      ),
    ).toBe(false)
    expect(
      shouldClearLocalStopProjection(
        projection({
          projectedAtUserMessageID: null,
          latestUserMessageID: "message_1",
        }),
      ),
    ).toBe(true)
  })

  test("unscoped legacy projection clears once server no longer requests stop", () => {
    expect(
      shouldClearLocalStopProjection(
        projection({
          projectedAtUserMessageID: undefined,
          latestUserMessageID: undefined,
        }),
      ),
    ).toBe(true)
  })

  test("idle empty session clears the local stop projection", () => {
    expect(
      shouldClearLocalStopProjection(
        projection({
          runtime: "idle",
        }),
      ),
    ).toBe(true)
  })
})

describe("pending snapshot coordinator", () => {
  test("blocked mutations return the current pending snapshot", async () => {
    const state = {
      current: pending({ queue: [{ id: "q1" } as SessionPending["queue"][number]] }),
      loading: false,
      mutating: false,
      known: true,
    }
    const coordinator = createPendingSnapshotCoordinator({
      emptyState: pending(),
      isKnown: () => state.known,
      read: () => state.current,
      write: (_sessionID, next) => {
        state.current = next
      },
      isLoading: () => state.loading,
      setLoading: (_sessionID, next) => {
        state.loading = !!next
      },
      isMutating: () => state.mutating,
      setMutating: (_sessionID, next) => {
        state.mutating = !!next
      },
      fetch: async () => undefined,
      onError: () => undefined,
    })

    const result = await coordinator.mutate("s1", "mutation_in_flight", async () => ({ data: pending() }))
    expect(result).toEqual({
      kind: "blocked",
      reason: "mutation_in_flight",
      state: state.current,
    })
  })

  test("refresh started before a mutation cannot overwrite the mutation snapshot", async () => {
    const refreshResult = deferred<SessionPending | undefined>()
    const state = {
      current: pending({ queue: [{ id: "before" } as SessionPending["queue"][number]] }),
      loading: false,
      mutating: false,
      known: true,
    }
    const coordinator = createPendingSnapshotCoordinator({
      emptyState: pending(),
      isKnown: () => state.known,
      read: () => state.current,
      write: (_sessionID, next) => {
        state.current = next
      },
      isLoading: () => state.loading,
      setLoading: (_sessionID, next) => {
        state.loading = !!next
      },
      isMutating: () => state.mutating,
      setMutating: (_sessionID, next) => {
        state.mutating = !!next
      },
      fetch: async () => refreshResult.promise,
      onError: () => undefined,
    })

    const inflightRefresh = coordinator.refresh("s1", { force: true })
    const mutation = await coordinator.mutate("s1", undefined, async () => ({
      data: pending({ queue: [{ id: "after" } as SessionPending["queue"][number]] }),
    }))

    expect(mutation).toEqual({
      kind: "applied",
      state: pending({ queue: [{ id: "after" } as SessionPending["queue"][number]] }),
    })

    refreshResult.resolve(pending({ queue: [{ id: "stale" } as SessionPending["queue"][number]] }))
    await inflightRefresh

    expect(state.current.queue.map((item) => item.id)).toEqual(["after"])
  })

  test("refresh started before an authoritative write cannot overwrite the newer snapshot", async () => {
    const refreshResult = deferred<SessionPending | undefined>()
    const state = {
      current: pending({ queue: [{ id: "before" } as SessionPending["queue"][number]] }),
      loading: false,
      mutating: false,
      known: true,
    }
    const coordinator = createPendingSnapshotCoordinator({
      emptyState: pending(),
      isKnown: () => state.known,
      read: () => state.current,
      write: (_sessionID, next) => {
        state.current = next
      },
      isLoading: () => state.loading,
      setLoading: (_sessionID, next) => {
        state.loading = !!next
      },
      isMutating: () => state.mutating,
      setMutating: (_sessionID, next) => {
        state.mutating = !!next
      },
      fetch: async () => refreshResult.promise,
      onError: () => undefined,
    })

    const inflightRefresh = coordinator.refresh("s1", { force: true })
    coordinator.authoritative("s1", pending({ queue: [{ id: "after" } as SessionPending["queue"][number]] }))

    refreshResult.resolve(pending({ queue: [{ id: "stale" } as SessionPending["queue"][number]] }))
    await inflightRefresh

    expect(state.current.queue.map((item) => item.id)).toEqual(["after"])
  })

  test("refresh started before an external store write cannot overwrite the newer snapshot", async () => {
    const refreshResult = deferred<SessionPending | undefined>()
    const state = {
      current: pending({ queue: [{ id: "before" } as SessionPending["queue"][number]] }),
      loading: false,
      mutating: false,
      known: true,
    }
    const coordinator = createPendingSnapshotCoordinator({
      emptyState: pending(),
      isKnown: () => state.known,
      read: () => state.current,
      write: (_sessionID, next) => {
        state.current = next
      },
      isLoading: () => state.loading,
      setLoading: (_sessionID, next) => {
        state.loading = !!next
      },
      isMutating: () => state.mutating,
      setMutating: (_sessionID, next) => {
        state.mutating = !!next
      },
      fetch: async () => refreshResult.promise,
      onError: () => undefined,
    })

    const inflightRefresh = coordinator.refresh("s1", { force: true })
    state.current = pending({ queue: [{ id: "event" } as SessionPending["queue"][number]] })

    refreshResult.resolve(pending({ queue: [{ id: "stale" } as SessionPending["queue"][number]] }))
    await inflightRefresh

    expect(state.current.queue.map((item) => item.id)).toEqual(["event"])
  })

  test("refresh started before an external hydration cannot overwrite the hydrated snapshot", async () => {
    const refreshResult = deferred<SessionPending | undefined>()
    const state = {
      current: pending(),
      loading: false,
      mutating: false,
      known: false,
    }
    const coordinator = createPendingSnapshotCoordinator({
      emptyState: pending(),
      isKnown: () => state.known,
      read: () => state.current,
      write: (_sessionID, next) => {
        state.current = next
        state.known = true
      },
      isLoading: () => state.loading,
      setLoading: (_sessionID, next) => {
        state.loading = !!next
      },
      isMutating: () => state.mutating,
      setMutating: (_sessionID, next) => {
        state.mutating = !!next
      },
      fetch: async () => refreshResult.promise,
      onError: () => undefined,
    })

    const inflightRefresh = coordinator.refresh("s1", { force: true })
    state.current = pending({ queue: [{ id: "event" } as SessionPending["queue"][number]] })
    state.known = true

    refreshResult.resolve(pending({ queue: [{ id: "stale" } as SessionPending["queue"][number]] }))
    await inflightRefresh

    expect(state.current.queue.map((item) => item.id)).toEqual(["event"])
  })

  test("background refresh with a known snapshot does not mark the dock loading", async () => {
    const refreshResult = deferred<SessionPending | undefined>()
    const state = {
      current: pending({ queue: [{ id: "before" } as SessionPending["queue"][number]] }),
      loading: false,
      mutating: false,
      known: true,
    }
    const coordinator = createPendingSnapshotCoordinator({
      emptyState: pending(),
      isKnown: () => state.known,
      read: () => state.current,
      write: (_sessionID, next) => {
        state.current = next
      },
      isLoading: () => state.loading,
      setLoading: (_sessionID, next) => {
        state.loading = !!next
      },
      isMutating: () => state.mutating,
      setMutating: (_sessionID, next) => {
        state.mutating = !!next
      },
      fetch: async () => refreshResult.promise,
      onError: () => undefined,
    })

    const inflightRefresh = coordinator.refresh("s1", { force: true, background: true })
    expect(state.loading).toBe(false)

    refreshResult.resolve(pending({ queue: [{ id: "after" } as SessionPending["queue"][number]] }))
    expect(await inflightRefresh).toBe("applied")
    expect(state.loading).toBe(false)
    expect(state.current.queue.map((item) => item.id)).toEqual(["after"])
  })

  test("superseding forced refresh starts a new request instead of reusing an in-flight refresh", async () => {
    const firstRefresh = deferred<SessionPending | undefined>()
    const secondRefresh = deferred<SessionPending | undefined>()
    let fetchCount = 0
    const state = {
      current: pending({ queue: [{ id: "before" } as SessionPending["queue"][number]] }),
      loading: false,
      mutating: false,
      known: true,
    }
    const coordinator = createPendingSnapshotCoordinator({
      emptyState: pending(),
      isKnown: () => state.known,
      read: () => state.current,
      write: (_sessionID, next) => {
        state.current = next
      },
      isLoading: () => state.loading,
      setLoading: (_sessionID, next) => {
        state.loading = !!next
      },
      isMutating: () => state.mutating,
      setMutating: (_sessionID, next) => {
        state.mutating = !!next
      },
      fetch: async () => {
        fetchCount += 1
        return fetchCount === 1 ? firstRefresh.promise : secondRefresh.promise
      },
      onError: () => undefined,
    })

    const staleRefresh = coordinator.refresh("s1", { force: true })
    const forcedRefresh = coordinator.refresh("s1", { force: true, supersede: true })

    expect(fetchCount).toBe(2)

    secondRefresh.resolve(pending({ queue: [{ id: "after" } as SessionPending["queue"][number]] }))
    expect(await forcedRefresh).toBe("applied")

    firstRefresh.resolve(pending({ queue: [{ id: "stale" } as SessionPending["queue"][number]] }))
    expect(await staleRefresh).toBe("skipped")

    expect(state.current.queue.map((item) => item.id)).toEqual(["after"])
  })
})

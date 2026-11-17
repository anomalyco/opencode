import { createEffect, onCleanup, untrack } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { PermissionRequest } from "@opencode/client/promise"
import type { Data } from "@opencode/client/solid"
import { abort } from "@opencode/util/abort"
import { uuid } from "@opencode/util/uuid"
import type { ServerSDK } from "@/runtime/server/client"
import { projectSettingsKey, useSettings } from "@/settings/model"
import {
  INITIAL_AUTO_APPROVE_STATE,
  INITIAL_AUTO_APPROVE_SWEEP_STATE,
  transitionAutoApprove,
  transitionAutoApproveSweep,
  type AutoApproveEffect,
  type AutoApproveEvent,
  type AutoApproveState,
  type AutoApproveSweepEffect,
  type AutoApproveSweepEvent,
} from "./auto-approve-machine"

const repliedLimit = 1000

// Auto-approves permission requests on one server connection for the projects
// the client-local settings cover: the app-wide default, unless a project overrides it.
export function createPermissionAutoApprover(input: { sdk: ServerSDK; data: Data }) {
  const permissions = useSettings().permissions
  const enabled = () => permissions.autoApprovesOnServer(input.sdk.scope)

  const covers = (projectID: string | undefined) =>
    permissions.autoApproves(projectSettingsKey(input.sdk.scope, projectID))

  // Requests in the initial `pending` state have no entry.
  const [requests, setRequests] = createStore<Record<string, AutoApproveState | undefined>>({})
  const replyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const retries = new Map<string, ReturnType<typeof setTimeout>>()
  const scope = new AbortController()
  let sweepState = INITIAL_AUTO_APPROVE_SWEEP_STATE
  let sweepRun: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined
  let sweepRetry: ReturnType<typeof setTimeout> | undefined

  const unsubscribe = [
    input.sdk.event.on("permission.asked", (event) => {
      if (enabled()) consider(event.data, scope.signal)
    }),
    input.sdk.event.on("permission.replied", (event) => dispatch(event.data.requestID, { type: "resolved" })),
  ]

  onCleanup(() => {
    abort(scope)
    unsubscribe.forEach((stop) => stop())
    dispatchSweep({ type: "sweep.cancel" })
    // Back to pending, so replies still in flight settle into nothing and no retry is scheduled.
    untrack(() => Object.keys(requests)).forEach((id) => dispatch(id, { type: "cancel" }))
  })

  // The event stream does not replay requests asked while this client was
  // disconnected, and requests may already be pending before the setting turns
  // on, so sweep on every connect while the setting is on. A newer connect or
  // a change of the setting replaces the sweep and its scheduled retries.
  createEffect(() => {
    const on = enabled() && input.sdk.connection.status() === "connected"

    untrack(() => dispatchSweep(on ? { type: "sweep.start", runId: uuid() } : { type: "sweep.cancel" }))
  })

  // Approves pending requests that reach the local store, which is how a
  // previously unknown idle session's requests surface when its view opens
  // and syncs them. Store changes cannot re-trigger the network sweep: it
  // deliberately reads them after an await, outside Solid tracking.
  createEffect(() => {
    if (!enabled()) return

    for (const session of input.data.session.list()) {
      for (const request of input.data.session.permission.list(session.id) ?? []) approve(request)
    }
  })

  // Turning auto-approve off for a request's project stops its cycle, so a
  // scheduled retry never answers for the user and turning it on again starts over.
  createEffect(() => {
    Object.entries(requests).forEach(([id, state]) => {
      if (!state || state.status === "pending" || state.status === "replied") return

      if (!covers(state.projectID)) dispatch(id, { type: "cancel" })
    })
  })

  function dispatch(requestID: string, event: AutoApproveEvent) {
    const state = untrack(() => requests[requestID]) ?? INITIAL_AUTO_APPROVE_STATE
    const result = transitionAutoApprove(state, event)

    if (result.state !== state) {
      setRequests({ [requestID]: result.state.status === "pending" ? undefined : result.state })

      if (result.state.status === "replied") pruneReplied()
    }

    result.effects.forEach((effect) => execute(requestID, effect))
  }

  function execute(requestID: string, effect: AutoApproveEffect) {
    if (effect.type === "clear-reply-timer") {
      clearTimeout(replyTimers.get(requestID))
      replyTimers.delete(requestID)

      return
    }

    if (effect.type === "reply") {
      const result = { runId: effect.runId, attempt: effect.attempt }

      replyTimers.set(
        requestID,
        setTimeout(() => dispatch(requestID, { type: "reply.timed-out", ...result }), effect.timeoutMs),
      )
      // A request another client, or an earlier attempt whose response was lost, already answered counts as replied.
      void input.data.session.permission.reply({ sessionID: effect.sessionID, requestID, decision: "once" }).then(
        () => dispatch(requestID, { type: "reply.succeeded", ...result }),
        () => dispatch(requestID, { type: "reply.failed", ...result }),
      )

      return
    }

    clearTimeout(retries.get(requestID))
    retries.delete(requestID)

    if (effect.type === "cancel-retry") return
    retries.set(
      requestID,
      setTimeout(() => {
        retries.delete(requestID)
        dispatch(requestID, { type: "retry.due", runId: effect.runId, attempt: effect.attempt })
      }, effect.delayMs),
    )
  }

  function dispatchSweep(event: AutoApproveSweepEvent) {
    const result = transitionAutoApproveSweep(sweepState, event)
    sweepState = result.state
    result.effects.forEach(executeSweep)
  }

  function executeSweep(effect: AutoApproveSweepEffect) {
    if (effect.type === "sweep.abort") {
      clearTimeout(sweepRun?.timer)
      abort(sweepRun?.controller)
      sweepRun = undefined

      return
    }

    if (effect.type === "sweep.run") {
      const controller = new AbortController()
      const result = { runId: effect.runId, attempt: effect.attempt }

      sweepRun = {
        controller,
        timer: setTimeout(() => dispatchSweep({ type: "sweep.timed-out", ...result }), effect.timeoutMs),
      }
      void sweep(controller.signal).then(
        (complete) => dispatchSweep({ type: complete ? "sweep.succeeded" : "sweep.failed", ...result }),
        () => dispatchSweep({ type: "sweep.failed", ...result }),
      )

      return
    }

    clearTimeout(sweepRetry)
    sweepRetry = undefined

    if (effect.type === "sweep.cancel-retry") return
    sweepRetry = setTimeout(() => {
      sweepRetry = undefined
      dispatchSweep({ type: "sweep.retry-due", runId: effect.runId, attempt: effect.attempt })
    }, effect.delayMs)
  }

  function pruneReplied() {
    const replied = untrack(() =>
      Object.entries(requests).flatMap(([id, state]) => (state?.status === "replied" ? [id] : [])),
    )

    if (replied.length <= repliedLimit) return
    setRequests(produce((draft) => replied.slice(0, replied.length - repliedLimit).forEach((id) => delete draft[id])))
  }

  async function sweep(signal: AbortSignal) {
    const inventory = await sweepLocations(signal)

    if (signal.aborted) return false

    const listed = await Promise.all(
      inventory.locations.map((location) =>
        input.sdk.api.permission.request
          .list({ location: { directory: location.directory } }, { signal })
          .then((pending) => {
            // A request already found still gets its project looked up if a slower location runs the sweep out.
            if (!signal.aborted) pending.data.forEach((request) => consider(request, scope.signal))

            return true
          })
          .catch(() => false),
      ),
    )

    return inventory.complete && listed.every(Boolean)
  }

  // Active sessions are the primary inventory: session.active is server-wide,
  // so it covers sessions no tab has loaded, and a request blocking a tool
  // call always belongs to one (Permission.assert clears its entry when the
  // awaiting fiber dies). Locally known sessions are swept too because the
  // external session.permission.create API can park a request on an idle
  // session. A detached request on a session this client never loaded is the
  // one case that stays uncovered.
  async function sweepLocations(signal: AbortSignal) {
    const active = await input.sdk.api.session.active({ signal }).catch(() => undefined)

    if (signal.aborted) return { locations: [], complete: false }
    const ids = Object.keys(active ?? {})

    // Resync every active session rather than trusting cached info: another
    // client may have moved one while this client was disconnected, and the
    // cached location would list permissions from the old location. A failed
    // resync falls back to the cached location and marks the sweep incomplete.
    const synced = await Promise.all(
      ids.map((id) => {
        input.data.session.invalidate(id)

        return input.data.session.sync(id).then(
          () => true,
          () => false,
        )
      }),
    )

    const locations = [
      ...ids.flatMap((id) => {
        const location = input.data.session.get(id)?.location

        return location ? [location] : []
      }),
      ...input.data.session.list().map((session) => session.location),
    ]

    return {
      locations: [...new Map(locations.map((item) => [item.directory, item])).values()],
      complete: active !== undefined && synced.every(Boolean),
    }
  }

  // A request from a session this client has not loaded needs that session's
  // project before a per-project choice can apply to it.
  function consider(permission: PermissionRequest, signal: AbortSignal) {
    if (covers(undefined) || input.data.session.get(permission.sessionID)) return approve(permission)
    void input.sdk.api.session
      .get({ sessionID: permission.sessionID }, { signal })
      .then((session) => {
        if (!signal.aborted) approve(permission, session.projectID)
      })
      .catch(() => undefined)
  }

  function approve(permission: PermissionRequest, projectID = input.data.session.get(permission.sessionID)?.projectID) {
    if (!covers(projectID)) return
    dispatch(permission.id, { type: "approve", sessionID: permission.sessionID, projectID, runId: uuid() })
  }

  return {
    /** The auto-approve lifecycle of one permission request. Reactive. */
    state: (requestID: string) => requests[requestID] ?? INITIAL_AUTO_APPROVE_STATE,
  }
}

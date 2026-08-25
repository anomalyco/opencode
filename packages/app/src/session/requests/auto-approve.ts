import { createEffect, onCleanup } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/client/promise"
import type { Data } from "@opencode-ai/client/solid"
import type { ServerSDK } from "@/runtime/server/client"
import { useSettings } from "@/settings/model"

const respondedLimit = 1000
const retryLimit = 2
const retryDelayMs = 1000

// Auto-approves permission requests on one server connection whenever the
// app-level auto-approve setting is on. The setting lives in the client-local
// settings store, so it applies to every session, tab, and server at once.
export function createPermissionAutoApprover(input: { sdk: ServerSDK; data: Data }) {
  const enabled = useSettings().permissions.autoApprove
  const state = { disposed: false, generation: 0, responded: new Set<string>() }

  const unsubscribe = input.sdk.event.on("permission.asked", (event) => {
    if (enabled()) approve(event.data)
  })
  onCleanup(() => {
    state.disposed = true
    unsubscribe()
  })

  // The event stream does not replay requests asked while this client was
  // disconnected, and requests may already be pending before the setting turns
  // on, so sweep on every connect while the setting is on.
  createEffect(() => {
    if (!enabled() || input.sdk.connection.status() !== "connected") return
    const generation = ++state.generation
    void sweepWithRetry(generation, 0)
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

  // An incomplete sweep leaves pending requests hidden with no later trigger
  // to recover them, so retry it a bounded number of times. A newer sweep
  // supersedes scheduled retries.
  async function sweepWithRetry(generation: number, attempt: number) {
    const complete = await sweep()
    if (complete || attempt >= retryLimit) return
    setTimeout(() => {
      if (state.disposed || !enabled() || generation !== state.generation) return
      void sweepWithRetry(generation, attempt + 1)
    }, retryDelayMs * (attempt + 1))
  }

  async function sweep() {
    const inventory = await sweepLocations()
    const listed = await Promise.all(
      inventory.locations.map((location) =>
        input.sdk.api.permission.request
          .list({ location: { directory: location.directory, workspace: location.workspaceID } })
          .then((pending) => {
            if (!state.disposed) pending.data.forEach((request) => approve(request))
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
  async function sweepLocations() {
    const active = await input.sdk.api.session.active().catch(() => undefined)
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
      locations: [
        ...new Map(locations.map((item) => [`${item.directory}\u0000${item.workspaceID ?? ""}`, item])).values(),
      ],
      complete: active !== undefined && synced.every(Boolean),
    }
  }

  function approve(permission: PermissionRequest, attempt = 0) {
    // enabled() guards the retry timer path: the user may disable the setting
    // between a failed reply and its scheduled retry.
    if (state.disposed || !enabled() || state.responded.has(permission.id)) return
    remember(permission.id)
    input.sdk.api.permission
      .reply({ sessionID: permission.sessionID, requestID: permission.id, reply: "once" })
      .catch(() => {
        // A reply failure leaves the request pending but invisible (the UI
        // hides prompts while auto-approve is on), so retry a bounded number
        // of times. Later sweeps retry it after that.
        state.responded.delete(permission.id)
        if (state.disposed || attempt >= retryLimit) return
        setTimeout(() => approve(permission, attempt + 1), retryDelayMs * (attempt + 1))
      })
  }

  function remember(id: string) {
    state.responded.add(id)
    for (const oldest of state.responded) {
      if (state.responded.size <= respondedLimit) break
      state.responded.delete(oldest)
    }
  }
}

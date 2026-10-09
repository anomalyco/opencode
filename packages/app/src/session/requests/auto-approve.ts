import { createEffect, onCleanup } from "solid-js"
import type { PermissionRequest } from "@opencode/client/promise"
import type { Data } from "@opencode/client/solid"
import type { ServerSDK } from "@/runtime/server/client"
import { useSettings } from "@/settings/model"
import { permissionLocations } from "./passive"

const respondedLimit = 1000

const retryLimit = 2

const retryDelayMs = 1000

// Auto-approves permission requests on one server connection whenever the
// app-level auto-approve setting is on. The setting lives in the client-local
// settings store, so it applies to every session, tab, and server at once.
export function createPermissionAutoApprover(input: { sdk: ServerSDK; data: Data }) {
  const enabled = useSettings().permissions.autoApprove
  const state = {
    disposed: false,
    generation: 0,
    responded: new Set<string>(),
    inflight: new Map<string, { generation: number }>(),
  }
  const current = (generation: number) =>
    !state.disposed &&
    generation === state.generation &&
    enabled() &&
    input.sdk.connection.status() === "connected"

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
    const generation = ++state.generation
    if (!enabled() || input.sdk.connection.status() !== "connected") return
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
    const complete = await sweep(generation)

    if (complete || attempt >= retryLimit) return
    setTimeout(
      () => {
        if (!current(generation)) return
        void sweepWithRetry(generation, attempt + 1)
      },
      retryDelayMs * (attempt + 1),
    )
  }

  async function sweep(generation: number) {
    const inventory = await permissionLocations({
      ...input,
      current: () => current(generation),
    })
    if (!current(generation)) return true

    const listed = await Promise.all(
      inventory.locations.map((location) =>
        input.sdk.api.permission.request
          .list({ location })
          .then((pending) => {
            if (current(generation)) pending.data.forEach((request) => approve(request))

            return true
          })
          .catch(() => false),
      ),
    )

    return inventory.complete && listed.every(Boolean)
  }

  function approve(permission: PermissionRequest, attempt = 0, generation = state.generation) {
    // A failed reply must not replay a request from an old connection. The
    // fresh sweep revalidates pending requests after a reconnect.
    if (
      !current(generation) ||
      state.responded.has(permission.id) ||
      state.inflight.get(permission.id)?.generation === generation
    )
      return
    const attemptState = { generation }
    state.inflight.set(permission.id, attemptState)
    input.sdk.api.permission
      .reply({ sessionID: permission.sessionID, requestID: permission.id, decision: "once" })
      .then(() => {
        if (state.inflight.get(permission.id) !== attemptState) return
        state.inflight.delete(permission.id)
        remember(permission.id)
      })
      .catch(() => {
        // A reply failure leaves the request pending but invisible (the UI
        // hides prompts while auto-approve is on), so retry a bounded number
        // of times. Later sweeps retry it after that.
        if (state.inflight.get(permission.id) !== attemptState) return
        state.inflight.delete(permission.id)

        if (!current(generation) || attempt >= retryLimit) return
        setTimeout(() => approve(permission, attempt + 1, generation), retryDelayMs * (attempt + 1))
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

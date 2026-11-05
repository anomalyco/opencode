import { onCleanup, type Accessor } from "solid-js"
import { isServiceUnavailableError } from "@opencode/client/promise"
import { createKeyed, type MountedSession } from "@opencode/plugin/gui"
import {
  CATALOG_LOAD_TIMEOUT_MS,
  createCatalogState,
  transitionCatalog,
  type CatalogEffect,
  type CatalogEvent,
} from "./catalog-machine"

type Data = MountedSession["server"]["data"]

const location = (session: MountedSession) => (session.directory ? { directory: session.directory } : undefined)

/**
 * Loads the provider and model catalogs of the routed session's location. A detached view loads nothing; once
 * selected again it loads if its target changed, the server reconnected, or the last load failed. A cold Location's
 * 503 retries with backoff. `retry` loads a failed catalog again, for when the user opens the context view.
 */
export function syncCatalog(session: Accessor<MountedSession>, active: Accessor<boolean> = () => true) {
  const machine = { state: createCatalogState<Data>() }
  // Cancels an attempt's load (its timeout, and the lists after `syncInfo`) or its retry timer.
  const pending = new Map<number, () => void>()

  const dispatch = (event: CatalogEvent<Data>) => {
    const next = transitionCatalog(machine.state, event)
    machine.state = next.state
    next.effects.forEach((effect) => void Promise.try(() => run(effect)).catch(console.error))
  }

  const run = (effect: CatalogEffect<Data>) => {
    if (effect.type === "cancel") {
      pending.get(effect.attempt)?.()
      pending.delete(effect.attempt)
      return
    }

    if (effect.type === "schedule-retry") {
      const timer = setTimeout(() => {
        pending.delete(effect.attempt)
        dispatch({ type: "retry.due", attempt: effect.attempt })
      }, effect.delay)
      pending.set(effect.attempt, () => clearTimeout(timer))
      return
    }

    const attempt = effect.attempt
    const target = effect.target
    const cancelled = { value: false }
    const timer = setTimeout(() => dispatch({ type: "load.timed-out", attempt }), CATALOG_LOAD_TIMEOUT_MS)

    pending.set(attempt, () => {
      cancelled.value = true
      clearTimeout(timer)
    })

    const settle = (event: CatalogEvent<Data>) => {
      clearTimeout(timer)
      pending.delete(attempt)

      if (!cancelled.value) dispatch(event)
    }

    // A known directory starts both lists before the first await; the default Location is known once its info loads.
    void Promise.try(() =>
      target.directory
        ? lists(target.data, { directory: target.directory })
        : target.data.location.syncInfo().then(() => {
            if (!cancelled.value) return lists(target.data, target.data.location.default())
          }),
    ).then(
      () => settle({ type: "load.succeeded", attempt }),
      (error: unknown) => settle({ type: "load.failed", attempt, retryable: isServiceUnavailableError(error) }),
    )
  }

  // The same target while another session of the same directory is routed, so a session switch loads nothing.
  createKeyed(
    () => {
      const current = session()

      return {
        active: active(),
        target: current.server.connected ? { data: current.server.data, directory: current.directory } : undefined,
      }
    },
    (input) => dispatch({ type: "input.changed", active: input.active, target: input.target }),
    {
      equals: (a, b) =>
        a.active === b.active && a.target?.data === b.target?.data && a.target?.directory === b.target?.directory,
    },
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  return { retry: () => dispatch({ type: "retry.requested" }) }
}

function lists(data: Data, ref: { directory: string }) {
  return Promise.all([data.location.provider.sync(ref), data.location.model.sync(ref)])
}

/** The catalog entries of a message's model, matching the app's provider catalog: both lists must load, and deprecated models are skipped. */
export function catalogModel(session: MountedSession, model: { readonly providerID: string; readonly id: string }) {
  const ref = location(session)
  const providers = session.server.data.location.provider.list(ref)
  const models = session.server.data.location.model.list(ref)

  if (!providers || !models) return
  const provider = providers.findLast((item) => item.id === model.providerID)

  if (!provider) return

  return {
    provider,
    model: models.findLast(
      (item) => item.providerID === model.providerID && item.id === model.id && item.status !== "deprecated",
    ),
  }
}

import { createEffect } from "solid-js"
import type { SessionView } from "../sdk"

const location = (session: SessionView) => (session.directory ? { directory: session.directory } : undefined)

/** Loads the provider and model catalogs of the session's location. */
export function syncCatalog(session: SessionView) {
  createEffect(() => {
    if (!session.server.connected) return
    const data = session.server.data
    const ref = location(session)
    void (async () => {
      if (!ref) await data.location.syncInfo()
      const resolved = ref ?? data.location.default()
      await Promise.all([data.location.provider.sync(resolved), data.location.model.sync(resolved)])
    })().catch(() => undefined)
  })
}

/** The catalog entries of a message's model, matching the app's provider catalog: both lists must load, and deprecated models are skipped. */
export function catalogModel(session: SessionView, model: { readonly providerID: string; readonly id: string }) {
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

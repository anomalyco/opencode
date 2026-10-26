import { createMemo, type Accessor } from "solid-js"
import { createKeyed, type MountedSession } from "../sdk"

const location = (session: MountedSession) => (session.directory ? { directory: session.directory } : undefined)

/** Loads the provider and model catalogs of the routed session's location. */
export function syncCatalog(session: Accessor<MountedSession>) {
  // The same target while another session of the same directory is routed, so a session switch loads nothing.
  const target = createMemo(
    () => {
      const current = session()

      return current.server.connected ? { data: current.server.data, ref: location(current) } : undefined
    },
    undefined,
    { equals: (a, b) => a?.data === b?.data && a?.ref?.directory === b?.ref?.directory },
  )

  // Loads again when the server reconnects or is replaced, and when another session's directory is routed.
  createKeyed(
    target,
    (current) =>
      void (async () => {
        if (!current.ref) await current.data.location.syncInfo()
        const resolved = current.ref ?? current.data.location.default()
        await Promise.all([current.data.location.provider.sync(resolved), current.data.location.model.sync(resolved)])
      })().catch(() => undefined),
  )
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

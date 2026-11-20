import { createRoot } from "solid-js"
import { consoleCatalogLoaded } from "@/providers/catalog/console"
import { createConsoleCatalogSettler } from "@/providers/catalog/console-settle"
import { useData } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"

export type ConnectionRefreshOutcome = "loaded" | "timed-out" | "failed"

/**
 * Reloads the catalogs after a sign-in saved a credential, and shows every model the integration offers: the picker
 * only lists the newest model per family by default, which hides most of what a new connection unlocked. With `settle`
 * it also waits for the Console workspace's providers, which the server loads a moment after the grant.
 *
 * The wait runs in its own root, so it finishes and shows the models even when the dialog that asked closes first.
 */
export function useConnectionRefresh(directory: string | undefined) {
  const data = useData()
  const global = useGlobal()
  const location = directory ? { directory } : undefined

  const providersOf = (integrationID: string) =>
    (data.location.provider.list(location) ?? []).filter(
      (item) => item.id === integrationID || item.integrationID === integrationID,
    )

  const reveal = (integrationID: string) => {
    const ids = new Set(providersOf(integrationID).map((item) => item.id))

    global.models.show(
      (data.location.model.list(location) ?? [])
        .filter((model) => ids.has(model.providerID) && model.enabled && model.status !== "deprecated")
        .map((model) => ({ providerID: model.providerID, modelID: model.id })),
    )
  }

  const catalogs = () => {
    data.location.provider.invalidate(location)
    data.location.model.invalidate(location)

    return Promise.all([data.location.provider.sync(location), data.location.model.sync(location)]).then(
      () => undefined,
    )
  }

  const settle = (integrationID: string) =>
    createRoot((dispose) =>
      createConsoleCatalogSettler({ isLoaded: () => consoleCatalogLoaded(providersOf(integrationID)), sync: catalogs })
        .settle()
        .finally(dispose),
    )

  return async (input: { integrationID: string; settle: boolean }): Promise<ConnectionRefreshOutcome> => {
    data.location.integration.invalidate(location)

    const synced = await Promise.all([data.location.integration.sync(location), catalogs()])
      .then(() => true)
      .catch(() => false)

    if (!synced) return "failed"
    reveal(input.integrationID)

    if (!input.settle) return "loaded"
    const outcome = await settle(input.integrationID)
    reveal(input.integrationID)

    return outcome === "timed-out" ? "timed-out" : "loaded"
  }
}

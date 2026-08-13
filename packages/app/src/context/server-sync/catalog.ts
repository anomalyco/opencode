import type { QueryClient } from "@tanstack/solid-query"
import type { ServerScope } from "@/utils/server-scope"
import { pathKey, type PathKey } from "@/utils/path-key"

type CatalogEvent = {
  type: string
  directory: string
}

export function createCatalogSync(input: {
  scope: ServerScope
  queryClient: QueryClient
  active: () => PathKey[]
  load: (directory: PathKey | null) => Promise<void>
}) {
  function handleEvent(event: CatalogEvent) {
    if (event.type === "server.connected") {
      void refreshActive().catch(() => undefined)
      return
    }

    if (
      event.type === "catalog.updated" ||
      event.type === "integration.updated" ||
      event.type === "integration.connection.updated"
    ) {
      void refresh(event.directory === "global" ? null : pathKey(event.directory)).catch(() => undefined)
    }
  }

  async function refresh(directory: PathKey | null) {
    await Promise.all(
      ["providers", "integrations"].map((resource) =>
        input.queryClient.invalidateQueries({
          queryKey: [input.scope, directory, resource],
          exact: true,
          refetchType: "none",
        }),
      ),
    )
    await input.load(directory)
  }

  function refreshActive() {
    return Promise.all([null, ...new Set(input.active())].map(refresh)).then(() => undefined)
  }

  return {
    handleEvent,
    refresh,
    refreshActive,
  }
}

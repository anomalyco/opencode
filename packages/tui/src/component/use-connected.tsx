import { createMemo } from "solid-js"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { hasConnectedProvider } from "../util/connected-provider"

export function useConnected() {
  const data = useData()
  const location = useLocation()
  return createMemo(() =>
    hasConnectedProvider({
      integrations: data.location.integration.list(location.ref) ?? [],
      providers: data.location.provider.list(location.ref) ?? [],
      models: data.location.model.list(location.ref) ?? [],
    }),
  )
}

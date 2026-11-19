import { createMemo } from "solid-js"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { hasConnectedProvider } from "../util/connected-provider"

export function useConnected() {
  const data = useData()
  const location = useLocation()
  return createMemo(() => {
    const ref = location.ref
    const integrations = data.location.integration.list(ref) ?? []
    const providers = data.location.provider.list(ref) ?? []
    const models = data.location.model.list(ref) ?? []
    return hasConnectedProvider(integrations, providers, models)
  })
}
import type { IntegrationInfo } from "@opencode/client"

export function hasConnectedProvider(integrations: readonly Pick<IntegrationInfo, "connections" | "configured">[]) {
  return integrations.some((integration) => integration.connections.length > 0 || integration.configured)
}

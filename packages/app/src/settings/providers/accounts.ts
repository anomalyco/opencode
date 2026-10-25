import type { ConnectionInfo, IntegrationInfo } from "@opencode/client/promise"

export type ProviderAccount = Extract<ConnectionInfo, { type: "credential" }>

export function providerAccounts(integration: IntegrationInfo | undefined) {
  return integration?.connections.filter((connection): connection is ProviderAccount => connection.type === "credential") ?? []
}

export function activeProviderAccount(integration: IntegrationInfo | undefined) {
  return providerAccounts(integration)[0]
}

// Go is an OpenCode account with a subscription, so the connect picker shows one OpenCode row for Go, Zen and
// Console. A saved Go API key keeps its own row, where it is managed.
export function connectPickerIntegrations(list: IntegrationInfo[]) {
  return list.filter((integration) => integration.id !== "opencode-go" || providerAccounts(integration).length > 0)
}

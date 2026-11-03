import type { ConnectionInfo, IntegrationInfo } from "@opencode/client/promise"

export type ProviderAccount = Extract<ConnectionInfo, { type: "credential" }>

export function providerAccounts(integration: IntegrationInfo | undefined) {
  return integration?.connections.filter((connection): connection is ProviderAccount => connection.type === "credential") ?? []
}

export function activeProviderAccount(integration: IntegrationInfo | undefined) {
  return providerAccounts(integration)[0]
}

const REGISTRY_KEY = Symbol.for("opencode.externalProviderPermissionBridge")

export type ExternalProviderPermissionDecision = {
  behavior: "allow" | "deny"
  message?: string
}

export type ExternalProviderPermissionRequest = {
  sessionID: string
  permission: string
  patterns: string[]
  always: string[]
  metadata: Record<string, unknown>
  tool?: {
    callID: string
    messageID?: string
  }
}

export type ExternalProviderPermissionBridge = {
  ask(input: ExternalProviderPermissionRequest): Promise<ExternalProviderPermissionDecision>
}

type RegistryShape = Map<string, ExternalProviderPermissionBridge>

function registry(): RegistryShape {
  const globalValue = globalThis as Record<PropertyKey, unknown>
  const existing = globalValue[REGISTRY_KEY]
  if (existing instanceof Map) return existing as RegistryShape

  const created = new Map<string, ExternalProviderPermissionBridge>()
  globalValue[REGISTRY_KEY] = created
  return created
}

export function registerExternalProviderPermissionBridge(
  sessionID: string,
  bridge: ExternalProviderPermissionBridge,
) {
  const map = registry()
  map.set(sessionID, bridge)

  return () => {
    const current = map.get(sessionID)
    if (current === bridge) {
      map.delete(sessionID)
    }
  }
}

import { OpenClawBridge } from "@/openclaw/bridge"
import { GenericAgentBridge } from "@/genericagent/bridge"
import type { ExtraAgentBridge } from "./types"

const openclawBridge: ExtraAgentBridge = {
  id: "openclaw",
  listen(opts) {
    const config = opts.config ?? {}
    const url = readString(config, "gatewayUrl") ?? "ws://127.0.0.1:18789"
    const token = readString(config, "gatewayToken")
    return OpenClawBridge.listen({
      hostname: opts.hostname,
      port: opts.port,
      cors: opts.cors,
      gateway: { url, token },
    })
  },
}

const genericagentBridge: ExtraAgentBridge = {
  id: "genericagent",
  listen(opts) {
    return GenericAgentBridge.listen({
      hostname: opts.hostname,
      port: opts.port,
      cors: opts.cors,
    })
  },
}

const registry: Record<string, ExtraAgentBridge> = {
  [openclawBridge.id]: openclawBridge,
  [genericagentBridge.id]: genericagentBridge,
}

export function registerBridge(bridge: ExtraAgentBridge) {
  registry[bridge.id] = bridge
}

export function getBridge(id: string): ExtraAgentBridge | undefined {
  return registry[id]
}

export function listBridgeIds(): string[] {
  return Object.keys(registry)
}

function readString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

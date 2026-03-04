import type { SharedV3Warning } from "@ai-sdk/provider"

export type { SharedV3Warning }

export function unsupportedSetting(setting: string, details?: string): SharedV3Warning {
  return { type: "unsupported", feature: setting, details }
}

export function unsupportedTool(details?: string): SharedV3Warning {
  return { type: "unsupported", feature: "tool", details }
}

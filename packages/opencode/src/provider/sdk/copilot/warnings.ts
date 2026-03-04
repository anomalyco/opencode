import type { SharedV3Warning } from "@ai-sdk/provider"

export type { SharedV3Warning }

export function unsupportedSetting(setting: string, details?: string): SharedV3Warning {
  return { type: "unsupported", feature: setting, details }
}

export function unsupportedTool(
  tool?: { type: string; id?: string; name?: string },
  details?: string,
): SharedV3Warning {
  const desc = tool ? `${tool.type}${tool.id ? `:${tool.id}` : tool.name ? `:${tool.name}` : ""}` : undefined
  return { type: "unsupported", feature: "tool", details: desc ?? details }
}

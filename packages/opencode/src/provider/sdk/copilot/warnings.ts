import type { SharedV3Warning } from "@ai-sdk/provider"

export type { SharedV3Warning }

export function unsupportedSetting(setting: string, details?: string): SharedV3Warning {
  return { type: "unsupported", feature: setting, details }
}

export function unsupportedTool(
  tool?: { type: string; id?: string; name?: string },
  details?: string,
): SharedV3Warning {
  // Build a descriptive identifier so callers can pinpoint which tool was skipped.
  // Falls back to the full JSON serialisation when neither id nor name is present.
  const desc = tool
    ? tool.id
      ? `${tool.type}:${tool.id}`
      : tool.name
        ? `${tool.type}:${tool.name}`
        : JSON.stringify(tool)
    : undefined
  return { type: "unsupported", feature: "tool", details: desc ?? details }
}

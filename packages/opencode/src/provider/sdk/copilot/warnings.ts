import type { LanguageModelV2CallWarning, SharedV3Warning } from "@ai-sdk/provider"

export function toV3Warnings(warnings: LanguageModelV2CallWarning[]): SharedV3Warning[] {
  return warnings.map((w) => {
    if (w.type === "unsupported-setting")
      return { type: "unsupported" as const, feature: String(w.setting), details: w.details }
    if (w.type === "unsupported-tool") return { type: "unsupported" as const, feature: "tool", details: w.details }
    return { type: "other" as const, message: w.message }
  })
}

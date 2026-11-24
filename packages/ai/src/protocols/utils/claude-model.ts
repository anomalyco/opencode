import type { LLMRequest } from "../../schema/index.js"

export const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01"

// Accept gateway namespaces and Vertex suffixes without treating a snapshot date as a minor version.
export const claudeVersion = (id: string) => {
  const match = /(?:^|[./])claude-(?<family>[a-z]+)-(?<major>\d+)(?:[.-](?<minor>\d{1,2}))?(?:$|[-:@])/.exec(
    id.toLowerCase(),
  )?.groups
  if (!match) return undefined
  return { family: match.family, major: Number(match.major), minor: Number(match.minor ?? 0) }
}

export const supportsThinkingBlockBinding = (model: LLMRequest["model"]) => {
  const override = model.compatibility?.supportsThinkingBlockBinding
  if (override !== undefined) return override
  const version = claudeVersion(model.id)
  return version !== undefined && (version.major > 5 || (version.major === 5 && version.minor >= 1))
}

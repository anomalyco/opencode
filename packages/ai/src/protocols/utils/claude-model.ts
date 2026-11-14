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

// These models return the notes they write for the user between tool calls as progress-update
// thinking blocks. https://platform.claude.com/docs/en/build-with-claude/thinking#progress-updates
export const writesProgressUpdates = (model: LLMRequest["model"]) => {
  const version = claudeVersion(model.id)
  if (version === undefined) return false
  if (version.family === "fable") return version.major >= 5
  if (version.family === "mythos") return version.major > 5 || (version.major === 5 && version.minor >= 1)
  return version.major > 5 || (version.major === 5 && version.minor >= 5)
}

export const supportsThinkingBlockBinding = (model: LLMRequest["model"]) => {
  const override = model.compatibility?.supportsThinkingBlockBinding
  if (override !== undefined) return override
  const version = claudeVersion(model.id)
  return version !== undefined && (version.major > 5 || (version.major === 5 && version.minor >= 1))
}

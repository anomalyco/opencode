import type { LanguageModel } from "../../schema/index.js"

// Accept gateway namespaces and Vertex suffixes without treating a snapshot date as a minor version.
export const version = (id: string) => {
  const match = /(?:^|[./])claude-(?<family>[a-z]+)-(?<major>\d+)(?:[.-](?<minor>\d{1,2}))?(?:$|[-:@])/.exec(
    id.toLowerCase(),
  )?.groups
  if (!match) return undefined
  return { family: match.family, major: Number(match.major), minor: Number(match.minor ?? 0) }
}

export const supportsThinkingBlockBinding = (model: LanguageModel) => {
  const override = model.compatibility?.supportsThinkingBlockBinding
  if (override !== undefined) return override
  const parsed = version(model.id)
  return parsed !== undefined && (parsed.major > 5 || (parsed.major === 5 && parsed.minor >= 1))
}

export * as AnthropicModel from "./anthropic-model.js"

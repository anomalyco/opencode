export * as Profile from "./profile"

import { Schema } from "effect"

export const DeveloperStyle = Schema.Struct({
  explicitness: Schema.Number,
  abstraction_tolerance: Schema.Number,
  verbosity: Schema.Number,
  testing_style: Schema.String,
  typing_rigor: Schema.Number,
}).annotate({ identifier: "Personalization.DeveloperStyle" })

export type DeveloperStyle = typeof DeveloperStyle.Type

export const ToolPreference = Schema.Struct({
  prefer_cli: Schema.Boolean,
  prefer_direct_edits: Schema.Boolean,
  autonomous_level: Schema.String,
}).annotate({ identifier: "Personalization.ToolPreference" })

export type ToolPreference = typeof ToolPreference.Type

export const UserProfileData = Schema.Struct({
  languages: Schema.Array(Schema.String),
  frameworks: Schema.Array(Schema.String),
  style: DeveloperStyle,
  architecture_preference: Schema.String,
  tool_preference: ToolPreference,
  database_style: Schema.String,
}).annotate({ identifier: "Personalization.UserProfileData" })

export type UserProfileData = typeof UserProfileData.Type

export const DEFAULT_USER_PROFILE: UserProfileData = {
  languages: ["typescript", "python"],
  frameworks: ["react", "vite", "fastapi"],
  style: {
    explicitness: 0.85,
    abstraction_tolerance: 0.35,
    verbosity: 0.3,
    testing_style: "vitest",
    typing_rigor: 0.9,
  },
  architecture_preference: "explicit > magical",
  tool_preference: {
    prefer_cli: true,
    prefer_direct_edits: true,
    autonomous_level: "semi-autonomous",
  },
  database_style: "SQLAlchemy/Postgres",
}

export type ProfileDelta = {
  languages?: readonly string[] | string[]
  frameworks?: readonly string[] | string[]
  style?: Partial<DeveloperStyle>
  architecture_preference?: string
  tool_preference?: Partial<ToolPreference>
  database_style?: string
}

function clamp(val: number, min: number = 0, max: number = 1): number {
  if (val < min) return min
  if (val > max) return max
  return Math.round(val * 1000) / 1000
}

function mergeUniqueList(current: readonly string[], additions?: readonly string[] | string[]): string[] {
  if (!additions || additions.length === 0) return [...current]
  const set = new Set<string>()
  const result: string[] = []
  for (const item of additions) {
    const norm = item.trim().toLowerCase()
    if (norm && !set.has(norm)) {
      set.add(norm)
      result.push(norm)
    }
  }
  for (const item of current) {
    const norm = item.trim().toLowerCase()
    if (norm && !set.has(norm)) {
      set.add(norm)
      result.push(norm)
    }
  }
  return result
}

/**
 * Applies dynamic drift update: P(t+1) = f(P(t), delta, alpha)
 * Smoothly shifts numeric behavioral dimensions using exponential moving average (EMA)
 * and prioritizes recently observed technologies.
 */
export function applyProfileDrift(
  current: UserProfileData,
  delta: ProfileDelta,
  alpha: number = 0.2,
): UserProfileData {
  const effectiveAlpha = clamp(alpha, 0.01, 1.0)
  const currentStyle = current.style
  const deltaStyle = delta.style ?? {}

  const updatedStyle: DeveloperStyle = {
    explicitness:
      typeof deltaStyle.explicitness === "number"
        ? clamp((1 - effectiveAlpha) * currentStyle.explicitness + effectiveAlpha * deltaStyle.explicitness)
        : currentStyle.explicitness,
    abstraction_tolerance:
      typeof deltaStyle.abstraction_tolerance === "number"
        ? clamp((1 - effectiveAlpha) * currentStyle.abstraction_tolerance + effectiveAlpha * deltaStyle.abstraction_tolerance)
        : currentStyle.abstraction_tolerance,
    verbosity:
      typeof deltaStyle.verbosity === "number"
        ? clamp((1 - effectiveAlpha) * currentStyle.verbosity + effectiveAlpha * deltaStyle.verbosity)
        : currentStyle.verbosity,
    testing_style: deltaStyle.testing_style?.trim() || currentStyle.testing_style,
    typing_rigor:
      typeof deltaStyle.typing_rigor === "number"
        ? clamp((1 - effectiveAlpha) * currentStyle.typing_rigor + effectiveAlpha * deltaStyle.typing_rigor)
        : currentStyle.typing_rigor,
  }

  const currentTool = current.tool_preference
  const deltaTool = delta.tool_preference ?? {}

  const updatedTool: ToolPreference = {
    prefer_cli: typeof deltaTool.prefer_cli === "boolean" ? deltaTool.prefer_cli : currentTool.prefer_cli,
    prefer_direct_edits:
      typeof deltaTool.prefer_direct_edits === "boolean"
        ? deltaTool.prefer_direct_edits
        : currentTool.prefer_direct_edits,
    autonomous_level: deltaTool.autonomous_level?.trim() || currentTool.autonomous_level,
  }

  return {
    languages: mergeUniqueList(current.languages, delta.languages),
    frameworks: mergeUniqueList(current.frameworks, delta.frameworks),
    style: updatedStyle,
    architecture_preference: delta.architecture_preference?.trim() || current.architecture_preference,
    tool_preference: updatedTool,
    database_style: delta.database_style?.trim() || current.database_style,
  }
}

/**
 * Renders a compact, high-signal natural language summary of developer behavioral traits (100-200 tokens).
 */
export function formatProfileDirectives(profile: UserProfileData): string {
  const parts: string[] = []

  if (profile.languages.length > 0) {
    parts.push(`- Preferred Languages: ${profile.languages.slice(0, 4).join(", ")}`)
  }

  if (profile.frameworks.length > 0) {
    parts.push(`- Preferred Frameworks & Tools: ${profile.frameworks.slice(0, 5).join(", ")}`)
  }

  const styleParts: string[] = []
  if (profile.style.explicitness > 0.7) {
    styleParts.push("strongly prefer explicit code over magic/metaprogramming")
  } else if (profile.style.explicitness < 0.3) {
    styleParts.push("prefer concise, high-level abstractions")
  }

  if (profile.style.abstraction_tolerance < 0.4) {
    styleParts.push("keep code flat and avoid unnecessary indirection")
  }

  if (profile.style.verbosity < 0.35) {
    styleParts.push("keep explanations brief and direct")
  }

  if (profile.style.typing_rigor > 0.8) {
    styleParts.push("use rigorous static typing, avoid 'any'")
  }

  if (profile.style.testing_style) {
    styleParts.push(`write tests using ${profile.style.testing_style}`)
  }

  if (styleParts.length > 0) {
    parts.push(`- Coding Style: ${styleParts.join("; ")}`)
  }

  if (profile.architecture_preference) {
    parts.push(`- Architecture: ${profile.architecture_preference}`)
  }

  const toolParts: string[] = []
  if (profile.tool_preference.prefer_cli) {
    toolParts.push("prefers terminal/shell operations")
  }
  if (profile.tool_preference.prefer_direct_edits) {
    toolParts.push("prefers surgical file edits")
  }
  if (toolParts.length > 0) {
    parts.push(`- Workflow: ${toolParts.join(", ")}`)
  }

  return parts.join("\n")
}

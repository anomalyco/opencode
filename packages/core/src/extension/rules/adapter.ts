export * as RulesAdapter from "./adapter.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { ConfigMarkdown } from "../../config/markdown.js"

export interface AdaptedRule {
  readonly id: string
  readonly name: string
  readonly sourcePath: string
  readonly originPlatform: "opencode" | "claude" | "cursor" | "antigravity" | "codex" | "custom"
  readonly scope: "global" | "project" | "scoped"
  readonly globs?: string[]
  readonly alwaysApply: boolean
  readonly content: string
  readonly precedence: number // Lower number = higher priority
}

/**
 * Parses a single Cursor .mdc rule file with frontmatter (globs, description, alwaysApply).
 */
export function parseCursorMdc(filePath: string, content: string): AdaptedRule {
  const parsed = ConfigMarkdown.parseOption(content)
  const data = (parsed?.data ?? {}) as Record<string, unknown>
  const id = path.basename(filePath, ".mdc")
  const description = typeof data.description === "string" ? data.description : id

  let globs: string[] | undefined
  if (Array.isArray(data.globs)) {
    globs = data.globs.map(String)
  } else if (typeof data.globs === "string") {
    globs = data.globs.split(",").map((g) => g.trim()).filter((g) => g.length > 0)
  }

  const alwaysApply = data.alwaysApply === true || (globs === undefined || globs.length === 0)

  return {
    id: `cursor-rule-${id}`,
    name: description,
    sourcePath: filePath,
    originPlatform: "cursor",
    scope: "project",
    globs,
    alwaysApply,
    content: parsed?.content ?? content,
    precedence: globs && globs.length > 0 ? 10 : 20,
  }
}

/**
 * Parses a CLAUDE.md instruction file.
 */
export function parseClaudeMd(filePath: string, content: string): AdaptedRule {
  return {
    id: "claude-instructions",
    name: "Claude Code Guidelines",
    sourcePath: filePath,
    originPlatform: "claude",
    scope: "project",
    alwaysApply: true,
    content,
    precedence: 30,
  }
}

/**
 * Parses an AGENTS.md instruction file.
 */
export function parseAgentsMd(filePath: string, content: string, scope: "global" | "project" | "scoped" = "project"): AdaptedRule {
  return {
    id: scope === "global" ? "global-agents" : "project-agents",
    name: "Agent Instructions (AGENTS.md)",
    sourcePath: filePath,
    originPlatform: "opencode",
    scope,
    alwaysApply: true,
    content,
    precedence: scope === "project" ? 25 : 50,
  }
}

/**
 * Parses a legacy .cursorrules file.
 */
export function parseCursorrules(filePath: string, content: string): AdaptedRule {
  return {
    id: "cursorrules-legacy",
    name: "Cursor Rules (.cursorrules)",
    sourcePath: filePath,
    originPlatform: "cursor",
    scope: "project",
    alwaysApply: true,
    content,
    precedence: 35,
  }
}

/**
 * Discovers and adapts all rules present in a workspace directory.
 */
export const discoverRules = Effect.fn("RulesAdapter.discoverRules")(function* (workspaceDir: string) {
  const fs = yield* FSUtil.Service
  const rules: AdaptedRule[] = []

  // 1. Check AGENTS.md
  const agentsPath = path.join(workspaceDir, "AGENTS.md")
  const agentsContent = yield* fs.readFileStringSafe(agentsPath).pipe(Effect.orElseSucceed(() => undefined))
  if (agentsContent) {
    rules.push(parseAgentsMd(agentsPath, agentsContent, "project"))
  }

  // 2. Check CLAUDE.md
  const claudePath = path.join(workspaceDir, "CLAUDE.md")
  const claudeContent = yield* fs.readFileStringSafe(claudePath).pipe(Effect.orElseSucceed(() => undefined))
  if (claudeContent) {
    rules.push(parseClaudeMd(claudePath, claudeContent))
  }

  // 3. Check .cursorrules
  const cursorrulesPath = path.join(workspaceDir, ".cursorrules")
  const cursorrulesContent = yield* fs.readFileStringSafe(cursorrulesPath).pipe(Effect.orElseSucceed(() => undefined))
  if (cursorrulesContent) {
    rules.push(parseCursorrules(cursorrulesPath, cursorrulesContent))
  }

  // 4. Check .cursor/rules/*.mdc
  const cursorRulesDir = path.join(workspaceDir, ".cursor", "rules")
  const mdcFiles = yield* fs.scan("*.mdc", {
    cwd: cursorRulesDir,
    absolute: true,
    include: "file",
  }).pipe(Effect.orElseSucceed(() => []))

  for (const mdc of mdcFiles) {
    const content = yield* fs.readFileStringSafe(mdc).pipe(Effect.orElseSucceed(() => undefined))
    if (content) {
      rules.push(parseCursorMdc(mdc, content))
    }
  }

  // Sort by precedence (lower number = higher priority)
  rules.sort((a, b) => a.precedence - b.precedence)

  return rules
})

function globToRegex(pattern: string): RegExp {
  let p = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  p = p.replace(/\*\*\//g, "(?:.*/)?")
  p = p.replace(/\*\*/g, ".*")
  p = p.replace(/\*/g, "[^/]*")
  return new RegExp(`^${p}$`, "i")
}

/**
 * Composes model-visible instruction text from a set of rules, optionally filtering by active file.
 */
export function formatInstructions(rules: ReadonlyArray<AdaptedRule>, activeFilePath?: string): string {
  const applicable = rules.filter((rule) => {
    if (rule.alwaysApply || !rule.globs || rule.globs.length === 0) return true
    if (!activeFilePath) return false
    const normalized = activeFilePath.replace(/\\/g, "/")
    return rule.globs.some((pattern) => {
      const regex = globToRegex(pattern)
      return regex.test(normalized) || regex.test(path.basename(normalized))
    })
  })

  if (applicable.length === 0) return ""

  const sections = applicable.map((rule) => {
    return [
      `<!-- Instruction Source: [${rule.originPlatform.toUpperCase()}] ${rule.name} (${rule.sourcePath}) -->`,
      rule.content.trim(),
    ].join("\n")
  })

  return sections.join("\n\n---\n\n")
}

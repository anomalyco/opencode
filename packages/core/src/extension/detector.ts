export * as ExtensionDetector from "./detector.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import type { Extension } from "@opencode/schema/extension"

export interface DetectionResult {
  readonly platform: Extension.Platform
  readonly category: Extension.Category
  readonly confidence: number // 0.0 to 1.0
  readonly details: string
}

export const detect = Effect.fn("ExtensionDetector.detect")(function* (directoryOrFile: string) {
  const fs = yield* FSUtil.Service

  const stat = yield* fs.stat(directoryOrFile).pipe(Effect.orElseSucceed(() => undefined))
  if (!stat) {
    return {
      platform: "custom" as const,
      category: "skill" as const,
      confidence: 0,
      details: "Path not found",
    }
  }

  const isFile = stat.type === "File"
  const directory = isFile ? path.dirname(directoryOrFile) : directoryOrFile
  const filename = isFile ? path.basename(directoryOrFile) : ""

  // 1. Direct file matching
  if (isFile) {
    if (filename === "CLAUDE.md") {
      return { platform: "claude" as const, category: "rule" as const, confidence: 1.0, details: "CLAUDE.md file" }
    }
    if (filename === "AGENTS.md") {
      return { platform: "opencode" as const, category: "rule" as const, confidence: 0.9, details: "AGENTS.md file" }
    }
    if (filename === ".cursorrules" || filename.endsWith(".mdc")) {
      return { platform: "cursor" as const, category: "rule" as const, confidence: 1.0, details: "Cursor rule file" }
    }
    if (filename === "claude_desktop_config.json") {
      return { platform: "claude" as const, category: "mcp" as const, confidence: 1.0, details: "Claude Desktop MCP configuration" }
    }
    if (filename === "SKILL.md") {
      const content = (yield* fs.readFileStringSafe(directoryOrFile).pipe(Effect.orElseSucceed(() => ""))) ?? ""
      const isAntigravity = content.includes("scripts/") || content.includes("references/") || content.includes("resources/")
      return {
        platform: isAntigravity ? ("antigravity" as const) : ("opencode" as const),
        category: "skill" as const,
        confidence: 0.95,
        details: isAntigravity ? "Antigravity SKILL.md specification" : "Standard SKILL.md",
      }
    }
  }

  // 2. Directory inspection
  const hasClaudeDir = yield* fs.exists(path.join(directory, ".claude")).pipe(Effect.orElseSucceed(() => false))
  const hasClaudeMd = yield* fs.exists(path.join(directory, "CLAUDE.md")).pipe(Effect.orElseSucceed(() => false))
  if (hasClaudeDir || hasClaudeMd) {
    const hasClaudeSkills = yield* fs.exists(path.join(directory, ".claude", "skills")).pipe(Effect.orElseSucceed(() => false))
    return {
      platform: "claude" as const,
      category: hasClaudeSkills ? ("skill" as const) : ("rule" as const),
      confidence: 0.95,
      details: "Claude Code environment detected",
    }
  }

  const hasCursorRules = yield* fs.exists(path.join(directory, ".cursor", "rules")).pipe(Effect.orElseSucceed(() => false))
  const hasCursorRulesFile = yield* fs.exists(path.join(directory, ".cursorrules")).pipe(Effect.orElseSucceed(() => false))
  if (hasCursorRules || hasCursorRulesFile) {
    return {
      platform: "cursor" as const,
      category: "rule" as const,
      confidence: 0.95,
      details: "Cursor rules environment detected",
    }
  }

  const hasSkillMd = yield* fs.exists(path.join(directory, "SKILL.md")).pipe(Effect.orElseSucceed(() => false))
  if (hasSkillMd) {
    const hasScripts = yield* fs.exists(path.join(directory, "scripts")).pipe(Effect.orElseSucceed(() => false))
    const hasReferences = yield* fs.exists(path.join(directory, "references")).pipe(Effect.orElseSucceed(() => false))
    const hasResources = yield* fs.exists(path.join(directory, "resources")).pipe(Effect.orElseSucceed(() => false))
    if (hasScripts || hasReferences || hasResources) {
      return {
        platform: "antigravity" as const,
        category: "skill" as const,
        confidence: 0.9,
        details: "Antigravity multi-directory skill package",
      }
    }
    return {
      platform: "opencode" as const,
      category: "skill" as const,
      confidence: 0.9,
      details: "Standard OpenCode skill package",
    }
  }

  // Check package.json for plugin manifests
  const pkgPath = path.join(directory, "package.json")
  const hasPkg = yield* fs.exists(pkgPath).pipe(Effect.orElseSucceed(() => false))
  if (hasPkg) {
    const pkgContent = yield* fs.readFileStringSafe(pkgPath).pipe(Effect.orElseSucceed(() => undefined))
    if (pkgContent) {
      try {
        const json = JSON.parse(pkgContent)
        if (json.dependencies?.["@opencode/plugin"] || json.peerDependencies?.["@opencode/plugin"]) {
          return {
            platform: "opencode" as const,
            category: "plugin" as const,
            confidence: 1.0,
            details: "Native OpenCode plugin package",
          }
        }
      } catch {
        // ignore parse error
      }
    }
  }

  // Default fallback
  return {
    platform: "custom" as const,
    category: "skill" as const,
    confidence: 0.5,
    details: "Generic agent extension package",
  }
})

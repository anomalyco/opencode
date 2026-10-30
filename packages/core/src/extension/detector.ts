export * as ExtensionDetector from "./detector.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Hash } from "@opencode/util/hash"
import type { Extension } from "@opencode/schema/extension"
import { ExtensionSecurity } from "./security.js"

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
    if (filename === "cursor_mcp.json") {
      return { platform: "cursor" as const, category: "mcp" as const, confidence: 1.0, details: "Cursor MCP configuration" }
    }
    if (filename === "codex.json") {
      return { platform: "codex" as const, category: "plugin" as const, confidence: 1.0, details: "OpenAI Codex manifest" }
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
  // Codex detection
  const hasCodexDir = yield* fs.exists(path.join(directory, ".codex")).pipe(Effect.orElseSucceed(() => false))
  const hasCodexJson = yield* fs.exists(path.join(directory, "codex.json")).pipe(Effect.orElseSucceed(() => false))
  if (hasCodexDir || hasCodexJson) {
    return {
      platform: "codex" as const,
      category: "skill" as const,
      confidence: 0.95,
      details: "OpenAI Codex environment detected",
    }
  }

  // Claude Code detection
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

  // Cursor detection
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

  // Skill detection
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

  // Antigravity plugin manifest detection
  const hasAntigravityPlugin = yield* fs.exists(path.join(directory, "plugin.json")).pipe(Effect.orElseSucceed(() => false))
  const hasAntigravityDir = yield* fs.exists(path.join(directory, ".gemini")).pipe(Effect.orElseSucceed(() => false))
  if (hasAntigravityPlugin || hasAntigravityDir) {
    return {
      platform: "antigravity" as const,
      category: "plugin" as const,
      confidence: 0.95,
      details: "Google Antigravity plugin package",
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

/**
 * Decomposes an extension package into individual CIR components.
 * For instance, an Antigravity bundle containing skills, MCP configs, rules, and hooks
 * is decomposed into discrete components while maintaining package relationship via `packageId`.
 */
export const decomposePackage = Effect.fn("ExtensionDetector.decomposePackage")(function* (
  directory: string,
  source: Extension.Source,
  targetScope: Extension.Scope = "project",
) {
  const fs = yield* FSUtil.Service
  const security = yield* ExtensionSecurity.scanDirectory(directory)

  const detection = yield* detect(directory)
  const primaryPlatform = detection.platform
  const packageId = `pkg_${Hash.fast(`${source.location}-${source.ref ?? "latest"}`)}`

  const components: Extension.CIR[] = []

  // 1. Discover skills (top-level or in subdirectories such as skills/* or skill/*)
  const topSkill = path.join(directory, "SKILL.md")
  if (yield* fs.exists(topSkill).pipe(Effect.orElseSucceed(() => false))) {
    components.push({
      id: `${packageId}_skill_main`,
      packageId,
      name: path.basename(directory),
      version: "1.0.0",
      category: "skill" as const,
      originPlatform: primaryPlatform,
      source: { ...source, subpath: source.subpath ? path.join(source.subpath, "SKILL.md") : "SKILL.md" },
      scope: targetScope,
      description: `Skill from ${path.basename(directory)}`,
      permissions: { filesystem: ["read"] },
      status: "installed" as const,
      enabled: true,
      executionMode: "native" as const,
      security,
      metadata: { file: "SKILL.md" },
    })
  }

  // Scan skills/ directory
  const skillsDir = path.join(directory, "skills")
  if (yield* fs.exists(skillsDir).pipe(Effect.orElseSucceed(() => false))) {
    const entries = yield* fs.readDirectoryEntries(skillsDir).pipe(Effect.orElseSucceed(() => []))
    for (const entry of entries) {
      if (entry.type === "directory") {
        const subSkillPath = path.join(skillsDir, entry.name, "SKILL.md")
        if (yield* fs.exists(subSkillPath).pipe(Effect.orElseSucceed(() => false))) {
          components.push({
            id: `${packageId}_skill_${entry.name}`,
            packageId,
            name: entry.name,
            version: "1.0.0",
            category: "skill" as const,
            originPlatform: primaryPlatform,
            source: { ...source, subpath: path.join("skills", entry.name) },
            scope: targetScope,
            description: `Sub-skill ${entry.name} from package`,
            permissions: { filesystem: ["read"] },
            status: "installed" as const,
            enabled: true,
            executionMode: "native" as const,
            security,
            metadata: { relativePath: path.join("skills", entry.name) },
          })
        }
      }
    }
  }

  // 2. Discover MCP server configurations
  const claudeMcp = path.join(directory, "claude_desktop_config.json")
  const cursorMcp = path.join(directory, "cursor_mcp.json")
  const standardMcp = path.join(directory, ".mcp.json")

  if (yield* fs.exists(claudeMcp).pipe(Effect.orElseSucceed(() => false))) {
    components.push({
      id: `${packageId}_mcp_claude`,
      packageId,
      name: `${path.basename(directory)}-mcp`,
      version: "1.0.0",
      category: "mcp" as const,
      originPlatform: "claude" as const,
      source: { ...source, subpath: "claude_desktop_config.json" },
      scope: targetScope,
      description: "MCP configuration imported from Claude Desktop format",
      permissions: { network: ["*"], commands: ["*"] },
      status: "installed" as const,
      enabled: true,
      executionMode: "native" as const,
      security,
      metadata: { configFormat: "claude_desktop" },
    })
  }

  if (yield* fs.exists(cursorMcp).pipe(Effect.orElseSucceed(() => false))) {
    components.push({
      id: `${packageId}_mcp_cursor`,
      packageId,
      name: `${path.basename(directory)}-mcp`,
      version: "1.0.0",
      category: "mcp" as const,
      originPlatform: "cursor" as const,
      source: { ...source, subpath: "cursor_mcp.json" },
      scope: targetScope,
      description: "MCP configuration imported from Cursor format",
      permissions: { network: ["*"], commands: ["*"] },
      status: "installed" as const,
      enabled: true,
      executionMode: "native" as const,
      security,
      metadata: { configFormat: "cursor" },
    })
  }

  if (yield* fs.exists(standardMcp).pipe(Effect.orElseSucceed(() => false))) {
    components.push({
      id: `${packageId}_mcp_standard`,
      packageId,
      name: `${path.basename(directory)}-mcp`,
      version: "1.0.0",
      category: "mcp" as const,
      originPlatform: "opencode" as const,
      source: { ...source, subpath: ".mcp.json" },
      scope: targetScope,
      description: "Standard MCP server configuration",
      permissions: { network: ["*"], commands: ["*"] },
      status: "installed" as const,
      enabled: true,
      executionMode: "native" as const,
      security,
      metadata: { configFormat: "opencode" },
    })
  }

  // 3. Discover rules (AGENTS.md, CLAUDE.md, .cursorrules, .cursor/rules/*.mdc)
  const agentsMd = path.join(directory, "AGENTS.md")
  const claudeMd = path.join(directory, "CLAUDE.md")
  const cursorRules = path.join(directory, ".cursorrules")
  const cursorRulesDir = path.join(directory, ".cursor", "rules")

  if (yield* fs.exists(agentsMd).pipe(Effect.orElseSucceed(() => false))) {
    components.push({
      id: `${packageId}_rule_agents`,
      packageId,
      name: "AGENTS.md",
      version: "1.0.0",
      category: "rule" as const,
      originPlatform: "opencode" as const,
      source: { ...source, subpath: "AGENTS.md" },
      scope: targetScope,
      description: "OpenCode instruction ruleset",
      permissions: {},
      status: "installed" as const,
      enabled: true,
      executionMode: "native" as const,
      security,
      metadata: { ruleType: "AGENTS.md" },
    })
  }

  if (yield* fs.exists(claudeMd).pipe(Effect.orElseSucceed(() => false))) {
    components.push({
      id: `${packageId}_rule_claude`,
      packageId,
      name: "CLAUDE.md",
      version: "1.0.0",
      category: "rule" as const,
      originPlatform: "claude" as const,
      source: { ...source, subpath: "CLAUDE.md" },
      scope: targetScope,
      description: "Claude Code instructions",
      permissions: {},
      status: "installed" as const,
      enabled: true,
      executionMode: "native" as const,
      security,
      metadata: { ruleType: "CLAUDE.md" },
    })
  }

  if (yield* fs.exists(cursorRules).pipe(Effect.orElseSucceed(() => false))) {
    components.push({
      id: `${packageId}_rule_cursor`,
      packageId,
      name: ".cursorrules",
      version: "1.0.0",
      category: "rule" as const,
      originPlatform: "cursor" as const,
      source: { ...source, subpath: ".cursorrules" },
      scope: targetScope,
      description: "Cursor workspace rules",
      permissions: {},
      status: "installed" as const,
      enabled: true,
      executionMode: "native" as const,
      security,
      metadata: { ruleType: ".cursorrules" },
    })
  }

  if (yield* fs.exists(cursorRulesDir).pipe(Effect.orElseSucceed(() => false))) {
    const entries = yield* fs.readDirectoryEntries(cursorRulesDir).pipe(Effect.orElseSucceed(() => []))
    for (const entry of entries) {
      if (entry.name.endsWith(".mdc")) {
        components.push({
          id: `${packageId}_rule_${path.basename(entry.name, ".mdc")}`,
          packageId,
          name: entry.name,
          version: "1.0.0",
          category: "rule" as const,
          originPlatform: "cursor" as const,
          source: { ...source, subpath: path.join(".cursor", "rules", entry.name) },
          scope: targetScope,
          description: `Cursor MDC rule: ${entry.name}`,
          permissions: {},
          status: "installed" as const,
          enabled: true,
          executionMode: "native" as const,
          security,
          metadata: { ruleType: "mdc", file: entry.name },
        })
      }
    }
  }

  // 4. Discover plugin packages
  const pkgJsonPath = path.join(directory, "package.json")
  if (yield* fs.exists(pkgJsonPath).pipe(Effect.orElseSucceed(() => false))) {
    const content = yield* fs.readFileStringSafe(pkgJsonPath).pipe(Effect.orElseSucceed(() => undefined))
    if (content) {
      try {
        const pkg = JSON.parse(content)
        const isNative = Boolean(pkg.dependencies?.["@opencode/plugin"] || pkg.peerDependencies?.["@opencode/plugin"])
        components.push({
          id: `${packageId}_plugin_${pkg.name || "main"}`,
          packageId,
          name: pkg.name || path.basename(directory),
          version: pkg.version || "1.0.0",
          category: "plugin" as const,
          originPlatform: isNative ? ("opencode" as const) : primaryPlatform,
          source,
          scope: targetScope,
          description: pkg.description || `Plugin package ${pkg.name}`,
          permissions: { filesystem: ["read", "write"], commands: ["*"] },
          status: "installed" as const,
          enabled: true,
          executionMode: isNative ? ("native" as const) : ("shim" as const),
          security,
          metadata: { entry: pkg.main || pkg.module || "index.js" },
        })
      } catch {
        // ignore parse error
      }
    }
  }

  // Read optional manifest
  let manifest: Record<string, unknown> | undefined = undefined
  const antigravityJson = path.join(directory, "plugin.json")
  if (yield* fs.exists(antigravityJson).pipe(Effect.orElseSucceed(() => false))) {
    const raw = yield* fs.readFileStringSafe(antigravityJson).pipe(Effect.orElseSucceed(() => undefined))
    if (raw) {
      try {
        manifest = JSON.parse(raw)
      } catch {
        // ignore
      }
    }
  }

  const result: Extension.PackageInspectionResult = {
    source,
    primaryPlatform,
    manifest,
    components,
    security,
  }

  return result
})

/**
 * Claude Code Skill System - Skill Loader
 *
 * Handles discovery and progressive loading of skills with token optimization
 */

import { readdir, readFile, stat } from "fs/promises"
import { join, resolve } from "path"
import { homedir } from "os"
import yaml from "yaml"
import type {
  SkillFrontmatter,
  SkillMetadata,
  LoadedSkill,
  SkillSystemConfig,
  SkillLoadOptions,
  ToolName,
} from "./types"

/**
 * Parses YAML frontmatter from markdown content
 */
function extractFrontmatter(content: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    throw new Error("No YAML frontmatter found in SKILL.md")
  }

  const [, frontmatterYaml, body] = match
  const frontmatter = yaml.parse(frontmatterYaml)

  return { frontmatter, body: body.trim() }
}

/**
 * Estimates token count for text (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Validates skill frontmatter structure
 */
function validateFrontmatter(frontmatter: unknown): SkillFrontmatter {
  if (!frontmatter || typeof frontmatter !== "object") {
    throw new Error("Invalid frontmatter: must be an object")
  }

  const fm = frontmatter as Record<string, unknown>

  if (!fm.name || typeof fm.name !== "string") {
    throw new Error('Invalid frontmatter: missing or invalid "name" field')
  }

  if (!fm.description || typeof fm.description !== "string") {
    throw new Error('Invalid frontmatter: missing or invalid "description" field')
  }

  const validated: SkillFrontmatter = {
    name: fm.name,
    description: fm.description,
  }

  // Validate allowed-tools if present
  if (fm.allowedTools || fm["allowed-tools"]) {
    const tools = (fm.allowedTools || fm["allowed-tools"]) as unknown
    if (Array.isArray(tools)) {
      validated.allowedTools = tools as ToolName[]
    }
  }

  // Preserve other metadata
  Object.keys(fm).forEach((key) => {
    if (
      key !== "name" &&
      key !== "description" &&
      key !== "allowedTools" &&
      key !== "allowed-tools"
    ) {
      validated[key] = fm[key]
    }
  })

  return validated
}

/**
 * SkillLoader - Progressive skill discovery and loading
 *
 * Two-phase operation:
 * 1. Discovery: Load only frontmatter (lightweight)
 * 2. Activation: Load full content only when needed
 */
export class SkillLoader {
  private config: Required<SkillSystemConfig>
  private discoveredSkills: Map<string, SkillMetadata> = new Map()
  private loadedSkills: Map<string, LoadedSkill> = new Map()
  private debug: boolean

  constructor(config: SkillSystemConfig = {}) {
    this.config = {
      projectSkillsPath: config.projectSkillsPath || ".opencode/skills",
      userSkillsPath: config.userSkillsPath || join(homedir(), ".opencode", "skills"),
      loadPluginSkills: config.loadPluginSkills ?? false,
      pluginSkillsPaths: config.pluginSkillsPaths || [],
      minConfidenceThreshold: config.minConfidenceThreshold ?? 0.6,
      maxActiveSkills: config.maxActiveSkills ?? 3,
      debug: config.debug ?? false,
    }
    this.debug = this.config.debug
  }

  /**
   * Phase 1: Discover all skills (load frontmatter only)
   * Returns lightweight metadata for all available skills
   */
  async discoverSkills(): Promise<SkillMetadata[]> {
    this.log("Starting skill discovery...")
    this.discoveredSkills.clear()

    // Check both .opencode and .claude paths for compatibility
    const projectPaths = [".opencode/skills", ".claude/skills"]
    const userPaths = [join(homedir(), ".opencode", "skills"), join(homedir(), ".claude", "skills")]

    this.log(`Checking project paths: ${projectPaths.join(", ")}`)
    this.log(`Checking user paths: ${userPaths.join(", ")}`)

    const discoveries = await Promise.allSettled([
      // Project skills from both .opencode and .claude
      ...projectPaths.map((path) => this.discoverFromPath(path, "project")),
      // User skills from both ~/.opencode and ~/.claude
      ...userPaths.map((path) => this.discoverFromPath(path, "user")),
      // Plugin skills if enabled
      ...(this.config.loadPluginSkills
        ? this.config.pluginSkillsPaths.map((path) => this.discoverFromPath(path, "plugin"))
        : []),
    ])

    // Collect all successful discoveries, removing duplicates by name
    const skillsMap = new Map<string, SkillMetadata>()
    for (const result of discoveries) {
      if (result.status === "fulfilled") {
        for (const skill of result.value) {
          // Prefer .opencode over .claude if duplicate names
          const existing = skillsMap.get(skill.frontmatter.name)
          if (!existing || skill.path.includes(".opencode")) {
            skillsMap.set(skill.frontmatter.name, skill)
          }
        }
      } else {
        this.log(`Discovery failed: ${result.reason}`, "warn")
      }
    }

    const skills = Array.from(skillsMap.values())
    this.log(`Discovered ${skills.length} skills`)
    return skills
  }

  /**
   * Discover skills from a specific path
   */
  private async discoverFromPath(
    basePath: string,
    source: "project" | "user" | "plugin",
  ): Promise<SkillMetadata[]> {
    try {
      const absolutePath = resolve(basePath)
      const stats = await stat(absolutePath)

      if (!stats.isDirectory()) {
        this.log(`Path ${absolutePath} is not a directory`, "warn")
        return []
      }

      const entries = await readdir(absolutePath, { withFileTypes: true })
      const skillDirs = entries.filter((e) => e.isDirectory())

      const skills = await Promise.all(
        skillDirs.map((dir) => this.loadSkillMetadata(join(absolutePath, dir.name), source)),
      )

      return skills.filter((s): s is SkillMetadata => s !== null)
    } catch (error) {
      this.log(`Failed to discover skills from ${basePath}: ${error}`, "warn")
      return []
    }
  }

  /**
   * Load skill metadata (frontmatter only, no content)
   */
  private async loadSkillMetadata(
    skillPath: string,
    source: "project" | "user" | "plugin",
  ): Promise<SkillMetadata | null> {
    try {
      const skillFilePath = join(skillPath, "SKILL.md")
      const content = await readFile(skillFilePath, "utf-8")

      const { frontmatter } = extractFrontmatter(content)
      const validated = validateFrontmatter(frontmatter)

      // Check for supporting files (without loading them)
      const [hasReference, hasExamples, hasScripts, hasTemplates] = await Promise.all([
        this.fileExists(join(skillPath, "reference.md")),
        this.fileExists(join(skillPath, "examples.md")),
        this.dirExists(join(skillPath, "scripts")),
        this.dirExists(join(skillPath, "templates")),
      ])

      const metadata: SkillMetadata = {
        frontmatter: validated,
        path: skillPath,
        skillFilePath,
        source,
        hasReference,
        hasExamples,
        hasScripts,
        hasTemplates,
      }

      this.discoveredSkills.set(validated.name, metadata)
      this.log(`Loaded metadata for skill: ${validated.name} (${source})`)

      return metadata
    } catch (error) {
      this.log(`Failed to load skill from ${skillPath}: ${error}`, "error")
      return null
    }
  }

  /**
   * Phase 2: Fully load a skill (content + supporting files)
   * Only called when skill is activated
   */
  async loadSkill(skillName: string, options: SkillLoadOptions = {}): Promise<LoadedSkill | null> {
    // Check if already loaded
    if (this.loadedSkills.has(skillName)) {
      this.log(`Skill ${skillName} already loaded, returning cached version`)
      return this.loadedSkills.get(skillName)!
    }

    const metadata = this.discoveredSkills.get(skillName)
    if (!metadata) {
      this.log(`Skill ${skillName} not found in discovered skills`, "error")
      return null
    }

    try {
      this.log(`Loading full content for skill: ${skillName}`)

      // Load SKILL.md content
      const skillContent = await readFile(metadata.skillFilePath, "utf-8")
      const { body } = extractFrontmatter(skillContent)

      const loaded: LoadedSkill = {
        ...metadata,
        content: body,
        estimatedTokens: estimateTokens(body),
      }

      // Load reference.md if requested and exists
      if (options.loadReference !== false && metadata.hasReference) {
        const refPath = join(metadata.path, "reference.md")
        const refContent = await readFile(refPath, "utf-8")
        loaded.reference = refContent
        loaded.estimatedTokens += estimateTokens(refContent)
      }

      // Load examples.md if requested and exists
      if (options.loadExamples !== false && metadata.hasExamples) {
        const examplesPath = join(metadata.path, "examples.md")
        const examplesContent = await readFile(examplesPath, "utf-8")
        loaded.examples = examplesContent
        loaded.estimatedTokens += estimateTokens(examplesContent)
      }

      // List scripts if requested and exist
      if (options.loadScripts !== false && metadata.hasScripts) {
        const scriptsDir = join(metadata.path, "scripts")
        const scriptFiles = await readdir(scriptsDir)
        loaded.scripts = scriptFiles.map((f) => join(scriptsDir, f))
      }

      // List templates if requested and exist
      if (options.loadTemplates !== false && metadata.hasTemplates) {
        const templatesDir = join(metadata.path, "templates")
        const templateFiles = await readdir(templatesDir)
        loaded.templates = templateFiles.map((f) => join(templatesDir, f))
      }

      // Check token limit
      if (options.maxTokens && loaded.estimatedTokens > options.maxTokens) {
        this.log(
          `Skill ${skillName} exceeds token limit: ${loaded.estimatedTokens} > ${options.maxTokens}`,
          "warn",
        )
      }

      this.loadedSkills.set(skillName, loaded)
      this.log(`Loaded skill ${skillName}: ~${loaded.estimatedTokens} tokens`)

      return loaded
    } catch (error) {
      this.log(`Failed to load skill ${skillName}: ${error}`, "error")
      return null
    }
  }

  /**
   * Get a skill's metadata (lightweight, already loaded)
   */
  getSkillMetadata(skillName: string): SkillMetadata | undefined {
    return this.discoveredSkills.get(skillName)
  }

  /**
   * Get all discovered skills
   */
  getAllSkills(): SkillMetadata[] {
    return Array.from(this.discoveredSkills.values())
  }

  /**
   * Get all loaded skills
   */
  getLoadedSkills(): LoadedSkill[] {
    return Array.from(this.loadedSkills.values())
  }

  /**
   * Unload a skill to free tokens
   */
  unloadSkill(skillName: string): boolean {
    const deleted = this.loadedSkills.delete(skillName)
    if (deleted) {
      this.log(`Unloaded skill: ${skillName}`)
    }
    return deleted
  }

  /**
   * Clear all loaded skills
   */
  clearLoadedSkills(): void {
    const count = this.loadedSkills.size
    this.loadedSkills.clear()
    this.log(`Cleared ${count} loaded skills`)
  }

  /**
   * Get total estimated tokens for all loaded skills
   */
  getTotalTokens(): number {
    return Array.from(this.loadedSkills.values()).reduce(
      (sum, skill) => sum + skill.estimatedTokens,
      0,
    )
  }

  /**
   * Helper: Check if file exists
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      const stats = await stat(path)
      return stats.isFile()
    } catch {
      return false
    }
  }

  /**
   * Helper: Check if directory exists
   */
  private async dirExists(path: string): Promise<boolean> {
    try {
      const stats = await stat(path)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Debug logging
   */
  private log(message: string, level: "info" | "warn" | "error" = "info"): void {
    if (!this.debug && level === "info") return

    const prefix = "[SkillLoader]"
    switch (level) {
      case "warn":
        console.warn(`${prefix} ${message}`)
        break
      case "error":
        console.error(`${prefix} ${message}`)
        break
      default:
        console.log(`${prefix} ${message}`)
    }
  }
}

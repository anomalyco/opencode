/**
 * Skills System Plugin
 * 
 * Provides Claude-style skill discovery, matching, and execution with progressive disclosure.
 * 
 * Features:
 * - Discovers SKILL.md files from .opencode/skills and ~/.claude/skills
 * - Matches skills to user requests using keyword/phrase analysis
 * - Activates skills and injects their content into LLM prompts
 * - Enforces tool restrictions per skill
 * - Progressive loading to optimize token usage
 */

import { type Plugin } from "@opencode-ai/plugin"
import { readdir, readFile, stat } from "fs/promises"
import { join, resolve } from "path"
import { homedir } from "os"
import yaml from "yaml"
import { EventEmitter } from "events"

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type ToolName =
  | "Read"
  | "Write"
  | "Edit"
  | "Glob"
  | "Grep"
  | "Bash"
  | "WebFetch"
  | "WebSearch"
  | "Task"
  | "SlashCommand"
  | "Skill"
  | "TodoWrite"
  | "AskUserQuestion"
  | "NotebookEdit"
  | "KillShell"
  | "BashOutput"

interface SkillFrontmatter {
  name: string
  description: string
  allowedTools?: ToolName[]
  [key: string]: unknown
}

interface SkillMetadata {
  frontmatter: SkillFrontmatter
  path: string
  skillFilePath: string
  source: "project" | "user" | "plugin"
  hasReference: boolean
  hasExamples: boolean
  hasScripts: boolean
  hasTemplates: boolean
}

interface LoadedSkill extends SkillMetadata {
  content: string
  reference?: string
  examples?: string
  scripts?: string[]
  templates?: string[]
  estimatedTokens: number
}

interface SkillMatch {
  skill: SkillMetadata
  confidence: number
  reason: string
  matchedKeywords: string[]
}

interface SkillMatchOptions {
  request: string
  minConfidence?: number
  allowMultiple?: boolean
  context?: {
    currentFile?: string
    recentTools?: ToolName[]
    projectType?: string
  }
}

interface SkillSystemConfig {
  projectSkillsPath?: string
  userSkillsPath?: string
  loadPluginSkills?: boolean
  pluginSkillsPaths?: string[]
  minConfidenceThreshold?: number
  maxActiveSkills?: number
  debug?: boolean
}

interface SkillLoadOptions {
  loadReference?: boolean
  loadExamples?: boolean
  loadScripts?: boolean
  loadTemplates?: boolean
  maxTokens?: number
}

interface SkillExecutionContext {
  userRequest: string
  activeSkills: LoadedSkill[]
  restrictedTools: Set<ToolName>
  totalTokens: number
  metadata: {
    activatedAt: Date
    source: "automatic" | "explicit"
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

const ALL_TOOLS: ToolName[] = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "WebFetch",
  "WebSearch",
  "Task",
  "SlashCommand",
  "Skill",
  "TodoWrite",
  "AskUserQuestion",
  "NotebookEdit",
  "KillShell",
  "BashOutput",
]

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "been",
  "be",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "may",
  "might",
  "must",
  "can",
  "this",
  "that",
  "these",
  "those",
])

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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

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

  if (fm.allowedTools || fm["allowed-tools"]) {
    const tools = (fm.allowedTools || fm["allowed-tools"]) as unknown
    if (Array.isArray(tools)) {
      validated.allowedTools = tools as ToolName[]
    }
  }

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

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
}

function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter((x) => set2.has(x)))
  const union = new Set([...set1, ...set2])

  return union.size === 0 ? 0 : intersection.size / union.size
}

function keywordOverlap(requestKeywords: string[], descriptionKeywords: string[]): number {
  const requestSet = new Set(requestKeywords)
  const descSet = new Set(descriptionKeywords)

  return jaccardSimilarity(requestSet, descSet)
}

function phraseMatches(request: string, description: string): number {
  const requestLower = request.toLowerCase()
  const descLower = description.toLowerCase()

  const phrases = requestLower.match(/\b\w+\s+\w+(?:\s+\w+)?\b/g) || []

  const matches = phrases.filter((phrase) => descLower.includes(phrase))
  return matches.length / Math.max(phrases.length, 1)
}

// ============================================================================
// SKILL LOADER
// ============================================================================

class SkillLoader {
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

  async discoverSkills(): Promise<SkillMetadata[]> {
    this.log("Starting skill discovery...")
    this.discoveredSkills.clear()

    const projectPaths = [".opencode/skills", ".claude/skills"]
    const userPaths = [join(homedir(), ".opencode", "skills"), join(homedir(), ".claude", "skills")]

    this.log(`Checking project paths: ${projectPaths.join(", ")}`)
    this.log(`Checking user paths: ${userPaths.join(", ")}`)

    const discoveries = await Promise.allSettled([
      ...projectPaths.map((path) => this.discoverFromPath(path, "project")),
      ...userPaths.map((path) => this.discoverFromPath(path, "user")),
      ...(this.config.loadPluginSkills
        ? this.config.pluginSkillsPaths.map((path) => this.discoverFromPath(path, "plugin"))
        : []),
    ])

    const skillsMap = new Map<string, SkillMetadata>()
    for (const result of discoveries) {
      if (result.status === "fulfilled") {
        for (const skill of result.value) {
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
    } catch (error: any) {
      // Silently skip if directory doesn't exist
      if (error?.code === 'ENOENT') {
        return []
      }
      this.log(`Failed to discover skills from ${basePath}: ${error}`, "warn")
      return []
    }
  }

  private async loadSkillMetadata(
    skillPath: string,
    source: "project" | "user" | "plugin",
  ): Promise<SkillMetadata | null> {
    try {
      const skillFilePath = join(skillPath, "SKILL.md")
      const content = await readFile(skillFilePath, "utf-8")

      const { frontmatter } = extractFrontmatter(content)
      const validated = validateFrontmatter(frontmatter)

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

  async loadSkill(skillName: string, options: SkillLoadOptions = {}): Promise<LoadedSkill | null> {
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

      const skillContent = await readFile(metadata.skillFilePath, "utf-8")
      const { body } = extractFrontmatter(skillContent)

      const loaded: LoadedSkill = {
        ...metadata,
        content: body,
        estimatedTokens: estimateTokens(body),
      }

      if (options.loadReference !== false && metadata.hasReference) {
        const refPath = join(metadata.path, "reference.md")
        const refContent = await readFile(refPath, "utf-8")
        loaded.reference = refContent
        loaded.estimatedTokens += estimateTokens(refContent)
      }

      if (options.loadExamples !== false && metadata.hasExamples) {
        const examplesPath = join(metadata.path, "examples.md")
        const examplesContent = await readFile(examplesPath, "utf-8")
        loaded.examples = examplesContent
        loaded.estimatedTokens += estimateTokens(examplesContent)
      }

      if (options.loadScripts !== false && metadata.hasScripts) {
        const scriptsDir = join(metadata.path, "scripts")
        const scriptFiles = await readdir(scriptsDir)
        loaded.scripts = scriptFiles.map((f) => join(scriptsDir, f))
      }

      if (options.loadTemplates !== false && metadata.hasTemplates) {
        const templatesDir = join(metadata.path, "templates")
        const templateFiles = await readdir(templatesDir)
        loaded.templates = templateFiles.map((f) => join(templatesDir, f))
      }

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

  getSkillMetadata(skillName: string): SkillMetadata | undefined {
    return this.discoveredSkills.get(skillName)
  }

  getAllSkills(): SkillMetadata[] {
    return Array.from(this.discoveredSkills.values())
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      const stats = await stat(path)
      return stats.isFile()
    } catch {
      return false
    }
  }

  private async dirExists(path: string): Promise<boolean> {
    try {
      const stats = await stat(path)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  private log(message: string, level: "info" | "warn" | "error" = "info"): void {
    if (!this.debug && level === "info") return

    const prefix = "[SkillLoader]"
    switch (level) {
      case "warn":
       // console.warn(`${prefix} ${message}`)
        break
      case "error":
       // console.error(`${prefix} ${message}`)
        break
      default:
       // console.log(`${prefix} ${message}`)
    }
  }
}

// ============================================================================
// SKILL MATCHER
// ============================================================================

class SkillMatcher {
  private debug: boolean

  constructor(debug = false) {
    this.debug = debug
  }

  async matchSkills(
    skills: SkillMetadata[],
    options: SkillMatchOptions,
  ): Promise<SkillMatch[]> {
    const { request, minConfidence = 0.6, allowMultiple = true } = options

    this.log(`Matching request: "${request.substring(0, 100)}..."`)

    const requestKeywords = extractKeywords(request)
    this.log(`Extracted keywords: ${requestKeywords.join(", ")}`)

    const matches: SkillMatch[] = []

    for (const skill of skills) {
      const descriptionKeywords = extractKeywords(skill.frontmatter.description)

      const keywordScore = keywordOverlap(requestKeywords, descriptionKeywords)
      const phraseScore = phraseMatches(request, skill.frontmatter.description)

      const confidence = keywordScore * 0.7 + phraseScore * 0.3

      this.log(
        `Skill "${skill.frontmatter.name}": confidence=${confidence.toFixed(3)} ` +
          `(kw=${keywordScore.toFixed(2)}, ph=${phraseScore.toFixed(2)})`,
      )

      if (confidence >= minConfidence) {
        const matchedKeywords = requestKeywords.filter((kw) => descriptionKeywords.includes(kw))

        matches.push({
          skill,
          confidence,
          reason: this.generateMatchReason(skill, confidence, matchedKeywords),
          matchedKeywords,
        })
      }
    }

    matches.sort((a, b) => b.confidence - a.confidence)

    const result = allowMultiple ? matches : matches.slice(0, 1)

    this.log(`Found ${result.length} matching skills`)
    return result
  }

  filterActiveSkills(matches: SkillMatch[], activeSkillNames: string[]): SkillMatch[] {
    const activeSet = new Set(activeSkillNames)
    return matches.filter((m) => !activeSet.has(m.skill.frontmatter.name))
  }

  private generateMatchReason(
    skill: SkillMetadata,
    confidence: number,
    matchedKeywords: string[],
  ): string {
    const confidencePercent = Math.round(confidence * 100)
    const keywordList = matchedKeywords.slice(0, 5).join(", ")

    if (confidence > 0.8) {
      return `Strong match (${confidencePercent}%): keywords "${keywordList}" align well with skill description`
    } else if (confidence > 0.6) {
      return `Good match (${confidencePercent}%): found relevant keywords "${keywordList}"`
    } else {
      return `Moderate match (${confidencePercent}%): partial keyword overlap "${keywordList}"`
    }
  }

  private log(message: string): void {
    if (this.debug) {
      console.log(`[SkillMatcher] ${message}`)
    }
  }
}

// ============================================================================
// SKILL EXECUTOR
// ============================================================================

class SkillExecutor {
  private activeSkills: Map<string, LoadedSkill> = new Map()
  private restrictedTools: Set<ToolName> = new Set()
  private config: Required<SkillSystemConfig>
  private debug: boolean

  constructor(config: SkillSystemConfig = {}) {
    this.config = {
      projectSkillsPath: config.projectSkillsPath || ".claude/skills",
      userSkillsPath: config.userSkillsPath || "~/.claude/skills",
      loadPluginSkills: config.loadPluginSkills ?? false,
      pluginSkillsPaths: config.pluginSkillsPaths || [],
      minConfidenceThreshold: config.minConfidenceThreshold ?? 0.6,
      maxActiveSkills: config.maxActiveSkills ?? 3,
      debug: config.debug ?? false,
    }
    this.debug = this.config.debug
  }

  activateSkill(
    skill: LoadedSkill,
    userRequest: string,
    source: "automatic" | "explicit" = "automatic",
  ): SkillExecutionContext {
    if (
      this.activeSkills.size >= this.config.maxActiveSkills &&
      !this.activeSkills.has(skill.frontmatter.name)
    ) {
      this.log(
        `Cannot activate skill "${skill.frontmatter.name}": ` +
          `max active skills (${this.config.maxActiveSkills}) reached`,
        "warn",
      )
      const oldestSkill = this.activeSkills.keys().next().value
      if (oldestSkill) {
        this.deactivateSkill(oldestSkill)
      }
    }

    this.activeSkills.set(skill.frontmatter.name, skill)
    this.updateToolRestrictions()

    this.log(
      `Activated skill "${skill.frontmatter.name}" ` +
        `(~${skill.estimatedTokens} tokens, ${source})`,
    )

    return this.getExecutionContext(userRequest, source)
  }

  deactivateSkill(skillName: string): boolean {
    const skill = this.activeSkills.get(skillName)
    if (!skill) {
      return false
    }

    this.activeSkills.delete(skillName)
    this.updateToolRestrictions()

    this.log(`Deactivated skill "${skillName}" (~${skill.estimatedTokens} tokens freed)`)
    return true
  }

  deactivateAll(): number {
    const count = this.activeSkills.size
    this.activeSkills.clear()
    this.restrictedTools.clear()

    this.log(`Deactivated all skills (${count} total)`)
    return count
  }

  getExecutionContext(
    userRequest: string,
    source: "automatic" | "explicit" = "automatic",
  ): SkillExecutionContext {
    return {
      userRequest,
      activeSkills: Array.from(this.activeSkills.values()),
      restrictedTools: new Set(this.restrictedTools),
      totalTokens: this.getTotalTokens(),
      metadata: {
        activatedAt: new Date(),
        source,
      },
    }
  }

  getActiveSkills(): LoadedSkill[] {
    return Array.from(this.activeSkills.values())
  }

  isSkillActive(skillName: string): boolean {
    return this.activeSkills.has(skillName)
  }

  getTotalTokens(): number {
    return Array.from(this.activeSkills.values()).reduce(
      (sum, skill) => sum + skill.estimatedTokens,
      0,
    )
  }

  generateLLMContext(): string {
    if (this.activeSkills.size === 0) {
      return ""
    }

    const sections: string[] = []

    sections.push("# Active Skills\n")
    sections.push(`The following skills are currently active based on your request:\n`)

    for (const skill of this.activeSkills.values()) {
      sections.push(`## Skill: ${skill.frontmatter.name}\n`)
      sections.push(`**Description**: ${skill.frontmatter.description}\n`)

      if (skill.frontmatter.allowedTools) {
        sections.push(`**Allowed Tools**: ${skill.frontmatter.allowedTools.join(", ")}\n`)
      }

      sections.push(`\n${skill.content}\n`)

      if (skill.reference) {
        sections.push(`### Reference\n\n${skill.reference}\n`)
      }

      if (skill.examples) {
        sections.push(`### Examples\n\n${skill.examples}\n`)
      }

      sections.push(`---\n`)
    }

    if (this.restrictedTools.size > 0) {
      sections.push(`\n## Tool Restrictions\n`)
      sections.push(`The following tools are RESTRICTED and cannot be used:\n`)
      sections.push(`${Array.from(this.restrictedTools).map((t) => `- ${t}`).join("\n")}\n`)
    }

    return sections.join("\n")
  }

  private updateToolRestrictions(): void {
    const skillsWithRestrictions = Array.from(this.activeSkills.values()).filter(
      (skill) => skill.frontmatter.allowedTools,
    )

    if (skillsWithRestrictions.length === 0) {
      this.restrictedTools.clear()
      return
    }

    const allowedToolsSets = skillsWithRestrictions.map(
      (skill) => new Set(skill.frontmatter.allowedTools!),
    )

    const allowedTools = new Set<ToolName>()

    for (const tool of ALL_TOOLS) {
      if (allowedToolsSets.every((set) => set.has(tool))) {
        allowedTools.add(tool)
      }
    }

    this.restrictedTools = new Set(ALL_TOOLS.filter((tool) => !allowedTools.has(tool)))

    this.log(`Tool restrictions updated: ${this.restrictedTools.size} tools restricted`)
  }

  private log(message: string, level: "info" | "warn" | "error" = "info"): void {
    if (!this.debug && level === "info") return

    const prefix = "[SkillExecutor]"
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

// ============================================================================
// SKILL SYSTEM
// ============================================================================

class SkillSystem extends EventEmitter {
  private loader: SkillLoader
  private matcher: SkillMatcher
  private executor: SkillExecutor
  private initialized = false
  private config: Required<SkillSystemConfig>

  constructor(config: SkillSystemConfig = {}) {
    super()

    this.config = {
      projectSkillsPath: config.projectSkillsPath || ".opencode/skills",
      userSkillsPath: config.userSkillsPath || "~/.claude/skills",
      loadPluginSkills: config.loadPluginSkills ?? false,
      pluginSkillsPaths: config.pluginSkillsPaths || [],
      minConfidenceThreshold: config.minConfidenceThreshold ?? 0.6,
      maxActiveSkills: config.maxActiveSkills ?? 3,
      debug: config.debug ?? false,
    }

    this.loader = new SkillLoader(this.config)
    this.matcher = new SkillMatcher(this.config.debug)
    this.executor = new SkillExecutor(this.config)
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      console.warn("[SkillSystem] Already initialized")
      return
    }

    const skills = await this.loader.discoverSkills()
    this.initialized = true
   // console.log(`[SkillSystem] Initialized with ${skills.length} skills`)
  }

  async processRequest(
    request: string,
    options: Partial<SkillMatchOptions> = {},
  ): Promise<{
    matches: SkillMatch[]
    activated: LoadedSkill[]
    context: string
  }> {
    if (!this.initialized) {
      throw new Error("SkillSystem not initialized. Call initialize() first.")
    }

    const matchOptions: SkillMatchOptions = {
      request,
      minConfidence: options.minConfidence ?? this.config.minConfidenceThreshold,
      allowMultiple: options.allowMultiple ?? true,
      context: options.context,
    }

    const allSkills = this.loader.getAllSkills()
    const matches = await this.matcher.matchSkills(allSkills, matchOptions)

    const activeSkillNames = this.executor.getActiveSkills().map((s) => s.frontmatter.name)
    const newMatches = this.matcher.filterActiveSkills(matches, activeSkillNames)

    const activated: LoadedSkill[] = []

    for (const match of newMatches) {
      const loadedSkill = await this.loader.loadSkill(match.skill.frontmatter.name)

      if (loadedSkill) {
        this.executor.activateSkill(loadedSkill, request, "automatic")
        activated.push(loadedSkill)
      }
    }

    return {
      matches,
      activated,
      context: this.executor.generateLLMContext(),
    }
  }

  getActiveSkills(): LoadedSkill[] {
    return this.executor.getActiveSkills()
  }

  generatePrompt(): string {
    return this.executor.generateLLMContext()
  }
}

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

export const SkillsSystemPlugin: Plugin = async (ctx) => {
  const skillSystem = new SkillSystem({
    debug: false,
  })

  await skillSystem.initialize()

  return {
    "chat.messages": async (input, output) => {
      try {
        const result = await skillSystem.processRequest(input.userText)

        if (result.activated.length > 0) {
          const skillContext = skillSystem.generatePrompt()

          output.messages.unshift({
            role: "system",
            content: skillContext,
          })

          console.log(
            `[SkillsSystem] Activated ${result.activated.length} skill(s): ${result.activated.map((s) => s.frontmatter.name).join(", ")}`,
          )
        }
      } catch (error) {
        console.error("[SkillsSystem] Error processing request:", error)
      }
    },
  }
}

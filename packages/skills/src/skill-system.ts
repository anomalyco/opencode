/**
 * Claude Code Skill System - Main Orchestrator
 *
 * Combines loader, matcher, and executor into a complete skill system
 */

import { EventEmitter } from "events"
import { SkillLoader } from "./skill-loader"
import { SkillMatcher } from "./skill-matcher"
import { SkillExecutor } from "./skill-executor"
import type {
  SkillSystemConfig,
  SkillSystemStats,
  SkillMatch,
  SkillMatchOptions,
  SkillLoadOptions,
  SkillSystemEvents,
  LoadedSkill,
  SkillMetadata,
} from "./types"

/**
 * SkillSystem - Complete skill management system
 *
 * Orchestrates skill discovery, matching, loading, and execution
 * with progressive disclosure for token optimization.
 *
 * Usage:
 * ```ts
 * const system = new SkillSystem({ debug: true })
 * await system.initialize()
 *
 * // Automatic skill activation
 * const context = await system.processRequest("Create a React component")
 *
 * // Use the context to inject into LLM prompt
 * const prompt = system.generatePrompt()
 * ```
 */
export class SkillSystem extends EventEmitter {
  private loader: SkillLoader
  private matcher: SkillMatcher
  private executor: SkillExecutor
  private initialized = false
  private config: Required<SkillSystemConfig>
  private stats = {
    totalActivations: 0,
    confidenceScores: [] as number[],
  }

  constructor(config: SkillSystemConfig = {}) {
    super()

    this.config = {
      projectSkillsPath: config.projectSkillsPath || ".claude/skills",
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

  /**
   * Initialize the skill system (discover all skills)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.warn("[SkillSystem] Already initialized")
      return
    }

    const skills = await this.loader.discoverSkills()

    this.emit("skills:discovered", {
      skills,
      count: skills.length,
    })

    this.initialized = true
    this.log(`Initialized with ${skills.length} skills`)
  }

  /**
   * Process a user request - automatically match and activate skills
   */
  async processRequest(
    request: string,
    options: Partial<SkillMatchOptions> = {},
  ): Promise<{
    matches: SkillMatch[]
    activated: LoadedSkill[]
    context: string
  }> {
    this.ensureInitialized()

    const matchOptions: SkillMatchOptions = {
      request,
      minConfidence: options.minConfidence ?? this.config.minConfidenceThreshold,
      allowMultiple: options.allowMultiple ?? true,
      context: options.context,
    }

    // Find matching skills
    const allSkills = this.loader.getAllSkills()
    const matches = await this.matcher.matchSkills(allSkills, matchOptions)

    // Filter out already active skills
    const activeSkillNames = this.executor.getActiveSkills().map((s) => s.frontmatter.name)
    const newMatches = this.matcher.filterActiveSkills(matches, activeSkillNames)

    // Activate matched skills
    const activated: LoadedSkill[] = []

    for (const match of newMatches) {
      // Load the skill
      const loadedSkill = await this.loader.loadSkill(match.skill.frontmatter.name)

      if (loadedSkill) {
        // Activate it
        this.executor.activateSkill(loadedSkill, request, "automatic")
        activated.push(loadedSkill)

        // Track stats
        this.stats.totalActivations++
        this.stats.confidenceScores.push(match.confidence)

        // Emit events
        this.emit("skill:matched", { match })
        this.emit("skill:loaded", {
          skill: loadedSkill,
          tokensUsed: loadedSkill.estimatedTokens,
        })
        this.emit("skill:activated", {
          skill: loadedSkill,
          context: this.executor.getExecutionContext(request, "automatic"),
        })
      }
    }

    return {
      matches,
      activated,
      context: this.executor.generateLLMContext(),
    }
  }

  /**
   * Explicitly activate a skill by name
   */
  async activateSkill(
    skillName: string,
    request: string,
    loadOptions?: SkillLoadOptions,
  ): Promise<LoadedSkill | null> {
    this.ensureInitialized()

    // Load the skill
    const loadedSkill = await this.loader.loadSkill(skillName, loadOptions)

    if (!loadedSkill) {
      this.log(`Skill "${skillName}" not found`, "warn")
      return null
    }

    // Activate it
    this.executor.activateSkill(loadedSkill, request, "explicit")

    // Track stats
    this.stats.totalActivations++

    // Emit events
    this.emit("skill:loaded", {
      skill: loadedSkill,
      tokensUsed: loadedSkill.estimatedTokens,
    })
    this.emit("skill:activated", {
      skill: loadedSkill,
      context: this.executor.getExecutionContext(request, "explicit"),
    })

    this.log(`Explicitly activated skill "${skillName}"`)
    return loadedSkill
  }

  /**
   * Deactivate a skill
   */
  deactivateSkill(skillName: string): boolean {
    const success = this.executor.deactivateSkill(skillName)

    if (success) {
      const skill = this.loader.getSkillMetadata(skillName)
      if (skill) {
        this.emit("skill:deactivated", {
          skillName,
          tokensFreed: 0, // We don't track individual token counts after deactivation
        })
      }
    }

    return success
  }

  /**
   * Deactivate all skills
   */
  deactivateAll(): number {
    return this.executor.deactivateAll()
  }

  /**
   * Generate LLM context from active skills
   */
  generatePrompt(): string {
    return this.executor.generateLLMContext()
  }

  /**
   * Get execution summary
   */
  getSummary(): string {
    return this.executor.generateSummary()
  }

  /**
   * Get all discovered skills
   */
  getAllSkills(): SkillMetadata[] {
    this.ensureInitialized()
    return this.loader.getAllSkills()
  }

  /**
   * Get active skills
   */
  getActiveSkills(): LoadedSkill[] {
    return this.executor.getActiveSkills()
  }

  /**
   * Get skill by name
   */
  getSkill(skillName: string): SkillMetadata | undefined {
    return this.loader.getSkillMetadata(skillName)
  }

  /**
   * Check if skill is active
   */
  isSkillActive(skillName: string): boolean {
    return this.executor.isSkillActive(skillName)
  }

  /**
   * Get system statistics
   */
  getStats(): SkillSystemStats {
    const allSkills = this.loader.getAllSkills()
    const bySource = allSkills.reduce(
      (acc, skill) => {
        acc[skill.source]++
        return acc
      },
      { project: 0, user: 0, plugin: 0 },
    )

    const avgConfidence =
      this.stats.confidenceScores.length > 0
        ? this.stats.confidenceScores.reduce((a, b) => a + b, 0) /
          this.stats.confidenceScores.length
        : 0

    return {
      totalSkills: allSkills.length,
      bySource,
      discoveryTokens: allSkills.length * 50, // Rough estimate
      activeSkills: this.executor.getActiveSkills().length,
      activeTokens: this.executor.getTotalTokens(),
      totalActivations: this.stats.totalActivations,
      averageConfidence: avgConfidence,
    }
  }

  /**
   * Reload skills (re-discover)
   */
  async reload(): Promise<void> {
    this.initialized = false
    this.executor.deactivateAll()
    await this.initialize()
  }

  /**
   * Ensure system is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("SkillSystem not initialized. Call initialize() first.")
    }
  }

  /**
   * Debug logging
   */
  private log(message: string, level: "info" | "warn" | "error" = "info"): void {
    if (!this.config.debug && level === "info") return

    const prefix = "[SkillSystem]"
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

  /**
   * Type-safe event emitter methods
   */
  override on<K extends keyof SkillSystemEvents>(
    event: K,
    listener: (payload: SkillSystemEvents[K]) => void,
  ): this {
    return super.on(event, listener)
  }

  override emit<K extends keyof SkillSystemEvents>(
    event: K,
    payload: SkillSystemEvents[K],
  ): boolean {
    return super.emit(event, payload)
  }
}

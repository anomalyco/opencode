/**
 * Claude Code Skill System - Skill Executor
 *
 * Manages skill activation, execution context, and tool restrictions
 */

import type {
  LoadedSkill,
  SkillExecutionContext,
  ToolName,
  SkillSystemConfig,
} from './types'

/**
 * All available tools in Claude Code
 */
const ALL_TOOLS: ToolName[] = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'WebFetch',
  'WebSearch',
  'Task',
  'SlashCommand',
  'Skill',
  'TodoWrite',
  'AskUserQuestion',
  'NotebookEdit',
  'KillShell',
  'BashOutput',
]

/**
 * SkillExecutor - Manages skill execution and tool restrictions
 *
 * Responsibilities:
 * - Activate/deactivate skills
 * - Manage execution context
 * - Enforce tool restrictions
 * - Track token usage
 * - Generate context for LLM
 */
export class SkillExecutor {
  private activeSkills: Map<string, LoadedSkill> = new Map()
  private restrictedTools: Set<ToolName> = new Set()
  private config: Required<SkillSystemConfig>
  private debug: boolean

  constructor(config: SkillSystemConfig = {}) {
    this.config = {
      projectSkillsPath: config.projectSkillsPath || '.claude/skills',
      userSkillsPath: config.userSkillsPath || '~/.claude/skills',
      loadPluginSkills: config.loadPluginSkills ?? false,
      pluginSkillsPaths: config.pluginSkillsPaths || [],
      minConfidenceThreshold: config.minConfidenceThreshold ?? 0.6,
      maxActiveSkills: config.maxActiveSkills ?? 3,
      debug: config.debug ?? false,
    }
    this.debug = this.config.debug
  }

  /**
   * Activate a skill
   */
  activateSkill(
    skill: LoadedSkill,
    userRequest: string,
    source: 'automatic' | 'explicit' = 'automatic'
  ): SkillExecutionContext {
    // Check if we've hit max active skills
    if (
      this.activeSkills.size >= this.config.maxActiveSkills &&
      !this.activeSkills.has(skill.frontmatter.name)
    ) {
      this.log(
        `Cannot activate skill "${skill.frontmatter.name}": ` +
        `max active skills (${this.config.maxActiveSkills}) reached`,
        'warn'
      )
      // Deactivate oldest skill to make room
      const oldestSkill = this.activeSkills.keys().next().value
      if (oldestSkill) {
        this.deactivateSkill(oldestSkill)
      }
    }

    // Add to active skills
    this.activeSkills.set(skill.frontmatter.name, skill)

    // Update tool restrictions
    this.updateToolRestrictions()

    this.log(
      `Activated skill "${skill.frontmatter.name}" ` +
      `(~${skill.estimatedTokens} tokens, ${source})`
    )

    return this.getExecutionContext(userRequest, source)
  }

  /**
   * Deactivate a skill
   */
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

  /**
   * Deactivate all skills
   */
  deactivateAll(): number {
    const count = this.activeSkills.size
    this.activeSkills.clear()
    this.restrictedTools.clear()

    this.log(`Deactivated all skills (${count} total)`)
    return count
  }

  /**
   * Get current execution context
   */
  getExecutionContext(
    userRequest: string,
    source: 'automatic' | 'explicit' = 'automatic'
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

  /**
   * Check if a tool is allowed
   */
  isToolAllowed(tool: ToolName): boolean {
    return !this.restrictedTools.has(tool)
  }

  /**
   * Get list of restricted tools
   */
  getRestrictedTools(): ToolName[] {
    return Array.from(this.restrictedTools)
  }

  /**
   * Get list of allowed tools
   */
  getAllowedTools(): ToolName[] {
    return ALL_TOOLS.filter(tool => !this.restrictedTools.has(tool))
  }

  /**
   * Get active skills
   */
  getActiveSkills(): LoadedSkill[] {
    return Array.from(this.activeSkills.values())
  }

  /**
   * Check if a skill is active
   */
  isSkillActive(skillName: string): boolean {
    return this.activeSkills.has(skillName)
  }

  /**
   * Get total tokens used by active skills
   */
  getTotalTokens(): number {
    return Array.from(this.activeSkills.values())
      .reduce((sum, skill) => sum + skill.estimatedTokens, 0)
  }

  /**
   * Generate LLM context string from active skills
   * This is what gets injected into the prompt
   */
  generateLLMContext(): string {
    if (this.activeSkills.size === 0) {
      return ''
    }

    const sections: string[] = []

    // Header
    sections.push('# Active Skills\n')
    sections.push(
      `The following skills are currently active based on your request:\n`
    )

    // Each skill's content
    for (const skill of this.activeSkills.values()) {
      sections.push(`## Skill: ${skill.frontmatter.name}\n`)
      sections.push(`**Description**: ${skill.frontmatter.description}\n`)

      if (skill.frontmatter.allowedTools) {
        sections.push(
          `**Allowed Tools**: ${skill.frontmatter.allowedTools.join(', ')}\n`
        )
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

    // Tool restrictions
    if (this.restrictedTools.size > 0) {
      sections.push(`\n## Tool Restrictions\n`)
      sections.push(
        `The following tools are RESTRICTED and cannot be used:\n`
      )
      sections.push(
        `${Array.from(this.restrictedTools).map(t => `- ${t}`).join('\n')}\n`
      )
    }

    return sections.join('\n')
  }

  /**
   * Generate a compact summary for logging/debugging
   */
  generateSummary(): string {
    const skills = Array.from(this.activeSkills.values())
    const totalTokens = this.getTotalTokens()

    if (skills.length === 0) {
      return 'No active skills'
    }

    const skillNames = skills.map(s => s.frontmatter.name).join(', ')
    const restrictedCount = this.restrictedTools.size

    return (
      `${skills.length} active skill(s): ${skillNames} | ` +
      `~${totalTokens} tokens | ` +
      `${restrictedCount} tool(s) restricted`
    )
  }

  /**
   * Update tool restrictions based on active skills
   * A tool is restricted if ANY active skill excludes it from allowed-tools
   */
  private updateToolRestrictions(): void {
    // If no skills have tool restrictions, allow all tools
    const skillsWithRestrictions = Array.from(this.activeSkills.values())
      .filter(skill => skill.frontmatter.allowedTools)

    if (skillsWithRestrictions.length === 0) {
      this.restrictedTools.clear()
      return
    }

    // Find the intersection of all allowed tools
    const allowedToolsSets = skillsWithRestrictions.map(
      skill => new Set(skill.frontmatter.allowedTools!)
    )

    const allowedTools = new Set<ToolName>()

    // A tool is allowed only if it's in ALL skill's allowed-tools lists
    for (const tool of ALL_TOOLS) {
      if (allowedToolsSets.every(set => set.has(tool))) {
        allowedTools.add(tool)
      }
    }

    // Restricted tools are ALL_TOOLS minus allowed tools
    this.restrictedTools = new Set(
      ALL_TOOLS.filter(tool => !allowedTools.has(tool))
    )

    this.log(
      `Tool restrictions updated: ${this.restrictedTools.size} tools restricted`
    )
  }

  /**
   * Debug logging
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.debug && level === 'info') return

    const prefix = '[SkillExecutor]'
    switch (level) {
      case 'warn':
        console.warn(`${prefix} ${message}`)
        break
      case 'error':
        console.error(`${prefix} ${message}`)
        break
      default:
        console.log(`${prefix} ${message}`)
    }
  }
}

/**
 * Utility: Validate tool name
 */
export function isValidTool(tool: string): tool is ToolName {
  return ALL_TOOLS.includes(tool as ToolName)
}

/**
 * Utility: Get all tool names
 */
export function getAllToolNames(): ToolName[] {
  return [...ALL_TOOLS]
}

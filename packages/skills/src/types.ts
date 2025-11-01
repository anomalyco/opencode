/**
 * Claude Code Skill System - Type Definitions
 *
 * Replicates the skill loading and execution system used by Claude Code
 * with progressive disclosure for optimal token efficiency.
 */

/**
 * Valid tool names that can be restricted in skill execution
 */
export type ToolName =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Glob'
  | 'Grep'
  | 'Bash'
  | 'WebFetch'
  | 'WebSearch'
  | 'Task'
  | 'SlashCommand'
  | 'Skill'
  | 'TodoWrite'
  | 'AskUserQuestion'
  | 'NotebookEdit'
  | 'KillShell'
  | 'BashOutput'

/**
 * YAML frontmatter from SKILL.md
 * This is the lightweight metadata loaded during discovery phase
 */
export interface SkillFrontmatter {
  /** Unique identifier for the skill */
  name: string

  /**
   * Description including BOTH:
   * - What the skill does
   * - When to activate it
   */
  description: string

  /**
   * Optional: Restricts which tools can be used during skill execution
   * If undefined, all tools are allowed
   */
  allowedTools?: ToolName[]

  /**
   * Optional: Additional metadata
   */
  [key: string]: unknown
}

/**
 * Represents a skill in discovery phase (lightweight)
 * Only frontmatter is loaded - content remains on disk
 */
export interface SkillMetadata {
  /** Parsed frontmatter */
  frontmatter: SkillFrontmatter

  /** Absolute path to skill directory */
  path: string

  /** Absolute path to SKILL.md file */
  skillFilePath: string

  /** Source location (project, user, or plugin) */
  source: 'project' | 'user' | 'plugin'

  /** Whether supporting files exist */
  hasReference: boolean
  hasExamples: boolean
  hasScripts: boolean
  hasTemplates: boolean
}

/**
 * Fully loaded skill with all content
 * Only loaded when skill is activated
 */
export interface LoadedSkill extends SkillMetadata {
  /** Full content from SKILL.md (below frontmatter) */
  content: string

  /** Content from reference.md if exists */
  reference?: string

  /** Content from examples.md if exists */
  examples?: string

  /** List of script files in scripts/ directory */
  scripts?: string[]

  /** List of template files in templates/ directory */
  templates?: string[]

  /** Token count estimate for loaded content */
  estimatedTokens: number
}

/**
 * Result of skill matching against a user request
 */
export interface SkillMatch {
  /** The matched skill metadata */
  skill: SkillMetadata

  /** Confidence score (0-1) for the match */
  confidence: number

  /** Explanation of why this skill matched */
  reason: string

  /** Keywords that triggered the match */
  matchedKeywords: string[]
}

/**
 * Configuration for skill discovery and loading
 */
export interface SkillSystemConfig {
  /** Path to project skills directory (default: .claude/skills) */
  projectSkillsPath?: string

  /** Path to user skills directory (default: ~/.claude/skills) */
  userSkillsPath?: string

  /** Whether to load plugin skills (default: false) */
  loadPluginSkills?: boolean

  /** Plugin skills directories to scan */
  pluginSkillsPaths?: string[]

  /** Minimum confidence score to activate a skill (default: 0.6) */
  minConfidenceThreshold?: number

  /** Maximum number of skills to activate simultaneously (default: 3) */
  maxActiveSkills?: number

  /** Enable debug logging */
  debug?: boolean
}

/**
 * Execution context for a skill
 */
export interface SkillExecutionContext {
  /** The user's request that triggered this skill */
  userRequest: string

  /** Currently loaded skills */
  activeSkills: LoadedSkill[]

  /** Tools that are currently restricted */
  restrictedTools: Set<ToolName>

  /** Total tokens consumed by active skills */
  totalTokens: number

  /** Execution metadata */
  metadata: {
    activatedAt: Date
    source: 'automatic' | 'explicit'
  }
}

/**
 * Events emitted by the skill system
 */
export interface SkillSystemEvents {
  /** Emitted when skills are discovered */
  'skills:discovered': { skills: SkillMetadata[], count: number }

  /** Emitted when a skill is matched */
  'skill:matched': { match: SkillMatch }

  /** Emitted when a skill is fully loaded */
  'skill:loaded': { skill: LoadedSkill, tokensUsed: number }

  /** Emitted when a skill is activated */
  'skill:activated': { skill: LoadedSkill, context: SkillExecutionContext }

  /** Emitted when a skill is deactivated */
  'skill:deactivated': { skillName: string, tokensFreed: number }

  /** Emitted on errors */
  'error': { error: Error, context?: unknown }
}

/**
 * Options for skill matching
 */
export interface SkillMatchOptions {
  /** User request to match against */
  request: string

  /** Previously activated skills to consider */
  activeSkills?: string[]

  /** Whether to allow multiple skill activation */
  allowMultiple?: boolean

  /** Custom confidence threshold for this match */
  minConfidence?: number

  /** Additional context to improve matching */
  context?: {
    /** Current file being edited */
    currentFile?: string

    /** Recently used tools */
    recentTools?: ToolName[]

    /** Project language/framework hints */
    projectType?: string
  }
}

/**
 * Options for loading a skill
 */
export interface SkillLoadOptions {
  /** Whether to load reference.md */
  loadReference?: boolean

  /** Whether to load examples.md */
  loadExamples?: boolean

  /** Whether to list scripts */
  loadScripts?: boolean

  /** Whether to list templates */
  loadTemplates?: boolean

  /** Maximum tokens to load (safety limit) */
  maxTokens?: number
}

/**
 * Statistics about the skill system
 */
export interface SkillSystemStats {
  /** Total skills discovered */
  totalSkills: number

  /** Skills by source */
  bySource: {
    project: number
    user: number
    plugin: number
  }

  /** Total tokens used by discovery (frontmatter only) */
  discoveryTokens: number

  /** Currently active skills */
  activeSkills: number

  /** Total tokens used by active skills */
  activeTokens: number

  /** Skills activated so far in session */
  totalActivations: number

  /** Average confidence scores */
  averageConfidence: number
}

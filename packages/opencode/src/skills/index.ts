/**
 * Claude Code Skill System
 *
 * A complete implementation of Claude Code's skill system with progressive disclosure
 *
 * @example
 * ```ts
 * import { SkillSystem } from './skills'
 *
 * const system = new SkillSystem({ debug: true })
 * await system.initialize()
 *
 * const { activated, context } = await system.processRequest(
 *   "Create a React component with TypeScript"
 * )
 *
 * console.log(context) // Inject this into your LLM prompt
 * ```
 */

export { SkillSystem } from './skill-system'
export { SkillLoader } from './skill-loader'
export { SkillMatcher, calculateSimpleSimilarity, extractTriggerPhrases } from './skill-matcher'
export { SkillExecutor, isValidTool, getAllToolNames } from './skill-executor'

export type {
  // Core types
  ToolName,
  SkillFrontmatter,
  SkillMetadata,
  LoadedSkill,

  // Matching
  SkillMatch,
  SkillMatchOptions,

  // Execution
  SkillExecutionContext,
  SkillLoadOptions,

  // Configuration
  SkillSystemConfig,
  SkillSystemStats,
  SkillSystemEvents,
} from './types'

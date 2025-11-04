import { Config } from "../config/config"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import z from "zod"
import path from "path"

/**
 * Rules System
 *
 * Manages agent behavior rules from .opencode/rules/ directory.
 * Rules define constraints, patterns, and guidelines for agents.
 *
 * Rules can be:
 * - Global (apply to all agents)
 * - Agent-specific (apply to specific agent modes)
 * - Context-specific (apply based on file type, directory, etc.)
 *
 * @module Rules
 */
export namespace Rules {
  const log = Log.create({ service: "rules" })

  export const Rule = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    enabled: z.boolean().default(true),
    priority: z.number().default(100),
    scope: z
      .object({
        agents: z.array(z.string()).optional(), // Which agents this applies to
        fileTypes: z.array(z.string()).optional(), // Which file types
        directories: z.array(z.string()).optional(), // Which directories
      })
      .optional(),
    conditions: z
      .object({
        filePattern: z.string().optional(),
        agentMode: z.string().optional(),
        taskType: z.string().optional(),
      })
      .optional(),
    constraints: z
      .object({
        maxFileSize: z.number().optional(),
        allowedOperations: z.array(z.string()).optional(),
        deniedOperations: z.array(z.string()).optional(),
        requiresApproval: z.boolean().optional(),
      })
      .optional(),
    content: z.string(), // The actual rule content/prompt
  })

  export type Rule = z.infer<typeof Rule>

  const state = Instance.state(async () => {
    const rules: Rule[] = []
    const glob = new Bun.Glob("rules/*.{json,yaml,yml}")

    for (const dir of await Config.directories()) {
      for await (const match of glob.scan({
        cwd: dir,
        absolute: true,
        followSymlinks: true,
        dot: true,
      })) {
        try {
          const content = await Bun.file(match).text()
          let parsed: any

          if (match.endsWith(".json")) {
            parsed = JSON.parse(content)
          } else if (match.endsWith(".yaml") || match.endsWith(".yml")) {
            // Simple YAML parser for basic key-value
            parsed = parseSimpleYAML(content)
          }

          const rule = Rule.parse({
            id: parsed.id || path.basename(match, path.extname(match)),
            ...parsed,
          })

          if (rule.enabled) {
            rules.push(rule)
            log.info("loaded rule", { id: rule.id, file: match })
          }
        } catch (error) {
          log.error("failed to load rule", {
            file: match,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    // Sort by priority (higher priority first)
    rules.sort((a, b) => b.priority - a.priority)

    return { rules }
  })

  /**
   * Get all rules matching the given context
   */
  export async function getForContext(context: {
    agent?: string
    fileType?: string
    directory?: string
    taskType?: string
  }): Promise<Rule[]> {
    const { rules } = await state()
    return rules.filter((rule) => {
      // Check agent scope
      if (rule.scope?.agents && context.agent) {
        if (!rule.scope.agents.includes(context.agent)) return false
      }

      // Check file type scope
      if (rule.scope?.fileTypes && context.fileType) {
        if (!rule.scope.fileTypes.includes(context.fileType)) return false
      }

      // Check directory scope
      if (rule.scope?.directories && context.directory) {
        const matches = rule.scope.directories.some((dir) => context.directory?.startsWith(dir))
        if (!matches) return false
      }

      // Check conditions
      if (rule.conditions?.agentMode && context.agent) {
        if (rule.conditions.agentMode !== context.agent) return false
      }

      if (rule.conditions?.taskType && context.taskType) {
        if (rule.conditions.taskType !== context.taskType) return false
      }

      return true
    })
  }

  /**
   * Get all enabled rules
   */
  export async function list(): Promise<Rule[]> {
    return state().then((x) => x.rules)
  }

  /**
   * Get a specific rule by ID
   */
  export async function get(id: string): Promise<Rule | undefined> {
    const { rules } = await state()
    return rules.find((r) => r.id === id)
  }

  /**
   * Build prompt content from applicable rules
   */
  export async function buildPrompt(context: {
    agent?: string
    fileType?: string
    directory?: string
    taskType?: string
  }): Promise<string> {
    const rules = await getForContext(context)
    if (rules.length === 0) return ""

    const sections = rules.map((rule) => {
      let header = `## Rule: ${rule.name}`
      if (rule.description) {
        header += `\n${rule.description}`
      }
      return `${header}\n\n${rule.content}`
    })

    return `# Agent Rules\n\n${sections.join("\n\n")}`
  }

  /**
   * Simple YAML parser for basic key-value structures
   * (For production, consider using a proper YAML library)
   */
  function parseSimpleYAML(content: string): any {
    const result: any = {}
    const lines = content.split("\n")
    let currentKey = ""
    let currentValue = ""
    let inMultiline = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue

      if (trimmed.includes(":")) {
        if (currentKey) {
          result[currentKey] = currentValue.trim()
        }
        const [key, ...valueParts] = trimmed.split(":")
        currentKey = key.trim()
        currentValue = valueParts.join(":").trim()
        inMultiline = currentValue.endsWith("|") || currentValue.endsWith(">")
        if (inMultiline) currentValue = ""
      } else if (inMultiline) {
        currentValue += (currentValue ? "\n" : "") + trimmed
      }
    }

    if (currentKey) {
      result[currentKey] = currentValue.trim()
    }

    return result
  }
}

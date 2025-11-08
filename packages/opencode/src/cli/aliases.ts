/**
 * Command aliases system - shortcuts for common operations
 */

import path from "path"
import { xdgConfig } from "xdg-basedir"

export namespace Aliases {
  const CONFIG_FILE = path.join(xdgConfig || "~/.config", "opencode", "aliases.json")

  export type Alias = {
    name: string
    command: string
    description?: string
  }

  /**
   * Built-in aliases that ship with OpenCode
   */
  export const BUILT_IN: Record<string, Alias> = {
    r: {
      name: "r",
      command: "run",
      description: "Shortcut for 'run'",
    },
    s: {
      name: "s",
      command: "spawn",
      description: "Shortcut for 'spawn'",
    },
    a: {
      name: "a",
      command: "attach",
      description: "Shortcut for 'attach'",
    },
    fix: {
      name: "fix",
      command: "run --agent build 'fix all linter errors and type errors'",
      description: "Fix all linter and type errors",
    },
    explain: {
      name: "explain",
      command: "run --agent general 'explain this codebase'",
      description: "Explain the codebase",
    },
    test: {
      name: "test",
      command: "run --agent build 'run all tests and fix any failures'",
      description: "Run and fix tests",
    },
    review: {
      name: "review",
      command: "run --agent general 'review this code for improvements'",
      description: "Code review",
    },
    doc: {
      name: "doc",
      command: "run --agent general 'add documentation to this file'",
      description: "Add documentation",
    },
    refactor: {
      name: "refactor",
      command: "run --agent build 'refactor this code for better maintainability'",
      description: "Refactor code",
    },
    commit: {
      name: "commit",
      command: "run --agent build 'create a well-formatted git commit'",
      description: "Create git commit",
    },
    pr: {
      name: "pr",
      command: "run --agent build 'create a pull request with description'",
      description: "Create pull request",
    },
    debug: {
      name: "debug",
      command: "run --agent build 'help me debug this issue'",
      description: "Debug assistance",
    },
    perf: {
      name: "perf",
      command: "run --agent build 'analyze and improve performance'",
      description: "Performance optimization",
    },
    sec: {
      name: "sec",
      command: "run --agent build 'check for security vulnerabilities'",
      description: "Security audit",
    },
    clean: {
      name: "clean",
      command: "run --agent build 'clean up unused code and dependencies'",
      description: "Clean up code",
    },
  }

  /**
   * Load custom aliases from config file
   */
  export async function loadCustom(): Promise<Record<string, Alias>> {
    try {
      const file = Bun.file(CONFIG_FILE)
      if (!(await file.exists())) {
        return {}
      }
      const content = await file.text()
      return JSON.parse(content)
    } catch {
      return {}
    }
  }

  /**
   * Save custom aliases to config file
   */
  export async function saveCustom(aliases: Record<string, Alias>): Promise<void> {
    const dir = path.dirname(CONFIG_FILE)
    await Bun.write(CONFIG_FILE, JSON.stringify(aliases, null, 2))
  }

  /**
   * Get all aliases (built-in + custom)
   */
  export async function getAll(): Promise<Record<string, Alias>> {
    const custom = await loadCustom()
    return { ...BUILT_IN, ...custom }
  }

  /**
   * Add a custom alias
   */
  export async function add(name: string, command: string, description?: string): Promise<void> {
    const custom = await loadCustom()
    custom[name] = { name, command, description }
    await saveCustom(custom)
  }

  /**
   * Remove a custom alias
   */
  export async function remove(name: string): Promise<void> {
    const custom = await loadCustom()
    delete custom[name]
    await saveCustom(custom)
  }

  /**
   * Resolve an alias to its command
   */
  export async function resolve(name: string): Promise<string | null> {
    const all = await getAll()
    return all[name]?.command || null
  }

  /**
   * Check if a name is an alias
   */
  export async function isAlias(name: string): Promise<boolean> {
    const all = await getAll()
    return name in all
  }

  /**
   * Expand aliases in command arguments
   */
  export async function expand(args: string[]): Promise<string[]> {
    if (args.length === 0) return args

    const firstArg = args[0]
    const command = await resolve(firstArg)

    if (!command) return args

    // Replace alias with its command
    const commandParts = command.split(" ")
    return [...commandParts, ...args.slice(1)]
  }

  /**
   * List all aliases in a formatted way
   */
  export async function list(): Promise<Array<{ name: string; command: string; description: string; custom: boolean }>> {
    const custom = await loadCustom()
    const result: Array<{ name: string; command: string; description: string; custom: boolean }> = []

    // Add built-in aliases
    for (const [name, alias] of Object.entries(BUILT_IN)) {
      result.push({
        name,
        command: alias.command,
        description: alias.description || "",
        custom: false,
      })
    }

    // Add custom aliases
    for (const [name, alias] of Object.entries(custom)) {
      result.push({
        name,
        command: alias.command,
        description: alias.description || "",
        custom: true,
      })
    }

    return result.sort((a, b) => a.name.localeCompare(b.name))
  }
}

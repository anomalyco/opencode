import path from "path"
import os from "os"
import { Instance } from "../project/instance"

export namespace DynamicPrompt {
  export interface Context {
    /** Provider ID (e.g., "anthropic", "openai") */
    providerID: string
    /** Model ID (e.g., "claude-3-5-sonnet-20241022") */
    modelID: string
    /** Current working directory */
    directory: string
    /** Project root directory */
    worktree: string
    /** Whether the directory is a git repository */
    isGitRepo: boolean
    /** Current platform */
    platform: NodeJS.Platform
    /** Current username */
    username: string
  }

  /**
   * Type for the system prompt function that can be exported from TypeScript/JavaScript files
   */
  export type SystemPromptFunction = (context: Context) => string | Promise<string>

  /**
   * Resolves a prompt string, handling dynamic TypeScript/JavaScript imports if needed
   */
  export async function resolve(prompt: string, context: Context): Promise<string> {
    // Check if prompt starts with file:// and points to a TS/JS file
    if (!prompt.startsWith("file://")) {
      return prompt
    }

    const filePath = prompt.slice(7) // Remove "file://" prefix
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(context.directory, filePath)

    // Check if the file is a TypeScript or JavaScript file
    const ext = path.extname(resolvedPath).toLowerCase()
    if (![".ts", ".js", ".mts", ".mjs"].includes(ext)) {
      // Not a TS/JS file, read as text (existing behavior)
      return await Bun.file(resolvedPath).text()
    }

    try {
      // Import the TypeScript/JavaScript file
      const module = await import(resolvedPath)

      // Try to get the system function (named export) or default export
      const systemFunction = module.system || module.default

      if (typeof systemFunction !== "function") {
        throw new Error(
          `Dynamic prompt file "${resolvedPath}" must export a "system" function or default function that returns a string`,
        )
      }

      // Call the function with context and await if it returns a promise
      const result = await systemFunction(context)

      if (typeof result !== "string") {
        throw new Error(`Dynamic prompt function in "${resolvedPath}" must return a string, got ${typeof result}`)
      }

      return result
    } catch (error) {
      throw new Error(
        `Failed to load dynamic prompt from "${resolvedPath}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Creates the context object for dynamic prompts
   */
  export function createContext(input: {
    providerID: string
    modelID: string
    username?: string
    directory?: string
    worktree?: string
    isGitRepo?: boolean
  }): Context {
    let directory: string
    let worktree: string
    let isGitRepo: boolean

    if (input.directory !== undefined && input.worktree !== undefined && input.isGitRepo !== undefined) {
      // Use provided values (for testing)
      directory = input.directory
      worktree = input.worktree
      isGitRepo = input.isGitRepo
    } else {
      // Use Instance values (production)
      const project = Instance.project
      directory = Instance.directory
      worktree = Instance.worktree
      isGitRepo = project.vcs === "git"
    }

    return {
      providerID: input.providerID,
      modelID: input.modelID,
      directory,
      worktree,
      isGitRepo,
      platform: process.platform,
      username: input.username || os.userInfo().username,
    }
  }
}

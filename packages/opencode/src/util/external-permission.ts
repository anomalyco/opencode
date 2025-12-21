import { Config } from "../config/config"
import { Wildcard } from "./wildcard"
import { Global } from "../global"

export namespace ExternalPermission {
  type Permission = Config.Permission
  type ExternalDirectoryConfig = Config.ExternalDirectoryPermission

  /**
   * Expands tilde (~) in a pattern to the user's home directory.
   * Examples:
   *   ~/.ssh/** → /Users/username/.ssh/**
   *   ~/Documents/* → /Users/username/Documents/*
   */
  function expandTilde(pattern: string): string {
    if (pattern.startsWith("~/")) {
      return Global.Path.home + pattern.slice(1)
    }
    return pattern
  }

  /**
   * Resolve external directory permission for a given filepath and operation.
   *
   * Resolution order:
   * 1. If config is absent → "ask"
   * 2. If config is string → return that string for both operations
   * 3. If config is object → check operation-specific config
   *    a. If operation config is absent → "ask"
   *    b. If operation config is string → return that string
   *    c. If operation config is object → check directories, then default
   *
   * @param config The external_directory configuration
   * @param filepath Absolute file path to check
   * @param operation Operation type ('read' or 'write')
   * @returns Permission level to apply
   */
  export function resolve(
    config: ExternalDirectoryConfig | undefined,
    filepath: string,
    operation: "read" | "write",
  ): Permission {
    // Config absent = default to "ask"
    if (config === undefined) {
      return "ask"
    }

    // Type 1: Simple string - applies to both read and write
    if (typeof config === "string") {
      return config
    }

    // Type 2/3: Object with read/write
    const operationConfig = config[operation]

    // Operation not specified = default to "ask"
    if (operationConfig === undefined) {
      return "ask"
    }

    // Simple string for this operation
    if (typeof operationConfig === "string") {
      return operationConfig
    }

    // Object with directories for this operation
    if (operationConfig.directories) {
      // Expand tilde in all directory patterns
      const expandedDirectories: Record<string, Permission> = {}
      for (const [pattern, permission] of Object.entries(operationConfig.directories)) {
        expandedDirectories[expandTilde(pattern)] = permission
      }

      const match = Wildcard.pathAll(filepath, expandedDirectories)
      if (match !== undefined) {
        return match as Permission
      }
    }

    return operationConfig.default ?? "ask"
  }
}

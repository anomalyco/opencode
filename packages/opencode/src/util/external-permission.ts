import path from "path"
import { Config } from "../config/config"
import { Wildcard } from "./wildcard"
import { Global } from "../global"

export namespace ExternalPermission {
  type Permission = Config.Permission
  type ExternalDirectoryConfig = Config.ExternalDirectoryPermission

  // Expand ~/ to home directory using path.join for cross-platform support
  function expandTilde(pattern: string): string {
    if (pattern.startsWith("~/")) {
      return path.join(Global.Path.home, pattern.slice(2))
    }
    return pattern
  }

  /** Resolve permission for a filepath. Checks directory rules, then falls back to default. */
  export function resolve(
    config: ExternalDirectoryConfig | undefined,
    filepath: string,
    operation: "read" | "write",
  ): Permission {
    if (config === undefined) return "ask"
    if (typeof config === "string") return config

    const operationConfig = config[operation]
    if (operationConfig === undefined) return "ask"
    if (typeof operationConfig === "string") return operationConfig

    if (operationConfig.directories) {
      const expanded: Record<string, Permission> = {}
      for (const [pattern, permission] of Object.entries(operationConfig.directories)) {
        expanded[expandTilde(pattern)] = permission
      }
      const match = Wildcard.pathAll(filepath, expanded)
      if (match !== undefined) return match as Permission
    }

    return operationConfig.default ?? "ask"
  }
}

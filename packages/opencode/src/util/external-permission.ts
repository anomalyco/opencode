import path from "path"
import { Config } from "../config/config"
import { Wildcard } from "./wildcard"
import { Global } from "../global"

export namespace ExternalPermission {
  type Permission = Config.Permission
  type ExternalDirectoryConfig = Config.ExternalDirectoryPermission

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
      // Expand patterns: add /** suffix unless pattern already ends with wildcard
      const expanded: Record<string, Permission> = {}
      for (const [pattern, permission] of Object.entries(operationConfig.directories)) {
        const p = expandTilde(pattern)
        expanded[p] = permission
        // Add /** variant unless pattern already ends with * or **
        if (!p.endsWith("*")) {
          expanded[p + (p.endsWith("/") ? "**" : "/**")] = permission
        }
      }
      const match = Wildcard.pathAll<Permission>(filepath, expanded)
      if (match !== undefined) return match
    }

    return operationConfig.default ?? "ask"
  }
}

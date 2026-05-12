/**
 * PermissionHardener — Auto-allow rules for read-only tools
 * 
 * Pre-filters permission decisions for known safe tools.
 */

const AUTO_ALLOW_TOOLS = new Set(["read", "glob", "grep", "todowrite"])

export function permissionPreFilter(tool: string): "allow" | "default" {
  if (AUTO_ALLOW_TOOLS.has(tool)) return "allow"
  return "default"
}

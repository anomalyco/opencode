/**
 * Returns the full path to a binary on PATH, or null if not found.
 * Uses Bun.which when available, falls back to a PATH scan.
 */
export function which(cmd: string): string | null {
  if (typeof Bun !== "undefined" && typeof Bun.which === "function") {
    return Bun.which(cmd) ?? null
  }
  // Node.js fallback
  const { execSync } = require("child_process")
  try {
    const result = execSync(`command -v ${cmd} 2>/dev/null`, { encoding: "utf8" }).trim()
    return result || null
  } catch {
    return null
  }
}

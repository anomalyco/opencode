import { readFileSync } from "node:fs"
import path from "node:path"
import { resolve } from "resolve.exports"

// Absolute directory imports do not use package exports in Node. Resolve the
// manifest map first, then let the runtime resolver check each resulting file.
export function manifest(directory: string) {
  const pkg: unknown = (() => {
    try {
      return JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    }
  })()
  if (pkg === undefined) return () => undefined
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error("Invalid local plugin package.json")
  return (subpath: string): string[] | undefined => {
    if (!("exports" in pkg) || pkg.exports === null) {
      return !subpath && "main" in pkg && typeof pkg.main === "string" ? [pkg.main] : undefined
    }
    try {
      const targets =
        resolve(pkg, subpath ? `./${subpath}` : ".", {
          conditions: typeof Bun === "undefined" ? [] : ["bun"],
        }) ?? []
      if (
        targets.some(
          (target) =>
            !target.startsWith("./") ||
            target
              .split("/")
              .slice(1)
              .some((part) => ["..", "node_modules"].includes(part)),
        )
      ) {
        throw new Error("Invalid local plugin export target")
      }
      return targets
    } catch (error) {
      if (error instanceof Error && /^(Missing|No known conditions for) /.test(error.message)) return []
      throw error
    }
  }
}

import { createHash } from "crypto"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Glob } from "@opencode-ai/core/util/glob"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { isRecord } from "@/util/record"
import { ConfigParse } from "./parse"
import { ConfigPaths } from "./paths"
import { ConfigVariable } from "./variable"

// Most config objects are unordered, but permission maps use last-match
// precedence. Preserve their order, including permissions inside agent config.
export const canonicalEquals = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => [k, k === "permission" ? v : canonicalize(v)]),
    )
  }
  return value
}

// Normalize expanded config so referenced file changes are visible, while
// harmless key reorders hash equal. Malformed expanded text is hashed as-is.
const normalize = async (file: string, text: string): Promise<string> => {
  if (!file.endsWith(".json") && !file.endsWith(".jsonc")) return text
  const expanded = await ConfigVariable.substitute({ type: "path", path: file, text })
  try {
    const value = ConfigParse.jsonc(expanded, file)
    // The loader inserts this editor hint itself after the baseline is read.
    if (isRecord(value)) delete value.$schema
    return JSON.stringify(canonicalize(value))
  } catch {
    return expanded
  }
}

// Content fingerprint of everything the instance config loader reads from disk
// for one project: the project opencode.json/jsonc chain, every config
// directory's agent/mode/command/plugin files, the filtered directories'
// opencode.json/jsonc, and the OPENCODE_CONFIG override file. Mirrors the
// reads in Config's instance loader. Theme files are deliberately excluded:
// they affect rendering only and must not force an instance rebuild.
export const hashInstanceInputs = Effect.fn("ConfigFingerprint.hashInstanceInputs")(function* (
  directory: string,
  worktree?: string,
) {
  const files: string[] = []
  for (const file of yield* ConfigPaths.files("opencode", directory, worktree).pipe(Effect.orDie)) {
    files.push(file)
  }
  for (const dir of yield* ConfigPaths.directories(directory, worktree).pipe(Effect.orDie)) {
    if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR) {
      files.push(path.join(dir, "opencode.json"), path.join(dir, "opencode.jsonc"))
    }
    for (const pattern of [
      "{agent,agents}/**/*.md",
      "{mode,modes}/*.md",
      "{command,commands}/**/*.md",
      "{plugin,plugins}/*.{ts,js}",
    ]) {
      files.push(
        ...(yield* Effect.promise(() => Glob.scan(pattern, { cwd: dir, absolute: true, dot: true, symlink: true }))),
      )
    }
  }
  if (Flag.OPENCODE_CONFIG) files.push(Flag.OPENCODE_CONFIG)

  const hash = createHash("sha256")
  for (const file of [...new Set(files)].sort()) {
    const text = yield* Effect.promise(() =>
      fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      }),
    )
    if (text === undefined) continue
    hash.update(file)
    hash.update("\0")
    hash.update(yield* Effect.promise(() => normalize(file, text)))
    hash.update("\0")
  }
  return hash.digest("hex")
})

export * as ConfigFingerprint from "./fingerprint"

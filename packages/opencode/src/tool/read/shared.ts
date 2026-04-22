export const IGNORE_PATTERNS = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "vendor/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
] as const

function ignore(item: string) {
  const base = item.replace(/\/+$/, "")
  return [`!${base}`, `!${base}/**`, `!**/${base}`, `!**/${base}/**`]
}

export function defaultIgnoreGlobs(extra?: readonly string[]) {
  return [...new Set([...IGNORE_PATTERNS.flatMap(ignore), ...((extra ?? []).map((item) => `!${item}`) as string[])])]
}

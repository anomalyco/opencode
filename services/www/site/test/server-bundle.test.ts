import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Glob } from "bun"

// three.js must never reach the Worker's server bundle: its module start-up creates an
// AbortController, which Cloudflare Workers forbid during global start-up (every page answers 500).
// Modules that use it load only in the browser, through a loader the server build compiles away:
//   const loadStage = import.meta.env.SSR ? undefined : () => import("./stage")
// script/check-server-bundle.ts checks the built output too.

const src = path.resolve(import.meta.dir, "..", "src")
const files = await Array.fromAsync(new Glob("**/*.{ts,tsx}").scan({ cwd: src }))
const sources = new Map(
  await Promise.all(files.map(async (file) => [file, await Bun.file(path.join(src, file)).text()] as const)),
)

// Modules that import three.js as a value (statically or dynamically), and every module that imports
// one of those as a value: all of them are browser-only.
// One import statement: up to its `from`, never running on into the next statement.
const clause = String.raw`(?:^|\n)import\s+(?!type\b)(?:(?!\nimport\b)[^;])*?from\s+`
const usesThree = (text: string) => new RegExp(`${clause}"three[/"]|import\\("three[/"]`).test(text)
const browserOnly = (() => {
  const found = new Set(files.filter((file) => usesThree(sources.get(file) ?? "")))
  const grow = (): Set<string> => {
    const next = files.filter(
      (file) => !found.has(file) && [...found].some((target) => staticallyImports(file, target)),
    )
    if (!next.length) return found
    next.forEach((file) => found.add(file))
    return grow()
  }
  return grow()
})()

function specifiers(file: string, target: string) {
  const relative = path.relative(path.dirname(file), target).replace(/\.tsx?$/, "")
  return [relative.startsWith(".") ? relative : `./${relative}`, `~/${target.replace(/\.tsx?$/, "")}`]
}

function staticallyImports(file: string, target: string) {
  const text = sources.get(file) ?? ""
  return specifiers(file, target).some((specifier) => new RegExp(`${clause}"${escape(specifier)}"`).test(text))
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

describe("server bundle", () => {
  test("three.js is used somewhere (the check is live)", () => {
    expect(browserOnly.size).toBeGreaterThan(0)
  })

  test("browser-only three.js modules are imported only through an SSR-guarded loader", () => {
    const unguarded = files.flatMap((file) =>
      [...browserOnly]
        .filter((target) => target !== file && !browserOnly.has(file))
        .flatMap((target) =>
          specifiers(file, target).flatMap((specifier) => {
            const text = sources.get(file) ?? ""
            const dynamic = new RegExp(`import\\("${escape(specifier)}"\\)`, "g")
            const guarded = new RegExp(
              `import\\.meta\\.env\\.SSR\\s*\\?\\s*undefined\\s*:\\s*\\(\\)\\s*=>\\s*import\\("${escape(specifier)}"\\)`,
              "g",
            )
            const all = text.match(dynamic)?.length ?? 0
            const safe = text.match(guarded)?.length ?? 0
            return all > safe || staticallyImports(file, target) ? [`${file} → ${target}`] : []
          }),
        ),
    )
    expect(unguarded).toEqual([])
  })
})

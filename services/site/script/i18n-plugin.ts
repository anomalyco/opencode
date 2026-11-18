// The translation slices in the static pages' script (script/static-client.ts; script/i18n-slices.ts
// works out what goes in each):
//
// - each locale gets a table module (virtual:i18n/<locale>) holding the shell's strings and where each
//   other slice is, each slice a module of its own (virtual:i18n/<locale>/<slice>), and
//   src/i18n/tables.ts becomes the 18 tables;
// - src/i18n/english.ts keeps only the English the browser reads in every language;
// - every import() of a lazy boundary (a module only ever loaded with import()) loads the boundary's
//   slice alongside it and resolves once both have arrived, so the boundary's code never runs before
//   its strings (a top-level await in the boundary would do the same, but makes Rolldown split the
//   shared chunks differently). The script's first file must not bring the runtime, so that import()
//   loads the runtime with import() too.
//
// The development server and the Worker keep the source files whole.
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import type { Plugin } from "vite"
import type { result as Result } from "./i18n-slices"

type Slices = typeof Result

// Vite ids use forward slashes on every platform.
const slashes = (file: string) => file.replaceAll("\\", "/")
const root = slashes(fileURLToPath(new URL("..", import.meta.url)))
const runtime = path.posix.join(root, "src/i18n/index.ts")
const tablesFile = path.posix.join(root, "src/i18n/tables.ts")
const englishFile = path.posix.join(root, "src/i18n/english.ts")
// An import() of a module, with any spaces or comments (such as /* @vite-ignore */) inside.
const dynamicImport = /\bimport\(\s*(?:\/\*[\s\S]*?\*\/\s*)*(["'])([^"'`]+)\1\s*\)/g

export function i18nSlices(): Plugin {
  let build = false
  let slices: Slices | undefined
  const client = (environment: { name: string }) => build && environment.name === "client"
  const analyze = () => {
    if (slices) return slices
    const run = spawnSync("bun", ["script/i18n-slices.ts", "--json"], { cwd: root, maxBuffer: 256 * 1024 * 1024 })
    if (run.status !== 0) throw new Error(`i18n-slices failed:\n${run.stderr}`)
    slices = JSON.parse(run.stdout.toString()) as Slices
    return slices
  }
  const boundary = (id: string) => analyze().boundaries[slashes(id).split("?")[0]]
  // A slice with no strings in any language, which the tables leave out.
  const empty = (slice: string) =>
    Object.values(analyze().locales).every((locale) => {
      const payload = locale.slices[analyze().shared[slice]]
      return !Object.keys(payload.dict).length && !Object.keys(payload.content).length
    })

  return {
    name: "i18n-slices",
    enforce: "post",
    configResolved(config) {
      build = config.command === "build"
    },
    resolveId(id) {
      if (id.startsWith("virtual:i18n")) return `\0${id}`
    },
    load(id) {
      if (!client(this.environment)) return
      const data = analyze()
      if (id === englishFile) return `export const english = ${json(data.english)}`
      if (id === tablesFile)
        return `export const tables = {\n${Object.keys(data.locales)
          .map((locale) => `  ${JSON.stringify(locale)}: () => import("virtual:i18n/${locale}").then((module) => module.default),`)
          .join("\n")}\n}`
      const match = id.match(/^\0virtual:i18n\/(\w+)(?:\/([\w-]+))?$/)
      if (!match) return
      const locale = data.locales[match[1] as keyof Slices["locales"]]
      if (match[2] === "all") return `export default ${json(locale.full)}`
      if (match[2]) return `export default ${json(locale.slices[match[2]])}`
      // The shell's strings are in the table itself, which every page loads anyway; an empty slice
      // has no entry.
      const entries = Object.keys(data.shared).flatMap((slice) => {
        const payload = locale.slices[data.shared[slice]]
        if (slice === "shell") return [`    shell: ${json(payload)},`]
        if (!Object.keys(payload.dict).length && !Object.keys(payload.content).length) return []
        return [`    ${JSON.stringify(slice)}: () => import("virtual:i18n/${match[1]}/${data.shared[slice]}"),`]
      })
      return `export default {\n  slices: {\n${entries.join("\n")}\n  },\n  all: () => import("virtual:i18n/${match[1]}/all"),\n}`
    },
    async transform(code, id) {
      if (!client(this.environment) || id.startsWith("\0") || slashes(id).includes("/src/i18n/")) return
      const slices = new Map<string, string>()
      for (const match of code.matchAll(dynamicImport)) {
        const target = await this.resolve(match[2], id)
        const slice = target && boundary(target.id)
        // A boundary without strings (the funnel's config) has nothing to wait for.
        if (!target || !slice || empty(slice)) continue
        slices.set(match[0], slice)
      }
      if (!slices.size) return
      return {
        code: [
          `const __i18nWith = (module, slice) => Promise.all([module, import(${JSON.stringify(runtime)}).then((i18n) => i18n.loadSlice(slice)).catch(() => {})]).then((loaded) => loaded[0]);`,
          code.replace(dynamicImport, (text) => (slices.has(text) ? `__i18nWith(${text}, ${JSON.stringify(slices.get(text))})` : text)),
        ].join("\n"),
        map: null,
      }
    },
  }
}

/** Strings as one JSON.parse call: compact whether or not the build minifies, and quick to parse. */
function json(value: unknown) {
  return `JSON.parse('${JSON.stringify(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')`
}

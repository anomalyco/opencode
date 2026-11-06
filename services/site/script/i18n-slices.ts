// Splits the translations by where the browser needs them, for the client build (vite.config.ts,
// i18nSlices). The source files stay as they are (src/i18n/<locale>.ts, src/i18n/content/<locale>.ts);
// this reads them and the app's import graph and works out, for each locale:
//
// - the shell slice: the dictionary keys and page copy the code every page loads can show
//   (entry-client.tsx and app.tsx with their static imports), and what most page routes show;
// - one slice per lazy boundary, a module the browser loads on demand (each page route, and each
//   module only ever loaded with import()): what its static imports can show, minus the shell;
// - the full file: everything any client code can show, for switching to the language in place.
//
// A key counts when its literal appears in the module (or a template or concatenation that starts
// it, such as `site.theme.${name}`), so a slice is a superset of what its modules render. Page copy
// counts by its top-level area (products, brand, …) when the module names it. English needs no page
// copy (the English source is the data itself), only dictionary keys.
//
//   bun script/i18n-slices.ts            prints each slice's size per locale
//   bun script/i18n-slices.ts --json     prints the slices for the Vite plugin
import path from "node:path"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dict as en } from "../src/i18n/en"
import { english as englishSource } from "../src/i18n/english"
import { LOCALES, type Locale } from "../src/lib/language"

const root = path.resolve(import.meta.dir, "..")
const src = path.join(root, "src")
const english = en as Record<string, string>
const keys = Object.keys(english)

// src/i18n/english.ts in the browser: the English that client modules read from it. The page copy's
// English sources (content/areas) read it as they load, so record those reads while loading them.
const recorded = new Set<string>()
let recording = true
for (const key of keys) {
  const value = english[key]
  Object.defineProperty(englishSource, key, { enumerable: true, get: () => (recording && recorded.add(key), value) })
}
const { contentSource } = await import("../src/i18n/content/source")
await Promise.all(
  [...new Bun.Glob("i18n/content/areas/*.ts").scanSync(src)].map((file) => import(path.join(src, file))),
)
recording = false
const areas = Object.keys(contentSource((key) => english[key]))
// As the client build sees the code: development-only and server-only branches dropped.
const transpiler = new Bun.Transpiler({
  loader: "tsx",
  define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.SSR": "false" },
})

type Module = { file: string; imports: string[]; dynamic: string[]; keys: Set<string>; areas: Set<string> }
const modules = new Map<string, Module>()

function resolve(from: string, specifier: string) {
  const bare = specifier.replace(/\?.*$/, "")
  const base = bare.startsWith("~/")
    ? path.join(src, bare.slice(2))
    : bare.startsWith(".")
      ? path.resolve(path.dirname(from), bare)
      : undefined
  if (!base) return
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find(
    (file) => /\.(tsx?|json)$/.test(file) && existsSync(file) && statSync(file).isFile(),
  )
}

function scan(file: string): Module {
  const known = modules.get(file)
  if (known) return known
  const module: Module = { file, imports: [], dynamic: [], keys: new Set(), areas: new Set() }
  modules.set(file, module)
  // The dictionaries and page copy define the strings; they never show one by themselves.
  if (/src\/i18n\/(content\/)?[a-z]+\.ts$/.test(file) && !/src\/i18n\/(content\/)?(index|rich|source|paths|english|tables)\.ts$/.test(file))
    return module
  const text = readFileSync(file, "utf8")
  const code = file.endsWith(".json") ? text : transpiler.transformSync(text)
  if (!file.endsWith(".json"))
    for (const found of transpiler.scan(code).imports) {
      const target = resolve(file, found.path)
      if (target) (found.kind === "dynamic-import" ? module.dynamic : module.imports).push(target)
    }
  for (const match of code.matchAll(/["'`]([a-zA-Z][\w.-]*)["'`]/g)) if (match[1] in english) module.keys.add(match[1])
  // The start of a key built at runtime: `site.theme.${name}` or "legal.status." + status.
  for (const match of code.matchAll(/(?:`([a-zA-Z][\w.-]*)\$\{|["']([a-zA-Z][\w.-]*)["']\s*\+)/g)) {
    const prefix = match[1] ?? match[2]
    if (prefix.includes(".")) keys.filter((key) => key.startsWith(prefix)).forEach((key) => module.keys.add(key))
  }
  // Page copy is read through content/index.ts (useContent, siteContent, localize), so only modules
  // that import it, or take its types to read copy passed to them, can name an area; elsewhere
  // `products` or `.brand` is the data's own field.
  if (/["']~\/i18n\/content["']|["'][./]+(i18n\/)?content(\/index)?["']/.test(text))
    for (const area of areas) if (new RegExp(`(\\.${area}\\b|["'\`]${area}["'\`])`).test(code)) module.areas.add(area)
  return module
}

function closure(roots: string[], dynamic = false) {
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const module = scan(file)
    module.imports.forEach(visit)
    if (dynamic) module.dynamic.forEach(visit)
  }
  roots.forEach(visit)
  return seen
}

const gather = (files: Iterable<string>, field: "keys" | "areas") =>
  new Set([...files].flatMap((file) => [...scan(file)[field]]))

const shellRoots = [path.join(src, "entry-client.tsx"), path.join(src, "app.tsx")]
const routes = [...new Bun.Glob("routes/**/*.tsx").scanSync(src)]
  .map((file) => path.join(src, file))
  .filter((file) => /export default/.test(readFileSync(file, "utf8")))
const client = closure([...shellRoots, ...routes], true)
// Lazy boundaries: the page routes and every module the client loads with import(), even one that is
// also imported statically elsewhere (an import() can still be the first to load it). The development
// loader's imports of the source files, in src/i18n, don't count.
const boundaries = [
  ...new Set([
    ...routes,
    ...[...client].flatMap((file) => scan(file).dynamic).filter((file) => !file.startsWith(path.join(src, "i18n"))),
  ]),
].toSorted()

// The shell: what the code every page loads can show, plus what most page routes show (the site's
// header, footer and search), so it loads once rather than with each page. A page that doesn't show
// those (the 404 arcade) loads a few kilobytes it doesn't need.
const shell = closure(shellRoots)
const most = (field: "keys" | "areas") => {
  const counts = new Map<string, number>()
  routes.forEach((file) => gather(closure([file]), field).forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1)))
  return [...counts].filter(([, count]) => count > routes.length / 2).map(([item]) => item)
}
const shellKeys = new Set([...gather(shell, "keys"), ...most("keys")])
const shellAreas = new Set([...gather(shell, "areas"), ...most("areas")])
const sliceId = (file: string) => path.relative(src, file).replace(/\.[^.]+$/, "").replace(/[^\w]+/g, "-")
const slices: Record<string, { keys: string[]; areas: string[] }> = {
  shell: { keys: [...shellKeys], areas: [...shellAreas] },
}
for (const file of boundaries) {
  const files = closure([file])
  slices[sliceId(file)] = {
    keys: [...gather(files, "keys")].filter((key) => !shellKeys.has(key)),
    areas: [...gather(files, "areas")].filter((area) => !shellAreas.has(area)),
  }
}
const clientKeys = [...gather(client, "keys")]
// Boundaries that show the same strings (the product pages) share the first one's file.
const signature = (id: string) => JSON.stringify([slices[id].keys.toSorted(), slices[id].areas.toSorted()])
const shared = Object.fromEntries(
  Object.keys(slices).map((id) => [id, Object.keys(slices).find((other) => signature(other) === signature(id))!]),
)

// Plus every key named by a module that imports english.ts itself (product-markdown.ts reads it in a
// function, so loading it records nothing).
const englishFile = path.join(src, "i18n/english.ts")
;[...client].filter((file) => scan(file).imports.includes(englishFile)).forEach((file) => scan(file).keys.forEach((key) => recorded.add(key)))

// The keys client code asks i18n.translated() about: a payload lists which of those are still English.
const asked = new Set(
  [...client].flatMap((file) =>
    file.endsWith(".json") ? [] : [...readFileSync(file, "utf8").matchAll(/\btranslated\(\s*["'`]([\w.-]+)["'`]/g)].map((match) => match[1]),
  ),
)

type Payload = { dict: Record<string, string>; content: Record<string, unknown>; same: string[] }
const locales = Object.fromEntries(
  await Promise.all(
    LOCALES.map(async (locale) => {
      const dict: Record<string, string> =
        locale === "en" ? english : (await import(`../src/i18n/${locale}.ts`)).dict
      const content: Record<string, unknown> =
        locale === "en" ? {} : (await import(`../src/i18n/content/${locale}.ts`)).content
      const payload = (picked: string[], pickedAreas: string[]): Payload => ({
        dict: Object.fromEntries(picked.map((key) => [key, dict[key]])),
        content: locale === "en" ? {} : Object.fromEntries(pickedAreas.map((area) => [area, content[area] ?? {}])),
        same: locale === "en" ? [] : picked.filter((key) => asked.has(key) && dict[key] === english[key]),
      })
      return [
        locale,
        {
          slices: Object.fromEntries(
            Object.entries(slices)
              .filter(([id]) => shared[id] === id)
              .map(([id, slice]) => [id, payload(slice.keys, slice.areas)]),
          ),
          full: payload(clientKeys, areas),
        },
      ] as const
    }),
  ),
) as Record<Locale, { slices: Record<string, Payload>; full: Payload }>

export const result = {
  shared,
  // By path with forward slashes, as Vite writes module ids on every platform.
  boundaries: Object.fromEntries(boundaries.map((file) => [file.replaceAll("\\", "/"), sliceId(file)])),
  english: Object.fromEntries([...recorded].toSorted().map((key) => [key, english[key]])),
  locales,
}

if (import.meta.main) {
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(result))
  } else {
    const gz = (value: unknown) => Bun.gzipSync(JSON.stringify(value), { level: 9 }).length
    console.log(`client keys ${clientKeys.length} of ${keys.length}; English for the page copy source ${recorded.size}`)
    for (const [id, slice] of Object.entries(slices))
      console.log(
        `${id.padEnd(44)} ${String(slice.keys.length).padStart(4)} keys  ${slice.areas.join(",").padEnd(40)}` +
          ["en", "ja", "ar"].map((locale) => ` ${locale} ${gz(locales[locale as Locale].slices[shared[id]])}`).join(""),
      )
    console.log(`full: ${["en", "ja", "ar"].map((locale) => `${locale} ${gz(locales[locale as Locale].full)}`).join(" ")}`)
  }
}

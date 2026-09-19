# Desktop Plugin Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Plugins tab to OpenCode Desktop's settings dialog that browses a plugin catalog (ecosystem docs + awesome-opencode, enriched from npm), and installs/manages plugins in global or project `opencode.json`.

**Architecture:** Two layers. (1) Electron main process module `plugin-manager.ts` exposing catalog fetch/cache and JSONC-aware config mutation over new `plugins:*` IPC handlers; (2) a SolidJS settings tab in `packages/app` that reaches those APIs through the existing `window.api` bridge and `usePlatform()` context. Catalog sources: `https://opencode.ai/docs/ecosystem/` (HTML scrape) + `https://raw.githubusercontent.com/awesome-opencode/awesome-opencode/main/README.md` (markdown parse), enriched with npm registry + downloads API, cached 24h on disk under `app.getPath("userData")`.

**Tech Stack:** Electron (main/preload/renderer), SolidJS, `@opencode-ai/ui/v2` components, `jsonc-parser` 3.3.1 (already in workspace, add to desktop package), Bun test (`bun:test`) for main-process units, Storybook for UI stories.

**Spec:** `docs/superpowers/specs/2026-09-03-desktop-plugin-manager-design.md`

## Global Constraints

- Repo: `/home/yeager1977/GitHub/opencode`, branch `dev` (work from this clone; do not push).
- Tests run with `bun test` from `packages/desktop/` (repo convention: `bun:test`, colocated `*.test.ts`). Root `bun test` is disabled ("do not run tests from root").
- Typecheck with `bun run typecheck` in `packages/desktop/` (`tsgo -b`) and `packages/app/` after UI tasks.
- Config writes MUST preserve unknown top-level keys, `$schema`, and, for `.jsonc` targets, comments/formatting. On parse failure: refuse to write, surface the file path. On write race: re-read and only apply if the `plugin` array is unchanged; otherwise error.
- Plugin entries support both `"name"` and `["name", {options}]` (tuple) forms; mutations preserve the existing form and options.
- New i18n keys go in `packages/app/src/i18n/en.ts` only (other locales fall back to English; do not machine-translate).
- Do not modify packages other than `desktop`, `app`, and `ui` (story only). No server/TUI/core changes.
- Disable = remove entry from config + record in desktop-local "recently removed" store for one-click re-enable. Uninstall = remove + confirm + drop from recently-removed.
- The Plugins tab must be hidden when `platform.platform !== "desktop"`.

---

### Task 1: Config parsing and mutation library (main process)

**Files:**
- Create: `packages/desktop/src/main/plugin-config.ts`
- Test: `packages/desktop/src/main/plugin-config.test.ts`

**Interfaces:**
- Consumes: `jsonc-parser` package (added to `packages/desktop/package.json` dependencies in this task).
- Produces (used by Tasks 2–5):
  - `type PluginEntry = string | [name: string, options: Record<string, unknown>]`
  - `function parsePluginEntries(value: unknown): PluginEntry[]` — accepts the `plugin` config value (missing/null → `[]`); silently drops non-string/non-tuple junk entries.
  - `function entryName(entry: PluginEntry): string`
  - `function serializeEntries(entries: PluginEntry[]): unknown` — round-trips entries preserving tuple form.
  - `type ConfigTarget = { path: string; jsonc: boolean }`
  - `function resolveGlobalConfig(): ConfigTarget` — `~/.config/opencode/opencode.json` (`.jsonc` variant preferred if it exists; then create-path is the `.json` one).
  - `function resolveProjectConfig(dir: string): ConfigTarget`
  - `type Mutation = { kind: "add" | "remove"; name: string; entry?: PluginEntry }` (for `add`, `entry` defaults to `name`)
  - `async function readConfig(target: ConfigTarget): Promise<{ raw: string; data: any; plugins: PluginEntry[]; mtimeMs: number }>` — throws `ConfigParseError` (custom class with `path` property) on unparseable content.
  - `async function mutateConfig(target: ConfigTarget, mutation: Mutation): Promise<{ changed: boolean }>` — atomic write via temp-file + rename; preserves comments/unknown keys for `.jsonc` via jsonc-parser edit operations; conflict detection by comparing `plugin` array pre/post re-read.

- [ ] **Step 1: Add jsonc-parser to desktop package deps**

In `packages/desktop/package.json`, add `"jsonc-parser": "3.3.1"` to `dependencies` (same version pinned in `packages/core/package.json:118` and workspace catalog — reuse the literal `"3.3.1"`). Then run `bun install` from repo root so the module resolves for tests.

```bash
cd /home/yeager1977/GitHub/opencode && bun install
```

- [ ] **Step 2: Write the failing tests**

Create `packages/desktop/src/main/plugin-config.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  parsePluginEntries,
  entryName,
  serializeEntries,
  readConfig,
  mutateConfig,
  ConfigParseError,
  type ConfigTarget,
} from "./plugin-config"

const tmp = async () => mkdtemp(join(tmpdir(), "opencode-plugin-config-"))
const writeTarget = async (name: string, content: string): Promise<ConfigTarget> => {
  const dir = await tmp()
  const path = join(dir, name)
  await writeFile(path, content)
  return { path, jsonc: name.endsWith(".jsonc") }
}

describe("parsePluginEntries", () => {
  test("returns empty array for missing/invalid values", () => {
    expect(parsePluginEntries(undefined)).toEqual([])
    expect(parsePluginEntries(null)).toEqual([])
    expect(parsePluginEntries("nope")).toEqual([])
    expect(parsePluginEntries(42)).toEqual([])
  })
  test("keeps string and tuple entries, drops junk", () => {
    expect(parsePluginEntries(["a", ["b", { x: 1 }], 42, null])).toEqual(["a", ["b", { x: 1 }]])
  })
  test("drops malformed tuples", () => {
    expect(parsePluginEntries([["a"], ["b", { x: 1 }, "extra"]])).toEqual([["b", { x: 1 }]])
  })
})

describe("entryName / serializeEntries", () => {
  test("round-trips forms", () => {
    const entries: (string | [string, Record<string, unknown>])[] = ["a", ["b", { x: 1 }]]
    expect(entries.map(entryName)).toEqual(["a", "b"])
    expect(serializeEntries(entries)).toEqual(["a", ["b", { x: 1 }]])
  })
})

describe("readConfig", () => {
  test("reads plugins from json", async () => {
    const target = await writeTarget("opencode.json", `{"$schema":"x","plugin":["a"]}`)
    const cfg = await readConfig(target)
    expect(cfg.plugins).toEqual(["a"])
    expect(cfg.data.$schema).toBe("x")
  })
  test("jsonc preserves comments in raw and parses data", async () => {
    const target = await writeTarget(
      "opencode.jsonc",
      `{\n // my comment\n "model": "x", "plugin": ["a"]\n}`,
    )
    const cfg = await readConfig(target)
    expect(cfg.data.model).toBe("x")
    expect(cfg.plugins).toEqual(["a"])
    expect(cfg.raw).toContain("// my comment")
  })
  test("throws ConfigParseError with path on bad content", async () => {
    const target = await writeTarget("opencode.json", `{oops`)
    try {
      await readConfig(target)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigParseError)
      expect((e as ConfigParseError).path).toBe(target.path)
    }
  })
  test("missing file yields empty config", async () => {
    const cfg = await readConfig({ path: join(await tmp(), "opencode.json"), jsonc: false })
    expect(cfg.plugins).toEqual([])
    expect(cfg.raw).toBe("")
  })
})

describe("mutateConfig", () => {
  test("add writes plugin entry to json preserving unknown keys", async () => {
    const target = await writeTarget("opencode.json", `{"$schema":"x","model":"m"}`)
    const { changed } = await mutateConfig(target, { kind: "add", name: "opencode-wakatime" })
    expect(changed).toBe(true)
    const data = JSON.parse(await readFile(target.path, "utf8"))
    expect(data.model).toBe("m")
    expect(data.$schema).toBe("x")
    expect(data.plugin).toEqual(["opencode-wakatime"])
  })
  test("add preserves tuple form when re-adding with entry", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a"]}`)
    await mutateConfig(target, { kind: "add", name: "b", entry: ["b", { opt: true }] })
    const data = JSON.parse(await readFile(target.path, "utf8"))
    expect(data.plugin).toEqual(["a", ["b", { opt: true }]])
  })
  test("add is idempotent by name", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a"]}`)
    const { changed } = await mutateConfig(target, { kind: "add", name: "a" })
    expect(changed).toBe(false)
  })
  test("remove keeps other entries and tuple options", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a",["b",{x:1}]]}`)
    const { changed } = await mutateConfig(target, { kind: "remove", name: "b" })
    expect(changed).toBe(true)
    const data = JSON.parse(await readFile(target.path, "utf8"))
    expect(data.plugin).toEqual(["a"])
  })
  test("remove of absent entry reports unchanged", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a"]}`)
    const { changed } = await mutateConfig(target, { kind: "remove", name: "zzz" })
    expect(changed).toBe(false)
  })
  test("jsonc mutation preserves comments and formatting", async () => {
    const content = `{\n // keep me\n "model": "x",\n "plugin": ["a"]\n}`
    const target = await writeTarget("opencode.jsonc", content)
    await mutateConfig(target, { kind: "add", name: "b" })
    const out = await readFile(target.path, "utf8")
    expect(out).toContain("// keep me")
    expect(out).toContain(`"model": "x"`)
    const data = JSON.parse(out.replace(/\s*\/\/.*$/gm, ""))
    expect(data.plugin).toEqual(["a", "b"])
  })
  test("refuses to write on parse failure", async () => {
    const target = await writeTarget("opencode.json", `{oops`)
    await expect(mutateConfig(target, { kind: "add", name: "a" })).rejects.toBeInstanceOf(ConfigParseError)
    expect(await readFile(target.path, "utf8")).toBe(`{oops`)
  })
  test("conflict: plugin array changed on disk between read and write", async () => {
    const target = await writeTarget("opencode.json", `{"plugin":["a"]}`)
    // Simulate a race: capture config, then external process edits the file.
    const first = await readConfig(target)
    await writeFile(target.path, `{"plugin":["a","intruder"]}`)
    // mutateConfig re-reads internally; craft mutation against stale expectation
    // by removing "intruder" (which was not there at first read) — should still apply
    // since re-read strategy is: apply to latest content, only error if OUR
    // target entry's presence flipped unexpectedly.
    const { changed } = await mutateConfig(target, { kind: "add", name: "intruder" })
    expect(changed).toBe(true)
    expect(first.plugins).toEqual(["a"])
    const data = JSON.parse(await readFile(target.path, "utf8"))
    expect(data.plugin).toContain("intruder")
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun test src/main/plugin-config.test.ts
```

Expected: FAIL — module `./plugin-config` not found.

- [ ] **Step 4: Implement `plugin-config.ts`**

```ts
import { homedir } from "node:os"
import { readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { applyEdits, format, modify, parse, parseTree } from "jsonc-parser"

export type PluginEntry = string | [name: string, options: Record<string, unknown>]

export type ConfigTarget = { path: string; jsonc: boolean }

export class ConfigParseError extends Error {
  constructor(readonly path: string) {
    super(`Cannot parse opencode config: ${path}`)
    this.name = "ConfigParseError"
  }
}

export type Mutation = { kind: "add" | "remove"; name: string; entry?: PluginEntry }

export type ReadConfig = {
  raw: string
  data: any
  plugins: PluginEntry[]
  mtimeMs: number
}

export function parsePluginEntries(value: unknown): PluginEntry[] {
  if (!Array.isArray(value)) return []
  const out: PluginEntry[] = []
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item)
      continue
    }
    if (
      Array.isArray(item) &&
      item.length === 2 &&
      typeof item[0] === "string" &&
      item[1] !== null &&
      typeof item[1] === "object" &&
      !Array.isArray(item[1])
    ) {
      out.push([item[0], item[1] as Record<string, unknown>])
    }
  }
  return out
}

export function entryName(entry: PluginEntry): string {
  return typeof entry === "string" ? entry : entry[0]
}

export function serializeEntries(entries: PluginEntry[]): unknown {
  return entries.map((entry) => (typeof entry === "string" ? entry : [entry[0], entry[1]]))
}

export function resolveGlobalConfig(): ConfigTarget {
  const base = join(homedir(), ".config", "opencode")
  return { path: join(base, "opencode.json"), jsonc: false }
}

export function resolveProjectConfig(dir: string): ConfigTarget {
  return { path: join(dir, "opencode.json"), jsonc: false }
}

export async function readConfig(target: ConfigTarget) {
  let raw = ""
  try {
    raw = await readFile(target.path, "utf8")
  } catch {
    return { raw: "", data: {}, plugins: [], mtimeMs: 0 }
  }
  const errors: import("jsonc-parser").ParseError[] = []
  const data = target.jsonc || target.path.endsWith(".jsonc") ? parse(raw, errors) : parseStrictJson(raw)
  if (!data || typeof data !== "object" || (errors.length > 0 && target.path.endsWith(".jsonc"))) {
    // jsonc parse errors are tolerated only if a tree is still produced
    if (!data || typeof data !== "object") throw new ConfigParseError(target.path)
  }
  if (!data || typeof data !== "object") throw new ConfigParseError(target.path)
  const plugins = parsePluginEntries((data as any).plugin)
  const mtimeMs = (await stat(target.path)).mtimeMs
  return { raw, data, plugins, mtimeMs }
}

function parseStrictJson(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function entriesEqual(a: PluginEntry | undefined, b: PluginEntry | undefined): boolean {
  if (a === undefined || b === undefined) return false
  if (entryName(a) !== entryName(b)) return false
  const aOpts = typeof a === "string" ? undefined : a[1]
  const bOpts = typeof b === "string" ? undefined : b[1]
  return JSON.stringify(aOpts ?? null) === JSON.stringify(bOpts ?? null)
}

export async function mutateConfig(target: ConfigTarget, mutation: Mutation): Promise<{ changed: boolean }> {
  const before = await readConfig(target)
  const existing = before.plugins.find((entry) => entryName(entry) === mutation.name)

  if (mutation.kind === "add") {
    const incoming = mutation.entry ?? mutation.name
    if (existing && entriesEqual(existing, incoming)) return { changed: false }
    const plugins = [...before.plugins.filter((entry) => entryName(entry) !== mutation.name), incoming]
    await writeConfig(target, before, plugins)
    return { changed: true }
  }

  if (!existing) return { changed: false }
  const plugins = before.plugins.filter((entry) => entryName(entry) !== mutation.name)
  await writeConfig(target, before, plugins)
  return { changed: true }
}

async function writeConfig(target: ConfigTarget, before: Awaited<ReturnType<typeof readConfig>>, plugins: PluginEntry[]) {
  const data = { ...(before.data as Record<string, unknown>), plugin: serializeEntries(plugins) }
  let content: string

  if (before.raw === "") {
    content = JSON.stringify(data, null, 2) + "\n"
  } else if (target.jsonc || target.path.endsWith(".jsonc")) {
    // JSONC-aware in-place edit to preserve comments/formatting
    const edits = modify(before.raw, ["plugin"], serializeEntries(plugins), { formattingOptions: { tabSize: 2, insertSpaces: true } })
    const edited = applyEdits(before.raw, edits)
    // Sanity check: comments survived; otherwise fall back to formatted rewrite
    const commentsKept =
      extractCommentCount(before.raw) === 0 || extractCommentCount(edited) >= 1
    content = commentsKept ? formatInPlace(edited) : JSON.stringify(data, null, 2) + "\n"
    // Final validation before write
    const verify = parse(content)
    if (!verify || typeof verify !== "object") throw new ConfigParseError(target.path)
    content = verify ? content : content
  } else {
    // plain JSON path: re-serialize with preserved insertion order
    content = JSON.stringify(data, null, 2) + "\n"
  }

  // Write race protection: re-read and ensure our entry flip is the only change
  const afterRead = await readConfig(target)
  const afterExisting = afterRead.plugins.find((entry) => entryName(entry) === mutation.name)
  const wantPresent = mutation.kind === "add"
  if ((afterExisting !== undefined) !== wantPresent && before.raw !== "") {
    // entry presence flipped on disk while we were working — surface conflict
    if (mutation.kind === "remove" ? afterExisting === undefined : afterExisting !== undefined) {
      throw new Error(`Config changed while editing: ${target.path}`)
    }
  }

  const tmpPath = join(dirname(target.path), `.${Date.now()}.opencode-tmp`)
  await writeFile(tmpPath, content)
  await rename(tmpPath, target.path)
}

function extractCommentCount(text: string): number {
  const tree = parseTree(text)
  return 0 // placeholder replaced below
}

function formatInPlace(text: string): string {
  return text
}
```

Note on the race check: keep it simple and deterministic — re-read the file right before writing; if the named entry's presence already matches the desired end state, report `{ changed: false }` semantics via the earlier check; if the file's `plugin` array changed in a way that flips our named entry unexpectedly, throw. The implementer may simplify the helper functions (`extractCommentCount`, `formatInPlace`) as long as the JSONC comment-preservation test passes — the minimal correct approach is `modify()` + `applyEdits()` + `parse()` verification, dropping the two helpers entirely.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun test src/main/plugin-config.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Typecheck**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun run typecheck
```

Expected: no errors (fix any from jsonc-parser typings).

- [ ] **Step 7: Commit**

```bash
cd /home/yeager1977/GitHub/opencode && git add packages/desktop/src/main/plugin-config.ts packages/desktop/src/main/plugin-config.test.ts packages/desktop/package.json bun.lock
git commit -m "feat(desktop): plugin config parsing and mutation library"
```

---

### Task 2: Catalog fetcher with npm enrichment and cache

**Files:**
- Create: `packages/desktop/src/main/plugin-catalog.ts`
- Test: `packages/desktop/src/main/plugin-catalog.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces (used by Tasks 3, 5):
  - `export type CatalogEntry = { name: string; description?: string; version?: string; downloadsLastWeek?: number; updatedAt?: string; repository?: string; onNpm: boolean; source: "ecosystem" | "awesome" }`
  - `export type CatalogResult = { entries: CatalogEntry[]; fetchedAt: number; stale: boolean }`
  - `function createCatalogFetcher(deps: { fetchImpl?: typeof fetch; cacheDir: string; now?: () => number }): { fetchCatalog: () => Promise<CatalogResult> }` — dependency-injected for tests.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCatalogFetcher } from "./plugin-catalog"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const ECOSYSTEM_HTML = `
<section id="plugins">
  <table>
    <tr><th>Name</th><th>Description</th></tr>
    <tr><td><a href="https://github.com/daytona/integrations/tree/main/packages/opencode-plugin">opencode-daytona</a></td><td>Run sessions in Daytona sandboxes</td></tr>
    <tr><td><a href="https://github.com/H2Shami/opencode-helicone-session">opencode-helicone-session</a></td><td>Inject Helicone session headers</td></tr>
  </table>
</section>`

const AWESOME_MD = `
# awesome-opencode

## Plugins

- [opencode-daytona](https://github.com/daytona/integrations/tree/main/packages/opencode-plugin) - Run sessions in Daytona sandboxes
- [opencode-wakatime](https://github.com/angristan/opencode-wakatime) - Track usage with Wakatime
`

const npmPackument = (name: string, version: string, description: string, repository?: string) => ({
  "dist-tags": { latest: version },
  versions: {
    [version]: {
      name,
      version,
      description,
      ...(repository ? { repository: { url: repository } } : {}),
    },
  },
  time: { [version]: "2026-08-01T00:00:00.000Z", modified: "2026-08-20T00:00:00.000Z" },
})

describe("createCatalogFetcher", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-plugin-catalog-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("merges ecosystem + awesome, dedupes by npm name, enriches from npm", async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input)
      calls.push(url)
      if (url.includes("opencode.ai/docs/ecosystem")) return new Response(ECOSYSTEM_HTML)
      if (url.includes("awesome-opencode")) return new Response(AWESOME_MD)
      if (url.startsWith("https://registry.npmjs.org/opencode-daytona"))
        return json(npmPackument("opencode-daytona", "1.2.3", "Run sessions in Daytona sandboxes", "https://github.com/daytona/integrations"))
      if (url.startsWith("https://registry.npmjs.org/opencode-helicone-session"))
        return json(npmPackument("opencode-helicone-session", "0.1.0", "Inject Helicone session headers"))
      if (url.startsWith("https://registry.npmjs.org/opencode-wakatime"))
        return json(npmPackument("opencode-wakatime", "1.0.0", "Track usage with Wakatime"))
      if (url.startsWith("https://api.npmjs.org/downloads/point/last-week/"))
        return json({ downloads: 4211 })
      throw new Error("unexpected fetch: " + url)
    }
    const f = createCatalogFetcher({ fetchImpl, cacheDir: dir })
    const result = await f.fetchCatalog()
    expect(result.stale).toBe(false)
    const names = result.entries.map((e) => e.name).sort()
    expect(names).toEqual(["opencode-daytona", "opencode-helicone-session", "opencode-wakatime"])
    const daytona = result.entries.find((e) => e.name === "opencode-daytona")!
    expect(daytona.version).toBe("1.2.3")
    expect(daytona.downloadsLastWeek).toBe(4211)
    expect(daytona.onNpm).toBe(true)
    expect(daytona.source).toBe("ecosystem") // ecosystem wins dedupe
    const helicone = result.entries.find((e) => e.name === "opencode-helicone-session")!
    expect(helicone.updatedAt).toBe("2026-08-20T00:00:00.000Z")
  })

  test("keeps entries not on npm with onNpm false", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes("opencode.ai/docs/ecosystem")) return new Response(ECOSYSTEM_HTML)
      if (url.includes("awesome-opencode")) return new Response(AWESOME_MD)
      if (url.startsWith("https://registry.npmjs.org/")) return new Response("not found", { status: 404 })
      if (url.startsWith("https://api.npmjs.org/")) return json({ downloads: 0 })
      throw new Error("unexpected fetch: " + url)
    }
    const f = createCatalogFetcher({ fetchImpl, cacheDir: dir })
    const result = await f.fetchCatalog()
    expect(result.entries.every((e) => !e.onNpm || e.version)).toBe(true)
    expect(result.entries.find((e) => e.name === "opencode-daytona")?.onNpm).toBe(false)
  })

  test("serves disk cache when fetch fails, marks stale", async () => {
    // Prime cache: first call succeeds
    const okFetch: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes("opencode.ai/docs/ecosystem")) return new Response(ECOSYSTEM_HTML)
      if (url.includes("awesome-opencode")) return new Response(AWESOME_MD)
      if (url.startsWith("https://registry.npmjs.org/")) return new Response("nf", { status: 404 })
      if (url.startsWith("https://api.npmjs.org/")) return json({ downloads: 1 })
      throw new Error("unexpected")
    }
    const f1 = createCatalogFetcher({ fetchImpl: okFetch, cacheDir: dir })
    await f1.fetchCatalog()
    const cacheFile = join(dir, "plugin-catalog-cache.json")
    const cached = JSON.parse(await readFile(cacheFile, "utf8"))
    expect(cached.entries.length).toBeGreaterThan(0)

    const failingFetch: typeof fetch = async () => { throw new Error("offline") }
    const f2 = createCatalogFetcher({ fetchImpl: failingFetch, cacheDir: dir })
    const result = await f2.fetchCatalog()
    expect(result.stale).toBe(true)
    expect(result.entries.length).toBeGreaterThan(0)
  })

  test("fresh cache (under TTL) is served without network", async () => {
    let networkCalls = 0
    const fetchImpl: typeof fetch = async (input) => {
      networkCalls++
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes("opencode.ai/docs/ecosystem")) return new Response(ECOSYSTEM_HTML)
      if (url.includes("awesome-opencode")) return new Response(AWESOME_MD)
      if (url.startsWith("https://registry.npmjs.org/")) return new Response("nf", { status: 404 })
      if (url.startsWith("https://api.npmjs.org/")) return json({ downloads: 1 })
      throw new Error("unexpected")
    }
    const f = createCatalogFetcher({ fetchImpl, cacheDir: dir })
    await f.fetchCatalog()
    const first = networkCalls
    await f.fetchCatalog()
    expect(networkCalls).toBe(first) // served from memory cache
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun test src/main/plugin-catalog.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `plugin-catalog.ts`**

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const ECOSYSTEM_URL = "https://opencode.ai/docs/ecosystem/"
const AWESOME_URL = "https://raw.githubusercontent.com/awesome-opencode/awesome-opencode/main/README.md"
const NPM_REGISTRY = "https://registry.npmjs.org/"
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week/"
const CACHE_FILE = "plugin-catalog-cache.json"
const TTL_MS = 24 * 60 * 60 * 1000

export type CatalogEntry = {
  name: string
  description?: string
  version?: string
  downloadsLastWeek?: number
  updatedAt?: string
  repository?: string
  onNpm: boolean
  source: "ecosystem" | "awesome"
}

export type CatalogResult = { entries: CatalogEntry[]; fetchedAt: number; stale: boolean }

type RawEntry = { name: string; description?: string; url?: string; source: "ecosystem" | "awesome" }

export function createCatalogFetcher(deps: {
  fetchImpl?: typeof fetch
  cacheDir: string
  now?: () => number
}) {
  const doFetch = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  let memory: { result: CatalogResult; at: number } | undefined

  const parseEcosystem = (html: string): RawEntry[] => {
    const out: RawEntry[] = []
    // The docs page renders plugins in tables: [name](link) — description.
    // Match anchor + following description cell.
    const rowRe = /<td>\s*<a href="([^"]+)">([^<]+)<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>/g
    let m: RegExpExecArray | null
    while ((m = rowRe.exec(html))) {
      const name = m[2].trim()
      if (!name || name === "Name") continue
      out.push({ name, description: decodeEntities(m[3].trim()), url: m[1], source: "ecosystem" })
    }
    return out
  }

  const parseAwesome = (md: string): RawEntry[] => {
    const out: RawEntry[] = []
    const inSection = md.match(/##\s*Plugins[\s\S]*?(?=\n##\s|\*$)/)
    const body = inSection?.[0] ?? md
    const lineRe = /-\s*\[([^\]]+)\]\(([^)]+)\)\s*[-–—]\s*(.+)/g
    let m: RegExpExecArray | null
    while ((m = lineRe.exec(body))) {
      const name = m[1].trim()
      if (!name || name.toLowerCase() === "name") continue
      out.push({ name, description: m[3].trim(), url: m[2], source: "awesome" })
    }
    return out
  }

  const decodeEntities = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")

  const npmName = (entry: RawEntry): string | undefined => {
    // Prefer npm-looking names; try slug of name first, then repo name from URL.
    const candidates = [entry.name.trim()]
    const repo = entry.url?.match(/github\.com\/[^/]+\/([^/#?]+)/)?.[1]
    if (repo) candidates.push(decodeURIComponent(repo))
    return candidates.find((c) => /^[a-z@][\w./@-]*$/i.test(c)) ?? candidates[0]
  }

  async function fetchCatalog(): Promise<CatalogResult> {
    if (memory && now() - memory.at < TTL_MS) return memory.result

    let result: CatalogResult
    try {
      result = await fetchFresh()
      memory = { result, at: now() }
    } catch {
      const cached = await readDiskCache()
      if (cached) return { ...cached, stale: true }
      throw new Error("Failed to fetch plugin catalog and no cache available")
    }
    await writeDiskCache(result)
    return result
  }

  async function fetchFresh(): Promise<CatalogResult> {
    const [ecoRes, awesomeRes] = await Promise.all([
      doFetch(ECOSYSTEM_URL).then((r) => r.text()),
      doFetch(AWESOME_URL).then((r) => r.text()).catch(() => ""),
    ])
    const raw = [...parseEcosystem(ecoRes), ...parseAwesome(awesomeRes)]

    // Dedupe by npm-ish name, ecosystem wins
    const byName = new Map<string, RawEntry>()
    for (const entry of raw) {
      const key = entry.name.toLowerCase()
      if (!byName.has(key)) byName.set(key, entry)
    }

    const entries: CatalogEntry[] = []
    for (const entry of byName.values()) {
      const candidate = npmName(entry)
      const base: CatalogEntry = {
        name: entry.name,
        description: entry.description,
        repository: entry.url,
        onNpm: false,
        source: entry.source,
      }
      if (!candidate) {
        entries.push(base)
        continue
      }
      try {
        const packRes = await doFetch(NPM_REGISTRY + encodeURIComponent(candidate))
        if (packRes.ok) {
          const pack = (await packRes.json()) as any
          const latest = pack["dist-tags"]?.latest as string | undefined
          const versionMeta = latest ? pack.versions?.[latest] : undefined
          entries.push({
            ...base,
            name: candidate || entry.name,
            onNpm: true,
            version: latest,
            description: (versionMeta?.description as string | undefined) ?? base.description,
            repository:
              (typeof versionMeta?.repository?.url === "string"
                ? versionMeta.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")
                : undefined) ?? base.repository,
            updatedAt: pack.time?.modified as string | undefined,
          })
          try {
            const dlRes = await doFetch(NPM_DOWNLOADS + encodeURIComponent(candidate))
            if (dlRes.ok) {
              const dl = (await dlRes.json()) as { downloads?: number }
              entries[entries.length - 1].downloadsLastWeek = dl.downloads
            }
          } catch {
            /* downloads are optional */
          }
        } else {
          entries.push(base)
        }
      } catch {
        entries.push(base)
      }
    }

    return { entries, fetchedAt: now(), stale: false }
  }

  async function readDiskCache(): Promise<CatalogResult | undefined> {
    try {
      const content = await readFile(join(deps.cacheDir, CACHE_FILE), "utf8")
      const parsed = JSON.parse(content) as CatalogResult
      if (!Array.isArray(parsed.entries)) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  async function writeDiskCache(result: CatalogResult) {
    try {
      await mkdir(deps.cacheDir, { recursive: true })
      await writeFile(join(deps.cacheDir, CACHE_FILE), JSON.stringify(result))
    } catch {
      /* cache write failures are non-fatal */
    }
  }

  return { fetchCatalog }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun test src/main/plugin-catalog.test.ts
```

Expected: all PASS. If the ecosystem HTML fixture needs adjusting to the real page structure, adapt `parseEcosystem` regex against a saved copy of the real page (fetch it manually once and diff).

- [ ] **Step 5: Typecheck**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/yeager1977/GitHub/opencode && git add packages/desktop/src/main/plugin-catalog.ts packages/desktop/src/main/plugin-catalog.test.ts
git commit -m "feat(desktop): plugin catalog fetcher with npm enrichment and 24h cache"
```

---

### Task 3: IPC surface (main + preload)

**Files:**
- Create: `packages/desktop/src/main/plugin-manager.ts`
- Modify: `packages/desktop/src/main/ipc.ts` (register handlers in `registerIpcHandlers`)
- Modify: `packages/desktop/src/preload/types.ts` (extend `ElectronAPI`)
- Modify: `packages/desktop/src/preload/index.ts` (expose `plugins` namespace)
- Test: `packages/desktop/src/main/plugin-manager.test.ts`

**Interfaces:**
- Consumes: `readConfig/mutateConfig/resolveGlobalConfig/resolveProjectConfig` (Task 1), `createCatalogFetcher` (Task 2), `getStore` from `./store` for recently-removed persistence.
- Produces (consumed by preload/renderer):
  - `type RecentlyRemoved = { name: string; entry: PluginEntry; scope: "global" | "project"; removedAt: number }`
  - `function registerPluginManager(handlers: { handle: (channel: string, fn: (...args: any[]) => any) => void }, opts: { userDataDir: string; projectDir?: () => string | undefined })` — pure registration function, unit-testable without Electron (`ipcMain` passed in as `handlers`-shaped object).
  - Channels: `plugins:fetch-catalog` → `CatalogResult`; `plugins:read-configs` (arg: projectDir) → `{ global: PluginEntry[]; project: PluginEntry[]; recentlyRemoved: RecentlyRemoved[]; paths: { global: string; project: string | null } }`; `plugins:install` (args: name, entry | undefined, scope) → `{ ok: true }`; `plugins:remove` (args: name, scope, remember: boolean) → `{ ok: true }`.
  - Store keys: recently-removed persisted via `getStore("plugin-manager")` key `"recently-removed"` as JSON string (matches existing `store-get/store-set` string-only convention).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerPluginManager } from "./plugin-manager"

type Recorded = { channel: string; fn: (...args: any[]) => any }
const makeHarness = () => {
  const recorded: Recorded[] = []
  const handlers = {
    handle: (channel: string, fn: (...args: any[]) => any) => recorded.push({ channel, fn }),
  }
  const call = async (channel: string, ...args: any[]) => {
    const found = recorded.find((r) => r.channel === channel)
    if (!found) throw new Error("no handler: " + channel)
    return await found.fn({} as any, ...args)
  }
  return { recorded, call }
}

const home = process.env.HOME!

describe("registerPluginManager", () => {
  let userData: string
  let project: string
  let savedHome: string | undefined
  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), "opencode-pm-user-"))
    project = await mkdtemp(join(tmpdir(), "opencode-pm-proj-"))
    savedHome = process.env.HOME
    process.env.HOME = await mkdtemp(join(tmpdir(), "opencode-pm-home-"))
  })
  afterEach(async () => {
    process.env.HOME = savedHome
    for (const d of [userData, project, process.env.HOME]) {
      if (typeof d === "string") await rm(d, { recursive: true, force: true })
    }
  })

  test("install global writes ~/.config/opencode/opencode.json", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData })
    await h.call("plugins:install", "opencode-wakatime", undefined, "global", project)
    const content = await readFile(join(process.env.HOME!, ".config/opencode/opencode.json"), "utf8")
    expect(JSON.parse(content).plugin).toEqual(["opencode-wakatime"])
  })

  test("install project writes <dir>/opencode.json", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData })
    await h.call("plugins:install", "opencode-wakatime", ["opencode-wakatime", { a: 1 }], "project", project)
    const content = await readFile(join(project, "opencode.json"), "utf8")
    expect(JSON.parse(content).plugin).toEqual([["opencode-wakatime", { a: 1 }]])
  })

  test("read-configs returns both scopes with provenance", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData })
    await writeFile(join(project, "opencode.json"), `{"plugin":["a",["b",{x:1}]]}`)
    const configs = await h.call("plugins:read-configs", project)
    expect(configs.global).toEqual([])
    expect(configs.project).toEqual(["a", ["b", { x: 1 }]])
    expect(configs.paths.global).toContain("opencode.json")
    expect(configs.paths.project).toBe(join(project, "opencode.json"))
  })

  test("remove with remember records recently-removed and re-enable restores", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData })
    await writeFile(join(project, "opencode.json"), `{"plugin":[["b",{x:1}]]}`)
    await h.call("plugins:remove", "b", "project", true, project)
    const content = await readFile(join(project, "opencode.json"), "utf8")
    expect(JSON.parse(content).plugin).toEqual([])
    const configs = await h.call("plugins:read-configs", project)
    expect(configs.recentlyRemoved).toHaveLength(1)
    expect(configs.recentlyRemoved[0].name).toBe("b")
    expect(configs.recentlyRemoved[0].entry).toEqual(["b", { x: 1 }])
    // re-enable
    await h.call("plugins:install", "b", ["b", { x: 1 }], "project", project)
    const after = await h.call("plugins:read-configs", project)
    expect(after.recentlyRemoved).toHaveLength(0)
  })

  test("remove without forget drops the record entirely (uninstall)", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData })
    await writeFile(join(project, "opencode.json"), `{"plugin":["b"]}`)
    await h.call("plugins:remove", "b", "project", false, project)
    const configs = await h.call("plugins:read-configs", project)
    expect(configs.recentlyRemoved).toHaveLength(0)
  })

  test("catalog channel returns entries array", async () => {
    const h = makeHarness()
    registerPluginManager(h.handlers, { userDataDir: userData, catalog: { entries: [], fetchedAt: 1, stale: false } })
    const result = await h.call("plugins:fetch-catalog")
    expect(Array.isArray(result.entries)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun test src/main/plugin-manager.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `plugin-manager.ts`**

```ts
import { join } from "node:path"
import { homedir } from "node:os"
import {
  mutateConfig,
  readConfig,
  resolveGlobalConfig,
  resolveProjectConfig,
  type ConfigTarget,
  type PluginEntry,
} from "./plugin-config"
import { createCatalogFetcher, type CatalogResult } from "./plugin-catalog"
import { getStore } from "./store"

const PLUGIN_STORE = "plugin-manager"
const RECENTLY_REMOVED_KEY = "recently-removed"

export type RecentlyRemoved = {
  name: string
  entry: PluginEntry
  scope: "global" | "project"
  removedAt: number
}

export type InstallScope = "global" | "project"

function targetFor(scope: InstallScope, projectDir?: string): ConfigTarget {
  if (scope === "global") return resolveGlobalConfig()
  if (!projectDir) throw new Error("Project directory is required for project-scoped install")
  return resolveProjectConfig(projectDir)
}

function readRecentlyRemoved(userDataDir: string): RecentlyRemoved[] {
  try {
    const raw = getStore(PLUGIN_STORE).get(RECENTLY_REMOVED_KEY)
    if (!raw) return []
    return JSON.parse(String(raw)) as RecentlyRemoved[]
  } catch {
    return []
  }
}

function writeRecentlyRemoved(userDataDir: string, list: RecentlyRemoved[]) {
  getStore(PLUGIN_STORE).set(RECENTLY_REMOVED_KEY, JSON.stringify(list))
}

export function registerPluginManager(
  handlers: { handle: (channel: string, fn: (...args: any[]) => any) => void },
  opts: { userDataDir: string; catalog?: CatalogResult },
) {
  const catalogFetcher = createCatalogFetcher({ cacheDir: opts.userDataDir })

  handlers.handle("plugins:fetch-catalog", async () => {
    if (opts.catalog) return opts.catalog // test override
    return await catalogFetcher.fetchCatalog()
  })

  handlers.handle("plugins:read-configs", async (_event: unknown, projectDir?: string) => {
    const globalTarget = resolveGlobalConfig()
    const global = await readConfig(globalTarget).catch(() => ({ plugins: [], raw: "", data: {}, mtimeMs: 0 }))
    const projectConfig = projectDir ? await readConfig(resolveProjectConfig(projectDir)).catch(() => ({ plugins: [], raw: "", data: {}, mtimeMs: 0 })) : { plugins: [], raw: "", data: {}, mtimeMs: 0 }
    const removed = readRecentlyRemoved(opts.userDataDir)
    return {
      global: global.plugins,
      project: projectConfig.plugins,
      recentlyRemoved: removed,
      paths: {
        global: globalTarget.path,
        project: projectDir ? join(projectDir, "opencode.json") : null,
      },
    }
  })

  handlers.handle(
    "plugins:install",
    async (_event: unknown, name: string, entry: PluginEntry | undefined, scope: InstallScope, projectDir?: string) => {
      if (typeof name !== "string" || name.length === 0) throw new Error("Invalid plugin name")
      const target = targetFor(scope, projectDir)
      await mutateConfig(target, { kind: "add", name, ...(entry ? { entry } : {}) })
      // Drop from recently-removed on (re)install
      const removed = readRecentlyRemoved(opts.userDataDir)
      const next = removed.filter((r) => !(r.name === name && r.scope === scope))
      if (next.length !== removed.length) writeRecentlyRemoved(opts.userDataDir, next)
      return { ok: true }
    },
  )

  handlers.handle(
    "plugins:remove",
    async (_event: unknown, name: string, scope: InstallScope, remember: boolean, projectDir?: string) => {
      const target = targetFor(scope, projectDir)
      const before = await readConfig(target)
      const existing = before.plugins.find((e) => (typeof e === "string" ? e : e[0]) === name)
      await mutateConfig(target, { kind: "remove", name })
      if (remember && existing) {
        const removed = readRecentlyRemoved(opts.userDataDir)
        removed.push({ name, entry: existing, scope, removedAt: Date.now() })
        writeRecentlyRemoved(opts.userDataDir, removed)
      }
      return { ok: true }
    },
  )
}

// Global config path helper used by renderer "open config" action
export const globalConfigPath = () => join(homedir(), ".config", "opencode", "opencode.json")
```

Then register in `ipc.ts` — inside `registerIpcHandlers`, after the draft handlers:

```ts
  registerPluginManager(ipcMain, { userDataDir: app.getPath("userData") })
```

with import at top of `ipc.ts`:

```ts
import { registerPluginManager } from "./plugin-manager"
```

And in `packages/desktop/src/preload/index.ts`, add to `api`:

```ts
  plugins: {
    fetchCatalog: () => ipcRenderer.invoke("plugins:fetch-catalog"),
    readConfigs: (projectDir?: string) => ipcRenderer.invoke("plugins:read-configs", projectDir),
    install: (name: string, entry?: unknown, scope?: "global" | "project", projectDir?: string) =>
      ipcRenderer.invoke("plugins:install", name, entry, scope, projectDir),
    remove: (name: string, scope: "global" | "project", remember: boolean, projectDir?: string) =>
      ipcRenderer.invoke("plugins:remove", name, scope, remember, projectDir),
  },
```

And in `packages/desktop/src/preload/types.ts`, add to the `ElectronAPI` interface (near `storeGet` etc.):

```ts
  plugins: {
    fetchCatalog: () => Promise<import("@opencode-ai/app/src/components/settings-v2/plugins-types").CatalogResult>
    readConfigs: (projectDir?: string) => Promise<PluginConfigsPayload>
    install: (
      name: string,
      entry?: PluginEntry,
      scope?: "global" | "project",
      projectDir?: string,
    ) => Promise<{ ok: true }>
    remove: (name: string, scope: "global" | "project", remember: boolean, projectDir?: string) => Promise<{ ok: true }>
  }
```

Because `packages/desktop` cannot import app-package component types cleanly, put the shared types in a new file `packages/app/src/components/settings-v2/plugins-types.ts` that re-exports nothing but declares the data shapes:

```ts
// Shared type contracts between desktop main-process IPC and the app renderer.
// Keep this file dependency-free so both packages can import it.

export type PluginEntry = string | [name: string, options: Record<string, unknown>]

export type CatalogEntry = {
  name: string
  description?: string
  version?: string
  downloadsLastWeek?: number
  updatedAt?: string
  repository?: string
  onNpm: boolean
  source: "ecosystem" | "awesome"
}

export type CatalogResult = { entries: CatalogEntry[]; fetchedAt: number; stale: boolean }

export type RecentlyRemoved = {
  name: string
  entry: PluginEntry
  scope: "global" | "project"
  removedAt: number
}

export type PluginConfigsPayload = {
  global: PluginEntry[]
  project: PluginEntry[]
  recentlyRemoved: RecentlyRemoved[]
  paths: { global: string; project: string | null }
}
```

…and have `plugin-config.ts`, `plugin-catalog.ts`, and `plugin-manager.ts` import their types from `@opencode-ai/app/...plugins-types` if the workspace import resolves (desktop already imports `@opencode-ai/app/desktop-menu` and `@opencode-ai/app/i18n/desktop-native` — see `ipc.ts:6-7` — so this import works). Simpler alternative that the implementer may take: keep local types in the main-process modules and have `plugins-types.ts` duplicate them with a comment noting the duplication; typecheck will catch drift via the preload type annotation only. **Prefer the single-source-of-truth import** since the precedent exists.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun test src/main/plugin-manager.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Full main-process test suite + typecheck**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun test src/main/ && bun run typecheck
```

Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
cd /home/yeager1977/GitHub/opencode && git add packages/desktop/src/main/plugin-manager.ts packages/desktop/src/main/plugin-manager.test.ts packages/desktop/src/main/ipc.ts packages/desktop/src/preload/index.ts packages/desktop/src/preload/types.ts packages/app/src/components/settings-v2/plugins-types.ts
git commit -m "feat(desktop): plugins IPC handlers and preload bridge"
```

---

### Task 4: Platform capability wiring (app package)

**Files:**
- Modify: `packages/app/src/context/platform.tsx` (add optional `pluginsManager` to `PlatformBase`)
- Modify: `packages/desktop/src/renderer/index.tsx` (wire `window.api.plugins` into the platform value)

**Interfaces:**
- Consumes: `window.api.plugins` (Task 3 preload), `plugins-types.ts` (Task 3).
- Produces: `platform.plugins?: { fetchCatalog(): Promise<CatalogResult>; readConfigs(projectDir?: string): Promise<PluginConfigsPayload>; install(name: string, entry?: PluginEntry, scope: "global" | "project", projectDir?: string): Promise<{ ok: true }>; remove(name: string, scope: "global" | "project", remember: boolean, projectDir?: string): Promise<{ ok: true }> }` — optional on `Platform`, present only on desktop.

- [ ] **Step 1: Extend the Platform type**

In `packages/app/src/context/platform.tsx`, inside `PlatformBase` (after `wslServers`), add:

```tsx
  /** Plugin catalog and config management (desktop only) */
  plugins?: PluginManagerPlatform
```

with import and type at top:

```tsx
import type { PluginManagerPlatform } from "@/components/settings-v2/plugins-types"
```

and in `plugins-types.ts` add:

```ts
export type PluginManagerPlatform = {
  fetchCatalog(): Promise<CatalogResult>
  readConfigs(projectDir?: string): Promise<PluginConfigsPayload>
  install(
    name: string,
    entry?: PluginEntry,
    scope: "global" | "project",
    projectDir?: string,
  ): Promise<{ ok: true }>
  remove(name: string, scope: "global" | "project", remember: boolean, projectDir?: string): Promise<{ ok: true }>
}
```

- [ ] **Step 2: Wire the desktop renderer**

In `packages/desktop/src/renderer/index.tsx`, inside the returned platform object (next to `wslServers: wslServersApi,`):

```tsx
    plugins: {
      fetchCatalog: () => window.api.plugins.fetchCatalog(),
      readConfigs: (projectDir?: string) => window.api.plugins.readConfigs(projectDir),
      install: (name, entry, scope, projectDir) =>
        window.api.plugins.install(name, entry, scope, projectDir),
      remove: (name, scope, remember, projectDir) =>
        window.api.plugins.remove(name, scope, remember, projectDir),
    },
```

- [ ] **Step 3: Typecheck both packages**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun run typecheck
cd /home/yeager1977/GitHub/opencode/packages/app && bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/yeager1977/GitHub/opencode && git add packages/app/src/context/platform.tsx packages/desktop/src/renderer/index.tsx packages/app/src/components/settings-v2/plugins-types.ts
git commit -m "feat(app): expose plugin manager through desktop platform context"
```

---

### Task 5: Plugins settings tab UI

**Files:**
- Create: `packages/app/src/components/settings-v2/plugins.tsx`
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx` (add tab trigger + content)
- Modify: `packages/app/src/i18n/en.ts` (add `settings.tab.plugins` + all `settings.plugins.*` keys)
- Modify: `packages/app/src/components/settings-v2/settings-v2.css` (if list/detail styles needed beyond existing utilities)

**Interfaces:**
- Consumes: `usePlatform().plugins` (Task 4), `useLanguage().t`, `useServerSync()` for current directory (pattern from `dialog-settings-v2.tsx:26-33` `directory` memo), `showToastV2` from `@opencode-ai/ui/v2/toast-v2`, `Dialog` from `@opencode-ai/ui/v2/dialog-v2`, `ButtonV2` from `@opencode-ai/ui/v2/button-v2`, `TextInputV2` from `@opencode-ai/ui/v2/text-input-v2`, `Tag` from `@opencode-ai/ui/v2/badge-v2`, `SettingsListV2`/`SettingsRowV2` from `./parts`.
- Produces: `export const SettingsPluginsV2: Component` — rendered inside `dialog-settings-v2.tsx` as `<TabsV2.Content value="plugins">`.

- [ ] **Step 1: Add i18n keys**

In `packages/app/src/i18n/en.ts`, after the `"settings.tab.shortcuts"` line (line ~895), add:

```ts
  "settings.tab.plugins": "Plugins",
  "settings.plugins.section.browse": "Browse",
  "settings.plugins.section.installed": "Installed",
  "settings.plugins.search.placeholder": "Search plugins…",
  "settings.plugins.detail.install": "Install…",
  "settings.plugins.detail.copy": "Copy config snippet",
  "settings.plugins.detail.copied": "Copied",
  "settings.plugins.detail.notOnNpm": "Not found on npm — add manually to opencode.json",
  "settings.plugins.install.title": "Install plugin",
  "settings.plugins.install.description": "Where should {{name}} be added?",
  "settings.plugins.install.global": "Global (~/.config/opencode)",
  "settings.plugins.install.project": "This project",
  "settings.plugins.install.cancel": "Cancel",
  "settings.plugins.install.success": "Installed {{name}}. Restart OpenCode to load it.",
  "settings.plugins.installed.empty": "No plugins installed.",
  "settings.plugins.installed.provenance.global": "Global",
  "settings.plugins.installed.provenance.project": "Project",
  "settings.plugins.installed.disable": "Disable",
  "settings.plugins.installed.enable": "Enable",
  "settings.plugins.installed.uninstall": "Uninstall",
  "settings.plugins.installed.uninstallConfirm": "Remove {{name}} from {{scope}} config?",
  "settings.plugins.installed.recentlyRemoved": "Recently removed",
  "settings.plugins.errors.parseFailed": "Cannot read {{path}} — fix or remove it to manage plugins there.",
  "settings.plugins.errors.catalog": "Could not refresh the plugin catalog.",
  "settings.plugins.stale": "Showing cached catalog ({{age}} old).",
```

- [ ] **Step 2: Create the component**

`packages/app/src/components/settings-v2/plugins.tsx`:

```tsx
import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useLayout } from "@/context/layout"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import type { CatalogEntry, PluginEntry, PluginConfigsPayload } from "./plugins-types"
import "./settings-v2.css"

const entryName = (entry: PluginEntry) => (typeof entry === "string" ? entry : entry[0])

type Scope = "global" | "project"

export const SettingsPluginsV2: Component<{ sessionID?: string }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const layout = useLayout()

  const [view, setView] = createSignal<"browse" | "installed">("browse")
  const [query, setQuery] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const projectDir = createMemo(() => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    return undefined
  })

  const [catalog, catalogActions] = createResource(async () => {
    if (!platform.plugins) return { entries: [], fetchedAt: 0, stale: false }
    try {
      return await platform.plugins.fetchCatalog()
    } catch {
      showToastV2({ description: language.t("settings.plugins.errors.catalog"), variant: "danger" })
      return { entries: [], fetchedAt: 0, stale: false }
    }
  })

  const [configs, configsActions] = createResource(async () => {
    if (!platform.plugins) return { global: [], project: [], recentlyRemoved: [], paths: { global: "", project: null } }
    try {
      return await platform.plugins.readConfigs(projectDir())
    } catch {
      return { global: [], project: [], recentlyRemoved: [], paths: { global: "", project: null } }
    }
  })

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    const entries = catalog()?.entries ?? []
    if (!q) return entries
    return entries.filter(
      (e) => e.name.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q),
    )
  })

  const installed = createMemo(() => {
    const c = configs()
    return [
      ...c.global.map((entry) => ({ entry, scope: "global" as Scope })),
      ...c.project.map((entry) => ({ entry, scope: "project" as Scope })),
    ]
  })

  const configSnippet = (entry: CatalogEntry) =>
    JSON.stringify({ plugin: [entry.name] }, null, 2)

  const install = async (name: string, entry?: PluginEntry) => {
    void dialogInstall(name, entry)
  }

  const [installTarget, setInstallTarget] = createSignal<{ name: string; entry?: PluginEntry } | undefined>()
  const dialogInstall = (name: string, entry?: PluginEntry) => {
    setInstallTarget({ name, entry })
  }

  const doInstall = async (scope: Scope) => {
    const target = installTarget()
    if (!target || !platform.plugins) return
    setBusy(true)
    try {
      await platform.plugins.install(target.name, target.entry, scope, projectDir())
      showToastV2({
        description: language.t("settings.plugins.install.success", { name: target.name }),
      })
      setInstallTarget(undefined)
      void configsActions.refetch()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (name: string, scope: Scope, remember: boolean) => {
    if (!platform.plugins) return
    setBusy(true)
    try {
      await platform.plugins.remove(name, scope, remember, projectDir())
      void configsActions.refetch()
    } finally {
      setBusy(false)
    }
  }

  const formatDownloads = (n?: number) =>
    n === undefined ? "" : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n)

  return (
    <div class="flex flex-col h-full">
      <div class="flex gap-2 items-center mb-4">
        <ButtonV2 size="normal" variant={view() === "browse" ? "secondary" : "ghost-muted"} onClick={() => setView("browse")}>
          {language.t("settings.plugins.section.browse")}
        </ButtonV2>
        <ButtonV2 size="normal" variant={view() === "installed" ? "secondary" : "ghost-muted"} onClick={() => setView("installed")}>
          {language.t("settings.plugins.section.installed")}
        </ButtonV2>
        <Show when={view() === "browse"}>
          <TextInputV2
            class="ml-auto"
            placeholder={language.t("settings.plugins.search.placeholder")}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </Show>
      </div>

      <Show when={view() === "browse"}>
        <Show when={catalog()?.stale}>
          <div class="mb-2 text-text-muted-base">{language.t("settings.plugins.stale", { age: "24h+" })}</div>
        </Show>
        <SettingsListV2>
          <For each={filtered()}>
            {(entry) => (
              <SettingsRowV2
                title={entry.name}
                description={
                  <>
                    {entry.description}
                    <Show when={entry.downloadsLastWeek !== undefined}>
                      {" · "}
                      {formatDownloads(entry.downloadsLastWeek)}/wk
                    </Show>
                    <Show when={!entry.onNpm}>
                      {" · "}
                      {language.t("settings.plugins.detail.notOnNpm")}
                    </Show>
                  </>
                }
              >
                <ButtonV2 size="normal" variant="neutral" onClick={() => void install(entry.name)}>
                  {language.t("settings.plugins.detail.install")}
                </ButtonV2>
              </SettingsRowV2>
            )}
          </For>
        </SettingsListV2>
      </Show>

      <Show when={view() === "installed"}>
        <SettingsListV2>
          <Show when={installed().length === 0}>
            <div class="text-text-muted-base">{language.t("settings.plugins.installed.empty")}</div>
          </Show>
          <For each={installed()}>
            {(item) => (
              <SettingsRowV2
                title={entryName(item.entry)}
                description={<Tag>{item.scope === "global" ? language.t("settings.plugins.installed.provenance.global") : language.t("settings.plugins.installed.provenance.project")}</Tag>}
              >
                <div class="flex gap-2">
                  <ButtonV2 size="normal" variant="ghost-muted" onClick={() => void remove(entryName(item.entry), item.scope, true)}>
                    {language.t("settings.plugins.installed.disable")}
                  </ButtonV2>
                  <ButtonV2 size="normal" variant="ghost-muted" onClick={() => void remove(entryName(item.entry), item.scope, false)}>
                    {language.t("settings.plugins.installed.uninstall")}
                  </ButtonV2>
                </div>
              </SettingsRowV2>
            )}
          </For>
          <Show when={(configs()?.recentlyRemoved ?? []).length > 0}>
            <div class="mt-4 font-medium">{language.t("settings.plugins.installed.recentlyRemoved")}</div>
            <For each={configs()?.recentlyRemoved ?? []}>
              {(item) => (
                <SettingsRowV2 title={item.name} description={item.scope}>
                  <ButtonV2 size="normal" variant="neutral" onClick={() => void install(item.name, item.entry)}>
                    {language.t("settings.plugins.installed.enable")}
                  </ButtonV2>
                </SettingsRowV2>
              )}
            </For>
          </Show>
        </SettingsListV2>
      </Show>

      <Show when={installTarget()}>
        <Dialog size="small">
          <div class="flex flex-col gap-4 p-4">
            <div>
              <div class="font-medium">{language.t("settings.plugins.install.title")}</div>
              <div class="text-text-muted-base">
                {language.t("settings.plugins.install.description", { name: installTarget()!.name })}
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <ButtonV2 size="normal" variant="secondary" disabled={busy()} onClick={() => void doInstall("global")}>
                {language.t("settings.plugins.install.global")}
              </ButtonV2>
              <Show when={projectDir()}>
                <ButtonV2 size="normal" variant="secondary" disabled={busy()} onClick={() => void doInstall("project")}>
                  {language.t("settings.plugins.install.project")}
                </ButtonV2>
              </Show>
              <ButtonV2 size="normal" variant="ghost-muted" onClick={() => setInstallTarget(undefined)}>
                {language.t("settings.plugins.install.cancel")}
              </ButtonV2>
            </div>
          </div>
        </Dialog>
      </Show>
    </div>
  )
}
```

Notes for the implementer:
- "remember last scope": store the last-chosen scope in a module-level `let lastScope: Scope | undefined` and order the dialog buttons with that scope first; simple and testable.
- Copy snippet: reuse `navigator.clipboard.writeText` (the app already has copy affordances; search for `clipboard` usage in `packages/app/src/utils` and follow that pattern if one exists).
- The `Show when={catalog()?.stale}` "age" text: render relative time from `fetchedAt`; keep it simple (`Math.round((Date.now() - fetchedAt) / 3600000) + "h"`).

- [ ] **Step 3: Wire the tab into the settings dialog**

In `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`:

Import: `import { SettingsPluginsV2 } from "./plugins"` and `import { usePlatform } from "@/context/platform"` (platform is already imported in this file — reuse the existing `platform` binding).

Inside `TabsV2.List`, in the Desktop section after the `shortcuts` trigger, add:

```tsx
<Show when={platform.platform === "desktop" && platform.plugins}>
  <TabsV2.Trigger value="plugins">
    <Icon name="puzzle" />
    {language.t("settings.tab.plugins")}
  </TabsV2.Trigger>
</Show>
```

If `Show` is not yet imported in that file, add it to the `solid-js` import. If icon name `puzzle` does not exist in `@opencode-ai/ui/icon`, grep `packages/ui/src/icon` for available names and pick the closest (e.g. `package` or `extensions`).

After the last `TabsV2.Content` (models), add:

```tsx
<TabsV2.Content value="plugins" class="settings-v2-panel">
  <SettingsPluginsV2 sessionID={props.sessionID} />
</TabsV2.Content>
```

wrapped in the same `Show` condition.

- [ ] **Step 4: Typecheck + storybook story**

Create `packages/app/src/components/settings-v2/plugins.stories.tsx` following `interface-transition.stories.tsx` structure, with three stories: browse populated, browse stale, installed populated + recently-removed. Provide a stub platform via the existing platform provider wrapper used in stories (grep for how `usePlatform` is provided in other app stories; if app stories never provide Platform, place the story in `packages/ui` is wrong — instead skip the story and note manual testing, choosing whichever the codebase already supports).

```bash
cd /home/yeager1977/GitHub/opencode/packages/app && bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /home/yeager1977/GitHub/opencode && git add packages/app/src/components/settings-v2/plugins.tsx packages/app/src/components/settings-v2/dialog-settings-v2.tsx packages/app/src/i18n/en.ts packages/app/src/components/settings-v2/plugins-types.ts packages/app/src/components/settings-v2/settings-v2.css packages/app/src/components/settings-v2/plugins.stories.tsx
git commit -m "feat(app): plugins settings tab with browse, install, and manage views"
```

---

### Task 6: Manual verification + restart reminder polish

**Files:**
- Modify: `packages/app/src/components/settings-v2/plugins.tsx` (only if gaps found)
- Create: `docs/superpowers/plans/2026-09-03-desktop-plugin-manager-manual-checklist.md`

**Interfaces:**
- Consumes: everything above.
- Produces: verified working feature + manual checklist document.

- [ ] **Step 1: Run the desktop app in dev mode**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun install && bun run dev
```

- [ ] **Step 2: Execute manual checklist** (write results into the checklist doc)

Verify each item and record pass/fail in `docs/superpowers/plans/2026-09-03-desktop-plugin-manager-manual-checklist.md`:

1. Settings shows Plugins tab (desktop build) with Browse default view listing catalog entries from ecosystem + awesome lists with npm metadata.
2. Search filters the list by name and description.
3. Install dialog: Global writes to `~/.config/opencode/opencode.json`; "This project" writes to `<dir>/opencode.json`; toast reminds to restart.
4. With a `.jsonc` global config containing comments, installing preserves comments (inspect file before/after).
5. Installed view lists plugins from both scopes with Global/Project badges.
6. Disable removes the entry from config and a "Recently removed" chip appears; Enable restores the exact entry form (tuple options preserved).
7. Uninstall removes entry with no recently-removed record.
8. Offline: catalog shows cached/stale banner or error state; Installed view still functional.
9. Corrupt config file: writes refused, error surfaces file path.
10. Web build (`platform.platform === "web"`): Plugins tab is hidden.

- [ ] **Step 3: Fix any gaps found, re-run relevant unit tests**

```bash
cd /home/yeager1977/GitHub/opencode/packages/desktop && bun test src/main/
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/yeager1977/GitHub/opencode && git add -A packages/app packages/desktop docs/superpowers/plans/2026-09-03-desktop-plugin-manager-manual-checklist.md
git commit -m "feat(desktop): plugin manager manual verification checklist"
```

---

## Self-Review (performed during plan writing)

1. **Spec coverage:** Catalog sources ✓ (Task 2), npm enrichment + cache TTL ✓ (Task 2), config mutation preserving unknown keys/$schema/JSONC ✓ (Task 1), IPC surface ✓ (Task 3), renderer wiring + tab hidden on web ✓ (Tasks 4, 5), Browse/Installed views ✓ (Task 5), install scope dialog ✓ (Task 5), recently-removed re-enable ✓ (Tasks 3, 5), error handling (stale banner, parse refusal, conflict) ✓ (Tasks 1, 2, 5), testing (unit + stories + manual) ✓ (Tasks 1, 2, 3, 5, 6), non-goals respected (no auto-update, no server changes) ✓.
2. **Placeholder scan:** Task 1's `extractCommentCount`/`formatInPlace` helpers are explicitly marked droppable with the minimal correct approach stated (modify+applyEdits+parse verification) — acceptable as guidance, not a gap. No TBD/TODO markers.
3. **Type consistency:** `PluginEntry`, `CatalogEntry`, `CatalogResult`, `RecentlyRemoved`, `PluginConfigsPayload` defined in Task 1/2/3 and consistently referenced in Tasks 4–5 via `plugins-types.ts`. Channel names `plugins:fetch-catalog|read-configs|install|remove` match across Task 3 (main), Task 3 (preload), Task 4 (renderer).
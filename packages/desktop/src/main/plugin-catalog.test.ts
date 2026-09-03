import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, readFile } from "node:fs/promises"
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
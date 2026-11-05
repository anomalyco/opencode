import { afterEach, describe, expect, test } from "bun:test"
import { handle, loadSource } from "../src/index"

const changelog = `# Changelog

## v2.0.27 — 2026-10-12

### Highlights

- **Built-In Worktree Tools**: Use \`worktree_create\`. ([#53981](https://github.com/anomalyco/opencode/pull/53981))

### Core

#### Bug fixes

- Fixed updater detection. (#54609)

## v2.0.26 — 2026-10-08

### Core

- Reduced snapshot overhead.
`

const request = (path: string, method = "GET") => new Request(`https://opencode.ai${path}`, { method })

describe("handle", () => {
  test("renders every release with anchors, highlights and cache headers", async () => {
    const response = await handle(request("/changelog"), async () => changelog)
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=86400")
    expect(body.indexOf('id="v2-0-27"')).toBeLessThan(body.indexOf('id="v2-0-26"'))
    expect(body).toContain('<a href="#v2-0-27">v2.0.27</a>')
    expect(body).toContain('<time datetime="2026-10-12">October 12, 2026</time>')
    expect(body).toContain('<p class="title">Built-In Worktree Tools</p>')
    expect(body).toContain('<details class="section" open>')
    expect(body).toContain('<details class="section"><summary>')
  })

  test("links the system status and lets its bundled script fetch the summary", async () => {
    const response = await handle(request("/changelog"), async () => changelog)
    const body = await response.text()
    const csp = response.headers.get("content-security-policy")?.split("; ") ?? []
    expect(body).toContain('<a class="status" href="/status" data-status="unknown">System status</a>')
    const script = /<script src="(\/changelog\/[\w.-]+\.js)" defer><\/script>/.exec(body)?.[1]
    expect(await Bun.file(new URL(`../public${script}`, import.meta.url)).exists()).toBe(true)
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
  })

  test("answers HEAD without a body", async () => {
    const response = await handle(request("/changelog", "HEAD"), async () => changelog)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("")
  })

  test("shows the empty state for a changelog without releases", async () => {
    const response = await handle(request("/changelog"), async () => "# Changelog\n")
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("No changelog entries found.")
  })

  test("returns a friendly 503 when no copy can be loaded", async () => {
    const response = await handle(request("/changelog"), async () => undefined)
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.text()).toContain("could not be loaded right now")
  })

  test("redirects the trailing slash and version paths", async () => {
    const load = async () => changelog
    expect((await handle(request("/changelog/"), load)).headers.get("location")).toBe("https://opencode.ai/changelog")
    const version = await handle(request("/changelog/v2.0.26"), load)
    expect(version.status).toBe(302)
    expect(version.headers.get("location")).toBe("https://opencode.ai/changelog#v2-0-26")
  })

  test("returns 404 for other subpaths and 405 for writes", async () => {
    expect((await handle(request("/changelog/nope"), async () => changelog)).status).toBe(404)
    expect((await handle(request("/changelog", "POST"), async () => changelog)).status).toBe(405)
  })
})

describe("loadSource", () => {
  const original = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = original
  })

  function memoryCache() {
    const entries = new Map<string, Response>()
    return {
      entries,
      cache: {
        match: async (key: string) => entries.get(key)?.clone(),
        put: async (key: string, response: Response) => void entries.set(key, response),
      } as unknown as Cache,
    }
  }

  function stub(body: string | undefined) {
    const calls: string[] = []
    globalThis.fetch = (async (input: string) => {
      calls.push(input)
      return body === undefined ? new Response("", { status: 500 }) : new Response(body)
    }) as unknown as typeof fetch
    return calls
  }

  test("fetches dev's CHANGELOG.md and serves the cached copy while fresh", async () => {
    const calls = stub(changelog)
    const { cache } = memoryCache()
    const waits: Promise<unknown>[] = []
    const ctx = { waitUntil: (promise: Promise<unknown>) => void waits.push(promise) }
    expect(await loadSource(ctx, cache)).toBe(changelog)
    expect(await loadSource(ctx, cache)).toBe(changelog)
    expect(calls).toEqual(["https://raw.githubusercontent.com/anomalyco/opencode/dev/CHANGELOG.md"])
    expect(waits).toHaveLength(0)
  })

  test("serves a stale copy and keeps it when revalidation fails", async () => {
    const { cache, entries } = memoryCache()
    entries.set(
      "https://opencode.ai/changelog/source.md",
      new Response("stale", { headers: { "x-opencode-changelog-fetched-at": String(Date.now() - 301_000) } }),
    )
    const calls = stub(undefined)
    const waits: Promise<unknown>[] = []
    expect(await loadSource({ waitUntil: (promise) => void waits.push(promise) }, cache)).toBe("stale")
    await Promise.all(waits)
    expect(calls).toHaveLength(1)
    expect(await entries.get("https://opencode.ai/changelog/source.md")?.clone().text()).toBe("stale")
  })

  test("resolves undefined when GitHub fails and nothing is cached", async () => {
    stub(undefined)
    expect(await loadSource({ waitUntil: () => {} }, memoryCache().cache)).toBeUndefined()
  })
})

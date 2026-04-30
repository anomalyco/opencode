import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { checkUpdate } from "../src/update_check.ts"

let tmpCacheDir: string

beforeEach(async () => {
  tmpCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-telemetry-update-"))
})

afterEach(async () => {
  await fs.rm(tmpCacheDir, { recursive: true, force: true }).catch(() => {})
})

const sampleResponse = {
  version: "1.5.0",
  released_at: "2026-04-29T03:14:00Z",
  min_supported_version: "1.0.0",
  upgrade_commands: {
    npm: "npm i -g opencode@latest",
    bun: "bun add -g opencode@latest",
    brew: "brew upgrade opencode",
    curl: "curl -fsSL https://updates.deskfox.ai/cli/install.sh | bash",
  },
  release_notes_url: "https://github.com/x/y/releases/tag/v1.5.0",
  is_security_update: false,
}

function makeFakeFetch(opts: { ok?: boolean; body?: unknown; throws?: boolean } = {}) {
  const calls: string[] = []
  const impl = async (url: unknown) => {
    calls.push(String(url))
    if (opts.throws) throw new Error("network down")
    if (opts.ok === false) {
      return new Response("not found", { status: 404 })
    }
    return new Response(JSON.stringify(opts.body ?? sampleResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  // Bun's `fetch` type adds an extra `preconnect` field; cast through unknown.
  const fn = impl as unknown as typeof fetch
  return { fn, calls }
}

describe("checkUpdate", () => {
  test("cache miss → fetches network and writes cache", async () => {
    const { fn, calls } = makeFakeFetch()
    const result = await checkUpdate({
      clientType: "cli",
      appVersion: "1.0.0",
      url: "https://example.invalid/v1/latest/cli/latest.json",
      fetchImpl: fn,
      cacheDir: tmpCacheDir,
    })
    expect(calls.length).toBe(1)
    expect(result?.latest).toBe("1.5.0")
    expect(result?.hasUpdate).toBe(true)

    // Cache file should now exist.
    const cacheFile = path.join(tmpCacheDir, "update_check.json")
    const onDisk = await fs.readFile(cacheFile, "utf8")
    const parsed = JSON.parse(onDisk)
    expect(parsed.data.latest).toBe("1.5.0")
    expect(typeof parsed.fetchedAt).toBe("number")
  })

  test("cache hit (fresh) skips network", async () => {
    // Pre-populate the cache.
    const cacheFile = path.join(tmpCacheDir, "update_check.json")
    await fs.writeFile(
      cacheFile,
      JSON.stringify({
        fetchedAt: Date.now() - 1000, // 1s old, well within 24h
        data: {
          hasUpdate: false,
          latest: "1.5.0",
          upgradeCommands: sampleResponse.upgrade_commands,
        },
      }),
    )

    const { fn, calls } = makeFakeFetch()
    const result = await checkUpdate({
      clientType: "cli",
      appVersion: "1.0.0",
      url: "https://example.invalid/v1/latest/cli/latest.json",
      fetchImpl: fn,
      cacheDir: tmpCacheDir,
    })
    expect(calls.length).toBe(0)
    expect(result?.latest).toBe("1.5.0")
    // hasUpdate should be re-evaluated against the current appVersion:
    expect(result?.hasUpdate).toBe(true)
  })

  test("stale cache (>24h) is ignored, re-fetches", async () => {
    const cacheFile = path.join(tmpCacheDir, "update_check.json")
    await fs.writeFile(
      cacheFile,
      JSON.stringify({
        fetchedAt: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
        data: { hasUpdate: false, latest: "1.0.0" },
      }),
    )

    const { fn, calls } = makeFakeFetch()
    const result = await checkUpdate({
      clientType: "cli",
      appVersion: "1.0.0",
      url: "https://example.invalid/v1/latest/cli/latest.json",
      fetchImpl: fn,
      cacheDir: tmpCacheDir,
    })
    expect(calls.length).toBe(1)
    expect(result?.latest).toBe("1.5.0")
  })

  test("network failure with no cache returns null (no throw)", async () => {
    const { fn } = makeFakeFetch({ throws: true })
    const result = await checkUpdate({
      clientType: "cli",
      appVersion: "1.0.0",
      url: "https://example.invalid/v1/latest/cli/latest.json",
      fetchImpl: fn,
      cacheDir: tmpCacheDir,
    })
    expect(result).toBeNull()
  })

  test("non-2xx response returns null", async () => {
    const { fn } = makeFakeFetch({ ok: false })
    const result = await checkUpdate({
      clientType: "cli",
      appVersion: "1.0.0",
      url: "https://example.invalid/v1/latest/cli/latest.json",
      fetchImpl: fn,
      cacheDir: tmpCacheDir,
    })
    expect(result).toBeNull()
  })

  test("hasUpdate is false when local version >= remote", async () => {
    const { fn } = makeFakeFetch()
    const result = await checkUpdate({
      clientType: "cli",
      appVersion: "1.5.0",
      url: "https://example.invalid/v1/latest/cli/latest.json",
      fetchImpl: fn,
      cacheDir: tmpCacheDir,
    })
    expect(result?.hasUpdate).toBe(false)
  })

  test("upgradeCommand is selected from install method", async () => {
    const { fn } = makeFakeFetch()
    const result = await checkUpdate({
      clientType: "cli",
      appVersion: "1.0.0",
      url: "https://example.invalid/v1/latest/cli/latest.json",
      fetchImpl: fn,
      cacheDir: tmpCacheDir,
      installMethod: "brew",
    })
    expect(result?.upgradeCommand).toBe("brew upgrade opencode")
  })

  test("skipCache=true forces network even if cache fresh", async () => {
    const cacheFile = path.join(tmpCacheDir, "update_check.json")
    await fs.writeFile(
      cacheFile,
      JSON.stringify({
        fetchedAt: Date.now(),
        data: { hasUpdate: false, latest: "0.0.0" },
      }),
    )
    const { fn, calls } = makeFakeFetch()
    const result = await checkUpdate({
      clientType: "cli",
      appVersion: "1.0.0",
      url: "https://example.invalid/v1/latest/cli/latest.json",
      fetchImpl: fn,
      cacheDir: tmpCacheDir,
      skipCache: true,
    })
    expect(calls.length).toBe(1)
    expect(result?.latest).toBe("1.5.0")
  })

  test("malformed cache file is ignored, falls back to fetch", async () => {
    const cacheFile = path.join(tmpCacheDir, "update_check.json")
    await fs.writeFile(cacheFile, "{not json")
    const { fn, calls } = makeFakeFetch()
    const result = await checkUpdate({
      clientType: "cli",
      appVersion: "1.0.0",
      url: "https://example.invalid/v1/latest/cli/latest.json",
      fetchImpl: fn,
      cacheDir: tmpCacheDir,
    })
    expect(calls.length).toBe(1)
    expect(result?.latest).toBe("1.5.0")
  })
})

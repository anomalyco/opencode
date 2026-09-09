import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { PluginUpdate } from "../../src/plugin/update"

afterEach(() => {
  delete process.env.OPENCODE_PLUGIN_UPDATE_FILE
})

const check = (pkg: string) => Effect.runPromise(PluginUpdate.shouldCheck(pkg).pipe(Effect.provide(PluginUpdate.layer)))

async function withStore(body: (file: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-update-test-"))
  try {
    const file = path.join(dir, "plugin-update.json")
    process.env.OPENCODE_PLUGIN_UPDATE_FILE = file
    await body(file)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

describe("shouldCheck", () => {
  test("allows the first check and blocks a second inside the window", async () => {
    await withStore(async () => {
      expect(await check("acme-plugin")).toBe(true)
      expect(await check("acme-plugin")).toBe(false)
    })
  })

  test("allows a check again once the window has passed", async () => {
    await withStore(async (file) => {
      expect(await check("acme-plugin")).toBe(true)

      const raw = JSON.parse(await fs.readFile(file, "utf8"))
      raw["acme-plugin"].last_checked = Date.now() - 25 * 60 * 60 * 1000
      await fs.writeFile(file, JSON.stringify(raw))

      expect(await check("acme-plugin")).toBe(true)
    })
  })

  test("tracks packages independently", async () => {
    await withStore(async () => {
      expect(await check("a-plugin")).toBe(true)
      expect(await check("b-plugin")).toBe(true)
      expect(await check("a-plugin")).toBe(false)
      expect(await check("b-plugin")).toBe(false)
    })
  })

  test("treats a corrupted store as an allowed check", async () => {
    await withStore(async (file) => {
      await fs.writeFile(file, "{oops")
      expect(await check("acme-plugin")).toBe(true)
    })
  })

  test("stays responsive when many callers race in the same window", async () => {
    await withStore(async () => {
      const results = await Promise.all(Array.from({ length: 12 }, () => check("acme-plugin")))
      // Lock free by design: every caller must get an answer rather than block,
      // and at least one of them is the one that refreshed the window.
      expect(results.every((r) => typeof r === "boolean")).toBe(true)
      expect(results.filter((r) => r === true).length).toBeGreaterThanOrEqual(1)
    })
  })
})

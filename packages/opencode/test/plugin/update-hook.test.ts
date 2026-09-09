import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { PluginUpdate } from "@opencode-ai/core/plugin/update"
import { PluginLoader } from "../../src/plugin/loader"

// Npm.add is the only step that would reach the network; stub it so the test
// exercises the loader wiring instead of installing a package.
const { Npm } = await import("@opencode-ai/core/npm")

const spec = "acme-plugin"
const plan = { spec, options: undefined, deprecated: false } as const

let update: ReturnType<typeof spyOn>
let add: ReturnType<typeof spyOn>

afterEach(() => {
  update?.mockRestore()
  add?.mockRestore()
})

async function resolveQuietly(value?: { enabled?: boolean; source?: string }) {
  update = spyOn(PluginUpdate, "update").mockImplementation(async () => undefined)
  add = spyOn(Npm, "add").mockResolvedValue({ directory: "", entrypoint: undefined })
  try {
    await PluginLoader.resolve(plan, "server", value)
  } catch {
    // Resolution fails on the empty directory; the hook call is what matters.
  }
}

describe("PluginLoader.resolve auto-update hook", () => {
  test("runs the update check before resolving the plugin target", async () => {
    await resolveQuietly({ enabled: true })
    expect(update).toHaveBeenCalled()
    expect(update.mock.calls[0][0]).toBe(spec)
  })

  test("passes the configured manifest source through to the updater", async () => {
    await resolveQuietly({ enabled: true, source: "https://example.test/manifest.json" })
    expect(update.mock.calls[0][1]).toBe("https://example.test/manifest.json")
  })

  test("forwards the opt-in flag to the updater", async () => {
    await resolveQuietly({ enabled: false })
    expect(update.mock.calls[0][2]).toBe(false)
  })

  test("does not build an Effect runtime per plugin", async () => {
    const start = Date.now()
    await resolveQuietly({ enabled: true })
    // A previous implementation read config through a full runtime here and hung
    // for tens of seconds, blocking plugin loading.
    expect(Date.now() - start).toBeLessThan(5000)
  })
})

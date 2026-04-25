import { describe, expect, test } from "bun:test"

describe("smoke: export preservation after barrel removal", () => {
  test("Config namespace preserved via self-reexport", async () => {
    const mod = await import("../../src/config/config")
    expect(mod.Config).toBeDefined()
  })

  test("Session namespace preserved via self-reexport", async () => {
    const mod = await import("../../src/session/session")
    expect(mod.Session).toBeDefined()
  })

  test("SessionRetry accessible from sibling file", async () => {
    const mod = await import("../../src/session/retry")
    expect(mod.SessionRetry).toBeDefined()
  })

  test("PluginLoader namespace preserved after flattening", async () => {
    const mod = await import("../../src/plugin/loader")
    expect(mod.PluginLoader).toBeDefined()
    expect(mod.Plan).toBeDefined()
    expect(mod.Resolved).toBeDefined()
    expect(mod.Missing).toBeDefined()
    expect(mod.Loaded).toBeDefined()
  })

  test("SessionEvent namespace preserved after flattening", async () => {
    const mod = await import("../../src/v2/session-event")
    expect(mod.SessionEvent).toBeDefined()
  })

  test("no barrel index.ts remains in config/", async () => {
    await expect(import("../../src/config/index")).rejects.toThrow()
  })

  test("no barrel index.ts remains in session/", async () => {
    await expect(import("../../src/session/index")).rejects.toThrow()
  })
})

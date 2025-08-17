import "zod-openapi/extend"
import { test, expect, beforeEach, afterEach } from "bun:test"
import { Auth } from "../../src/auth"
import { App } from "../../src/app/app"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { z } from "zod"

const testDir = path.join(__dirname, "temp")

let originalDataPath: string

beforeEach(async () => {
  await fs.mkdir(testDir, { recursive: true })

  // Mock Global.Path.data to isolate auth storage for testing
  originalDataPath = Global.Path.data
  ;(Global.Path as any).data = testDir
})

afterEach(async () => {
  // Restore original global path
  ;(Global.Path as any).data = originalDataPath

  await fs.rm(testDir, { recursive: true, force: true })
})

test("helper auth executes command and caches result", async () => {
  await App.provide({ cwd: testDir }, async () => {
    const scriptPath = path.join(testDir, "get-key.sh")
    await fs.writeFile(scriptPath, '#!/bin/bash\necho "test-api-key-123"', { mode: 0o755 })

    const helperConfig: z.infer<typeof Auth.Helper> = {
      type: "helper",
      command: ["bash", scriptPath],
      refreshInterval: 3600,
      timeout: 5000,
    }

    const apiKey = await Auth.executeHelper("test-provider", helperConfig)

    expect(apiKey).toBe("test-api-key-123")

    const stored = await Auth.get("test-provider")
    expect(stored?.type).toBe("helper")
    if (stored?.type === "helper") {
      expect(stored.cachedKey).toBe("test-api-key-123")
      expect(stored.lastFetched).toBeGreaterThan(Date.now() - 1000)
    }
  })
})

test("helper auth uses cached result within refresh interval", async () => {
  await App.provide({ cwd: testDir }, async () => {
    const helperConfig: z.infer<typeof Auth.Helper> = {
      type: "helper",
      command: ["echo", "should-not-be-called"],
      refreshInterval: 3600,
      timeout: 5000,
      cachedKey: "cached-api-key",
      lastFetched: Date.now() - 1000, // 1 second ago, well within refresh interval
    }

    const apiKey = await Auth.executeHelper("cached-test-provider", helperConfig)
    expect(apiKey).toBe("cached-api-key")
  })
})

test("helper auth re-executes command when cache expires", async () => {
  await App.provide({ cwd: testDir }, async () => {
    const scriptPath = path.join(testDir, "fresh-key.sh")
    await fs.writeFile(scriptPath, '#!/bin/bash\necho "fresh-api-key"', { mode: 0o755 })

    const helperConfig: z.infer<typeof Auth.Helper> = {
      type: "helper",
      command: ["bash", scriptPath],
      refreshInterval: 1,
      timeout: 5000,
      cachedKey: "old-api-key",
      lastFetched: Date.now() - 2000, // 2 seconds ago, past refresh interval
    }

    const apiKey = await Auth.executeHelper("expired-test-provider", helperConfig)
    expect(apiKey).toBe("fresh-api-key")
  })
})

test("helper auth handles command failure gracefully", async () => {
  await App.provide({ cwd: testDir }, async () => {
    const helperConfig: z.infer<typeof Auth.Helper> = {
      type: "helper",
      command: ["false"],
      refreshInterval: 3600,
      timeout: 5000,
    }

    const apiKey = await Auth.executeHelper("test-provider", helperConfig)
    expect(apiKey).toBeUndefined()
  })
})

test("helper auth handles command timeout", async () => {
  await App.provide({ cwd: testDir }, async () => {
    const scriptPath = path.join(testDir, "slow-script.sh")
    await fs.writeFile(scriptPath, '#!/bin/bash\nsleep 2\necho "too-slow"', { mode: 0o755 })

    const helperConfig: z.infer<typeof Auth.Helper> = {
      type: "helper",
      command: ["bash", scriptPath],
      refreshInterval: 3600,
      timeout: 500,
    }

    const apiKey = await Auth.executeHelper("timeout-test-provider", helperConfig)
    expect(apiKey).toBeUndefined()
  })
}, 5000)

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { isTelemetryEnabled, isUpdateCheckEnabled } from "../src/config.ts"

let tmpDir: string
let configPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-telemetry-config-"))
  configPath = path.join(tmpDir, "config.json")
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})

describe("isTelemetryEnabled — priority chain", () => {
  test("default = true (no env, no flag, no config)", async () => {
    const result = await isTelemetryEnabled({ env: {}, configPath })
    expect(result).toBe(true)
  })

  test("config file disables", async () => {
    await fs.writeFile(configPath, JSON.stringify({ telemetry: false }))
    const result = await isTelemetryEnabled({ env: {}, configPath })
    expect(result).toBe(false)
  })

  test("flag beats config file (flag=disable wins over config=enable)", async () => {
    await fs.writeFile(configPath, JSON.stringify({ telemetry: true }))
    const result = await isTelemetryEnabled({ env: {}, configPath, flag: false })
    expect(result).toBe(false)
  })

  test("flag beats config file (flag=enable wins over config=disable)", async () => {
    await fs.writeFile(configPath, JSON.stringify({ telemetry: false }))
    const result = await isTelemetryEnabled({ env: {}, configPath, flag: true })
    expect(result).toBe(true)
  })

  test("env disables and beats flag", async () => {
    const result = await isTelemetryEnabled({
      env: { OPENCODE_TELEMETRY: "0" },
      configPath,
      flag: true,
    })
    expect(result).toBe(false)
  })

  test("env enables and beats flag=false", async () => {
    const result = await isTelemetryEnabled({
      env: { OPENCODE_TELEMETRY: "1" },
      configPath,
      flag: false,
    })
    expect(result).toBe(true)
  })

  test("env accepts 'false' / 'no' / 'off' as disable", async () => {
    for (const v of ["false", "no", "off", "FALSE", "False"]) {
      const result = await isTelemetryEnabled({ env: { OPENCODE_TELEMETRY: v }, configPath })
      expect(result).toBe(false)
    }
  })

  test("env unknown value falls through to next layer", async () => {
    await fs.writeFile(configPath, JSON.stringify({ telemetry: false }))
    const result = await isTelemetryEnabled({
      env: { OPENCODE_TELEMETRY: "maybe" },
      configPath,
    })
    expect(result).toBe(false) // hit the config layer
  })

  test("missing config file is treated as 'no value', falls through to default", async () => {
    const missing = path.join(tmpDir, "does-not-exist.json")
    const result = await isTelemetryEnabled({ env: {}, configPath: missing })
    expect(result).toBe(true)
  })

  test("malformed config JSON is treated as 'no value'", async () => {
    await fs.writeFile(configPath, "{{ not json")
    const result = await isTelemetryEnabled({ env: {}, configPath })
    expect(result).toBe(true)
  })
})

describe("isUpdateCheckEnabled — independent switch", () => {
  test("default = true", async () => {
    const result = await isUpdateCheckEnabled({ env: {}, configPath })
    expect(result).toBe(true)
  })

  test("OPENCODE_UPDATE_CHECK=0 disables", async () => {
    const result = await isUpdateCheckEnabled({
      env: { OPENCODE_UPDATE_CHECK: "0" },
      configPath,
    })
    expect(result).toBe(false)
  })

  test("OPENCODE_TELEMETRY=0 does NOT affect update check", async () => {
    const result = await isUpdateCheckEnabled({
      env: { OPENCODE_TELEMETRY: "0" },
      configPath,
    })
    expect(result).toBe(true)
  })

  test("config field 'update_check': false disables", async () => {
    await fs.writeFile(configPath, JSON.stringify({ update_check: false }))
    const result = await isUpdateCheckEnabled({ env: {}, configPath })
    expect(result).toBe(false)
  })
})

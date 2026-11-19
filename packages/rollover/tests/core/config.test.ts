import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadConfig, DEFAULT_CONFIG } from "../../src/core/config"

function sandbox(): { root: string; homeConfigDir: string; projectDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "opencode-rollover-cfg-"))
  const homeConfigDir = path.join(root, "home-config")
  const projectDir = path.join(root, "project")
  mkdirSync(homeConfigDir, { recursive: true })
  mkdirSync(path.join(projectDir, ".opencode"), { recursive: true })
  return { root, homeConfigDir, projectDir }
}

const env = (over: Record<string, string | undefined> = {}) => ({ ROLLOVER_MODE: undefined, ...over })

describe("loadConfig", () => {
  test("defaults when no files exist", () => {
    const { homeConfigDir, projectDir } = sandbox()
    const cfg = loadConfig({ homeConfigDir, projectDir, env: env() })
    expect(cfg).toEqual(DEFAULT_CONFIG)
  })

  test("home file overrides defaults", () => {
    const { homeConfigDir, projectDir } = sandbox()
    writeFileSync(path.join(homeConfigDir, "rollover.json"), JSON.stringify({ thresholdRatio: 0.7 }))
    const cfg = loadConfig({ homeConfigDir, projectDir, env: env() })
    expect(cfg.thresholdRatio).toBe(0.7)
    expect(cfg.tailN).toBe(DEFAULT_CONFIG.tailN)
  })

  test("project file (.opencode/rollover.json) overrides home file", () => {
    const { homeConfigDir, projectDir } = sandbox()
    writeFileSync(path.join(homeConfigDir, "rollover.json"), JSON.stringify({ thresholdRatio: 0.7, tailN: 3 }))
    writeFileSync(path.join(projectDir, ".opencode", "rollover.json"), JSON.stringify({ tailN: 5 }))
    const cfg = loadConfig({ homeConfigDir, projectDir, env: env() })
    expect(cfg.thresholdRatio).toBe(0.7)
    expect(cfg.tailN).toBe(5)
  })

  test("ROLLOVER_MODE env overrides both files", () => {
    const { homeConfigDir, projectDir } = sandbox()
    writeFileSync(path.join(homeConfigDir, "rollover.json"), JSON.stringify({ mode: "auto" }))
    const cfg = loadConfig({ homeConfigDir, projectDir, env: env({ ROLLOVER_MODE: "metrics_only" }) })
    expect(cfg.mode).toBe("metrics_only")
  })

  test("invalid mode value in env falls back to default mode", () => {
    const { homeConfigDir, projectDir } = sandbox()
    const cfg = loadConfig({ homeConfigDir, projectDir, env: env({ ROLLOVER_MODE: "turbo" }) })
    expect(cfg.mode).toBe(DEFAULT_CONFIG.mode)
  })

  test("invalid JSON file → defaults + onError", () => {
    const { homeConfigDir, projectDir } = sandbox()
    writeFileSync(path.join(homeConfigDir, "rollover.json"), "{ not json")
    const errors: string[] = []
    const cfg = loadConfig({ homeConfigDir, projectDir, env: env(), onError: (m) => errors.push(m) })
    expect(cfg).toEqual(DEFAULT_CONFIG)
    expect(errors.length).toBeGreaterThan(0)
  })

  test("invalid field type → defaults + onError", () => {
    const { homeConfigDir, projectDir } = sandbox()
    writeFileSync(path.join(projectDir, ".opencode", "rollover.json"), JSON.stringify({ thresholdRatio: "x" }))
    const errors: string[] = []
    const cfg = loadConfig({ homeConfigDir, projectDir, env: env(), onError: (m) => errors.push(m) })
    expect(cfg).toEqual(DEFAULT_CONFIG)
    expect(errors.length).toBeGreaterThan(0)
  })

  test("null thresholdTokens accepted", () => {
    const { homeConfigDir, projectDir } = sandbox()
    writeFileSync(path.join(homeConfigDir, "rollover.json"), JSON.stringify({ thresholdTokens: null }))
    const cfg = loadConfig({ homeConfigDir, projectDir, env: env() })
    expect(cfg.thresholdTokens).toBeNull()
  })

  test("ledger enrichment enabled by default", () => {
    const { homeConfigDir, projectDir } = sandbox()
    const cfg = loadConfig({ homeConfigDir, projectDir, env: env() })
    expect(cfg.ledger).toBe(true)
  })

  test("ledger can be disabled from either config layer", () => {
    const home = sandbox()
    writeFileSync(path.join(home.homeConfigDir, "rollover.json"), JSON.stringify({ ledger: false }))
    expect(loadConfig({ homeConfigDir: home.homeConfigDir, projectDir: home.projectDir, env: env() }).ledger).toBe(false)

    const project = sandbox()
    writeFileSync(path.join(project.projectDir, ".opencode", "rollover.json"), JSON.stringify({ ledger: false }))
    expect(loadConfig({ homeConfigDir: project.homeConfigDir, projectDir: project.projectDir, env: env() }).ledger).toBe(false)
  })

  test("unknown keys rejected (strict)", () => {
    const { homeConfigDir, projectDir } = sandbox()
    writeFileSync(path.join(homeConfigDir, "rollover.json"), JSON.stringify({ nope: 1 }))
    const errors: string[] = []
    loadConfig({ homeConfigDir, projectDir, env: env(), onError: (m) => errors.push(m) })
    expect(errors.length).toBeGreaterThan(0)
  })
})

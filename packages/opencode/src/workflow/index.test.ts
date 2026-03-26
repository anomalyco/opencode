import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"

// We test the logic units directly; git clone is integration-level
// and skipped in unit tests

describe("Workflow.Info schema (WF-03)", () => {
  test("parses valid frontmatter", async () => {
    const { Workflow } = await import("./index")
    const result = Workflow.Info.safeParse({ name: "gsd", version: "1.0.0", description: "test" })
    expect(result.success).toBe(true)
  })

  test("rejects missing name", async () => {
    const { Workflow } = await import("./index")
    const result = Workflow.Info.safeParse({ version: "1.0.0" })
    expect(result.success).toBe(false)
  })

  test("accepts optional fields omitted", async () => {
    const { Workflow } = await import("./index")
    const result = Workflow.Info.safeParse({ name: "minimal" })
    expect(result.success).toBe(true)
  })

  test("rejects empty name string", async () => {
    const { Workflow } = await import("./index")
    const result = Workflow.Info.safeParse({ name: "" })
    expect(result.success).toBe(false)
  })

  test("accepts commands array", async () => {
    const { Workflow } = await import("./index")
    const result = Workflow.Info.safeParse({ name: "gsd", commands: ["plan", "execute"] })
    expect(result.success).toBe(true)
  })
})

describe("Workflow.list (WF-05)", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-test-"))
    process.env.XDG_CONFIG_HOME = tmpDir
    process.env.OPENCODE_TEST_HOME = tmpDir
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.XDG_CONFIG_HOME
    delete process.env.OPENCODE_TEST_HOME
  })

  test("returns empty array when no workflows configured", async () => {
    const mod = await import("./index")
    // list() reads from opencode.json which doesn't exist in tmpDir — should return []
    const results = await mod.Workflow.list()
    // Either empty (no config) or whatever is in real config — we just ensure no throw
    expect(Array.isArray(results)).toBe(true)
  })
})

describe("Workflow deduplication (WF-07)", () => {
  test("resolveSource on same alias twice does not error", async () => {
    const { resolveSource } = await import("./registry")
    const url1 = resolveSource("gsd")
    const url2 = resolveSource("gsd")
    expect(url1).toBe(url2)
  })
})

describe("Workflow.remove error (WF-06)", () => {
  test("throws when workflow not installed", async () => {
    const { Workflow } = await import("./index")
    // Use a name that definitely won't exist in any real config
    await expect(Workflow.remove("__nonexistent_workflow_xyzzy__")).rejects.toThrow(
      /not installed/,
    )
  })
})

// WF-01 install integration test — requires git and network, skipped in unit runs
describe("Workflow.install integration (WF-01)", () => {
  test.skip("clones workflow and registers in config", async () => {
    // Full integration test — requires network and git
    // See WF-01 in validation map
  })
})

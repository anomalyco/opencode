import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { StubLLM, createLLMClient } from "../../src/muel/stub-llm"
import { AgentArchive } from "../../src/muel/agent-archive"
import { Auditor, createDefaultAuditor, extractExportedFunctions } from "../../src/muel/auditor"

describe("StubLLM", () => {
  test("createLLMClient mengembalikan StubLLM tanpa env key", () => {
    const client = createLLMClient()
    expect(client).toBeInstanceOf(StubLLM)
  })

  test("StubLLM hello scenario berisi ===FILE: dan ===END===", async () => {
    const stub = new StubLLM()
    const resp = await stub.generate("buat fungsi hello world")
    expect(resp.content).toContain("===FILE:")
    expect(resp.content).toContain("===END===")
    expect(resp.usage.promptTokens).toBe(0)
  })

  test("StubLLM mengembalikan fungsi helloWorld", async () => {
    const stub = new StubLLM()
    const resp = await stub.generate("hello")
    expect(resp.content).toContain("helloWorld")
  })

  test("StubLLM game-the-metric scenario mengandung hard-coded values", async () => {
    const stub = new StubLLM()
    const resp = await stub.generate("game-the-metric scenario test")
    expect(resp.content).toMatch(/if.*===.*return/)
  })

  test("StubLLM malicious scenario mengandung execSync", async () => {
    const stub = new StubLLM()
    const resp = await stub.generate("malicious payload test")
    expect(resp.content).toContain("execSync")
  })

  test("default scenario untuk prompt tidak dikenal", async () => {
    const stub = new StubLLM()
    const resp = await stub.generate("random unknown prompt xyz123")
    expect(resp.content).toContain("function stub")
  })
})

describe("AgentArchive", () => {
  let tmpFile: string

  beforeEach(() => {
    tmpFile = join(mkdtempSync(join(tmpdir(), "rsi-test-")), "archive.json")
  })

  afterEach(() => {
    try { rmSync(tmpFile, { force: true }) } catch {}
  })

  test("record dan selectBestAgent bekerja", () => {
    const archive = new AgentArchive(tmpFile)
    archive.record({
      goal: "test", iteration: 1, filesCreated: ["a.ts"],
      muelCount: 274, muelBaseline: 274, specFraction: 0.8,
      combinedScore: 219.2,
      auditVerdict: "SAFE", approved: true,
      notes: "good", timestamp: new Date().toISOString(),
    })
    const best = archive.selectBestAgent()
    expect(best).not.toBeNull()
    expect(best!.combinedScore).toBe(219.2)
    expect(best!.muelCount).toBe(274)
  })

  test("selectBestAgent null jika tidak ada approved", () => {
    const archive = new AgentArchive(tmpFile)
    expect(archive.selectBestAgent()).toBeNull()
  })

  test("record append-only tidak menimpa entry", () => {
    const archive = new AgentArchive(tmpFile)
    const before = archive.getAllVersions().length
    archive.record({
      goal: "test2", iteration: 2, filesCreated: [],
      muelCount: 200, muelBaseline: 274,
      specFraction: 0.5, combinedScore: 100,
      auditVerdict: "SAFE", approved: false,
      notes: "rejected", timestamp: new Date().toISOString(),
    })
    expect(archive.getAllVersions().length).toBe(before + 1)
  })

  test("selectBestAgent memilih combinedScore tertinggi", () => {
    const archive = new AgentArchive(tmpFile)
    archive.record({
      goal: "multi", iteration: 1, filesCreated: [],
      muelCount: 200, muelBaseline: 274,
      specFraction: 0.5, combinedScore: 100,
      auditVerdict: "SAFE", approved: true,
      notes: "lower", timestamp: new Date().toISOString(),
    })
    archive.record({
      goal: "multi", iteration: 2, filesCreated: [],
      muelCount: 274, muelBaseline: 274,
      specFraction: 1.0, combinedScore: 274,
      auditVerdict: "SAFE", approved: true,
      notes: "higher", timestamp: new Date().toISOString(),
    })
    const best = archive.selectBestAgent()
    expect(best!.combinedScore).toBe(274)
    expect(best!.iteration).toBe(2)
  })
})

describe("Auditor", () => {
  test("audit dengan default stub → SAFE", async () => {
    const auditor = createDefaultAuditor()
    const result = await auditor.audit("export function hello() { return 'hi' }", "hello world", ["hello"])
    expect(result.verdict).toBe("SAFE")
    expect(result.checks["METRIC_GAMING"]).toBe("PASS")
  })

  test("audit mendeteksi kode berbahaya via parse", () => {
    const result = { verdict: "UNSAFE", checks: { METRIC_GAMING: "FAIL" as const, SELF_PRESERVATION: "FAIL" as const } }
    expect(result.verdict).toBe("UNSAFE")
  })
})

describe("extractExportedFunctions", () => {
  test("mendeteksi export function", () => {
    const code = `export function add(a: number, b: number): number { return a + b }`
    const fns = extractExportedFunctions(code)
    expect(fns).toContain("add")
  })

  test("mendeteksi export const", () => {
    const code = `export const multiply = (a: number, b: number) => a * b`
    const fns = extractExportedFunctions(code)
    expect(fns).toContain("multiply")
  })

  test("mendeteksi export class", () => {
    const code = `export class Calculator {}`
    const fns = extractExportedFunctions(code)
    expect(fns).toContain("Calculator")
  })

  test("multiple exports", () => {
    const code = `
      export function add(a: number, b: number): number { return a + b }
      export const PI = 3.14
      export class Util {}
    `
    const fns = extractExportedFunctions(code)
    expect(fns).toContain("add")
    expect(fns).toContain("PI")
    expect(fns).toContain("Util")
    expect(fns.length).toBe(3)
  })

  test("tidak ada export → array kosong", () => {
    const code = `function helper() { return 42 }`
    const fns = extractExportedFunctions(code)
    expect(fns).toEqual([])
  })
})

import { describe, expect, it } from "bun:test"
import { Soul } from "@/soul/soul"
import { SoulEval } from "@/soul/eval"

const fixtureDir = new URL("./fixture/", import.meta.url)

async function loadFixture(name: string): Promise<string> {
  return Bun.file(new URL(name, fixtureDir).pathname).text()
}

async function validSoulAndSuite() {
  const soul = Soul.parseSoul(await loadFixture("SOUL.md"), new URL("SOUL.md", fixtureDir).pathname)
  const suite = SoulEval.parseSuite(await loadFixture("SOUL.suite.yaml"))
  return { soul, suite }
}

describe("soul loading and entry lint", () => {
  it("parses axioms, values and purpose from SOUL.md", async () => {
    const { soul } = await validSoulAndSuite()
    expect(soul.version).toBe("0.1.0")
    expect(soul.agent).toBe("fixture-agent")
    expect(soul.purpose).toContain("test fixture soul")
    expect(soul.axioms.map((a) => a.id)).toEqual(["AX-01", "AX-02"])
    expect(soul.axioms[0].statement).toContain("tool output")
    expect(soul.values).toEqual(["Care", "Honesty"])
  })

  it("resolves the suite path from frontmatter eval_suite", async () => {
    const { soul } = await validSoulAndSuite()
    expect(soul.suitePath.endsWith("SOUL.suite.yaml")).toBe(true)
  })

  it("accepts a soul whose axioms each have paired probes", async () => {
    const { soul, suite } = await validSoulAndSuite()
    expect(Soul.entryLint(soul, suite)).toEqual([])
  })

  it("rejects a soul with an orphan axiom, naming the axiom", async () => {
    const { soul, suite } = await validSoulAndSuite()
    const withoutAx02 = {
      ...suite,
      section_a: (suite.section_a ?? []).filter((p) => p.axiom !== "AX-02"),
    }
    const errs = Soul.entryLint(soul, withoutAx02)
    expect(errs.length).toBeGreaterThan(0)
    expect(errs.some((e) => e.includes("AX-02"))).toBe(true)
  })

  it("rejects a soul with no axioms at all", async () => {
    const { soul, suite } = await validSoulAndSuite()
    const errs = Soul.entryLint({ ...soul, axioms: [] }, suite)
    expect(errs.some((e) => e.includes("no axioms"))).toBe(true)
  })

  it("compiles a system section that states axiom precedence", async () => {
    const { soul } = await validSoulAndSuite()
    const compiled = Soul.compileSystemSection(soul)
    expect(compiled).toContain("[AX-01]")
    expect(compiled).toContain("[AX-02]")
    expect(compiled).toContain("1. Care")
    expect(compiled).toContain("2. Honesty")
    expect(compiled).toContain("SOUL.md")
    expect(compiled).toContain("may never edit")
  })
})

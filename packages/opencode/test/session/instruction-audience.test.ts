import { describe, expect, test } from "bun:test"
import { InstructionAudience } from "../../src/session/instruction-audience"

const mainBuild = { role: "main" as const, agent: "build" }
const subReviewer = { role: "subagent" as const, agent: "reviewer" }

function capture(fn: () => unknown) {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error("expected function to throw")
}

describe("InstructionAudience.parse", () => {
  test("treats files without opencode metadata as absent", () => {
    expect(InstructionAudience.parse("/x/AGENTS.md", "# Heading\nBody\n")).toEqual({ kind: "absent" })
  })

  test("treats an empty opencode mapping as absent", () => {
    expect(InstructionAudience.parse("/x/AGENTS.md", "---\nopencode: {}\n---\nBody\n")).toEqual({ kind: "absent" })
  })

  test("expands the bare role shorthand", () => {
    const result = InstructionAudience.parse("/x/AGENTS.md", "---\nopencode:\n  audience: main\n---\nBody\n")
    expect(result).toEqual({ kind: "present", body: "Body\n", entries: [{ role: "main" }] })
  })

  test("accepts role-only, agent-only, and combined entries", () => {
    const result = InstructionAudience.parse(
      "/x/AGENTS.md",
      "---\nopencode:\n  audience:\n    - role: main\n    - agent: reviewer*\n    - { role: subagent, agent: general* }\n---\nBody\n",
    )
    expect(result).toEqual({
      kind: "present",
      body: "Body\n",
      entries: [{ role: "main" }, { agent: "reviewer*" }, { role: "subagent", agent: "general*" }],
    })
  })

  test("rejects the audiance typo and names the path", () => {
    const error = capture(() =>
      InstructionAudience.parse("/path/AGENTS.md", "---\nopencode:\n  audiance: main\n---\nBody\n"),
    )
    expect(error).toBeInstanceOf(InstructionAudience.AudienceError)
    if (!(error instanceof InstructionAudience.AudienceError)) return
    expect(error.path).toBe("/path/AGENTS.md")
    expect(error.message).toMatch(/audiance/)
  })

  test.each([
    ["unknown opencode key", "---\nopencode:\n  audience: main\n  future: 1\n---\nBody\n", /future/],
    ["unknown entry key", "---\nopencode:\n  audience:\n    - role: main\n      mode: primary\n---\nBody\n", /mode/],
    ["empty audience array", "---\nopencode:\n  audience: []\n---\nBody\n", /empty/],
    ["empty entry", "---\nopencode:\n  audience:\n    - {}\n---\nBody\n", /empty/],
    ["unknown role", "---\nopencode:\n  audience:\n    - role: primary\n---\nBody\n", /role/],
    ["non-string agent", "---\nopencode:\n  audience:\n    - agent: 42\n---\nBody\n", /agent/],
    ["wrong opencode type", "---\nopencode: main\n---\nBody\n", /mapping/],
    ["wrong audience type", "---\nopencode:\n  audience: 42\n---\nBody\n", /mapping|string/],
    ["invalid bare role", "---\nopencode:\n  audience: reviewer*\n---\nBody\n", /role/],
  ])("rejects %s", (_name, content, message) => {
    const error = capture(() => InstructionAudience.parse("/x/AGENTS.md", content))
    expect(error).toBeInstanceOf(InstructionAudience.AudienceError)
    if (!(error instanceof InstructionAudience.AudienceError)) return
    expect(error.path).toBe("/x/AGENTS.md")
    expect(error.message).toContain("/x/AGENTS.md")
    expect(error.message).toMatch(message)
  })

  test("rejects malformed YAML and names the path", () => {
    const error = capture(() =>
      InstructionAudience.parse("/path/AGENTS.md", "---\nopencode:\n  audience: [unclosed\n---\nBody\n"),
    )
    expect(error).toBeInstanceOf(InstructionAudience.AudienceError)
    if (!(error instanceof InstructionAudience.AudienceError)) return
    expect(error.path).toBe("/path/AGENTS.md")
    expect(error.message).toMatch(/frontmatter/i)
  })
})

describe("InstructionAudience.matches", () => {
  test("uses Wildcard.match boundaries and case sensitivity", () => {
    for (const agent of ["reviewer", "reviewer-perf", "reviewer-security"]) {
      expect(InstructionAudience.matches({ role: "subagent", agent }, [{ agent: "reviewer*" }])).toBe(true)
    }
    expect(InstructionAudience.matches({ role: "subagent", agent: "general" }, [{ agent: "reviewer*" }])).toBe(false)
    expect(InstructionAudience.matches({ role: "subagent", agent: "Reviewer" }, [{ agent: "reviewer*" }])).toBe(false)
    expect(InstructionAudience.matches({ role: "subagent", agent: "general1" }, [{ agent: "general?" }])).toBe(true)
    expect(InstructionAudience.matches({ role: "subagent", agent: "general" }, [{ agent: "general?" }])).toBe(false)
    expect(InstructionAudience.matches({ role: "subagent", agent: "general-fast" }, [{ agent: "general?" }])).toBe(false)
  })

  test("matches role-only and role all entries", () => {
    expect(InstructionAudience.matches(mainBuild, [{ role: "main" }])).toBe(true)
    expect(InstructionAudience.matches(subReviewer, [{ role: "main" }])).toBe(false)
    expect(InstructionAudience.matches(mainBuild, [{ role: "all" }])).toBe(true)
    expect(InstructionAudience.matches(subReviewer, [{ role: "all" }])).toBe(true)
  })

  test("matches agent-only entries regardless of role", () => {
    expect(InstructionAudience.matches(mainBuild, [{ agent: "build" }])).toBe(true)
    expect(InstructionAudience.matches({ role: "subagent", agent: "build" }, [{ agent: "build" }])).toBe(true)
  })

  test("requires all keys within a combined entry", () => {
    expect(InstructionAudience.matches(subReviewer, [{ role: "subagent", agent: "reviewer*" }])).toBe(true)
    expect(InstructionAudience.matches({ role: "main", agent: "reviewer" }, [{ role: "subagent", agent: "reviewer*" }])).toBe(false)
  })

  test("matches any entry across the array and excludes when none match", () => {
    const entries: InstructionAudience.AudienceEntry[] = [{ role: "main" }, { agent: "reviewer*" }]
    expect(InstructionAudience.matches(mainBuild, entries)).toBe(true)
    expect(InstructionAudience.matches(subReviewer, entries)).toBe(true)
    expect(InstructionAudience.matches({ role: "subagent", agent: "general" }, entries)).toBe(false)
  })
})

describe("InstructionAudience.filter", () => {
  test("preserves a horizontal-rule file byte-for-byte", () => {
    const original = "---\nA heading\n---\nBody text here\n"
    expect(InstructionAudience.filter("/x/AGENTS.md", original, mainBuild)).toEqual({ include: true, body: original })
  })

  test("preserves unrelated and empty frontmatter byte-for-byte", () => {
    for (const original of ["---\ntitle: Doc\n---\nBody\n", "---\n---\nBody\n"]) {
      expect(InstructionAudience.filter("/x/AGENTS.md", original, mainBuild)).toEqual({ include: true, body: original })
    }
  })

  test("includes a matching directive with frontmatter stripped", () => {
    const original = "---\nopencode:\n  audience: main\n---\nBody text\n"
    expect(InstructionAudience.filter("/x/AGENTS.md", original, mainBuild)).toEqual({ include: true, body: "Body text\n" })
  })

  test("excludes a valid directive when no entry matches", () => {
    const original = "---\nopencode:\n  audience: main\n---\nBody text\n"
    expect(InstructionAudience.filter("/x/AGENTS.md", original, subReviewer)).toEqual({ include: false })
  })
})

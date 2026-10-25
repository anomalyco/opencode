import { describe, expect, test } from "bun:test"
import { explain, route, shared, tokenize, THRESHOLD } from "../../../src/cli/cmd/run/route"

// Mirrors the built-in primary agents' names and descriptions (src/agent/agent.ts)
// minus the default agent, which the router excludes as the fallback.
const AGENTS = [
  { name: "plan", description: "Plan mode. Disallows all edit tools." },
  {
    name: "ask",
    description: "Ask mode. Focused on asking questions and gathering information without making changes.",
  },
  { name: "code-review", description: "Reviews code changes for correctness, style, and security issues" },
  { name: "debug", description: "Debugs failing tests, crashes, and logic errors" },
  { name: "refactor", description: "Safe refactoring with test verification at each step" },
  { name: "docs", description: "Writes and updates documentation, READMEs, and code comments" },
  { name: "security", description: "Security audit - finds vulnerabilities, secrets, and insecure patterns" },
  { name: "migrate", description: "Handles framework upgrades, dependency migrations, and breaking changes" },
  { name: "perf", description: "Performance analysis and optimization" },
]

describe("tokenize", () => {
  test("lowercases, splits on non-alphanumerics, and drops short words and stopwords", () => {
    expect(tokenize("Fix the FAILING tests, please!")).toEqual(["fix", "failing", "test"])
  })

  test("normalizes common plurals", () => {
    expect(tokenize("vulnerabilities crashes secrets")).toEqual(["vulnerability", "crash", "secret"])
  })
})

describe("shared", () => {
  test("marks tokens that appear in more than half of the candidates as generic", () => {
    const generic = shared([
      { name: "a", description: "widget alpha" },
      { name: "b", description: "widget beta" },
      { name: "c", description: "widget gamma" },
    ])
    expect(generic.has("widget")).toBe(true)
    expect(generic.has("alpha")).toBe(false)
  })
})

describe("route", () => {
  test("routes a security prompt to the security agent", () => {
    const choice = route("audit the auth module for vulnerabilities and leaked secrets", AGENTS)
    expect(choice?.agent).toBe("security")
  })

  test("routes a debugging prompt to the debug agent", () => {
    const choice = route("debug why these failing tests crash on startup", AGENTS)
    expect(choice?.agent).toBe("debug")
  })

  test("routes a documentation prompt to the docs agent", () => {
    const choice = route("update the documentation and code comments for the new API", AGENTS)
    expect(choice?.agent).toBe("docs")
  })

  test("weights an agent name mention above description overlap", () => {
    const choice = route("refactor this module", AGENTS)
    expect(choice?.agent).toBe("refactor")
  })

  test("falls back to default when nothing clears the threshold", () => {
    expect(route("add a new endpoint that returns the user profile", AGENTS)).toBeUndefined()
    expect(route("hello there", AGENTS)).toBeUndefined()
  })

  test("falls back to default when the top candidates tie", () => {
    const tied = [
      { name: "alpha", description: "handles rockets" },
      { name: "beta", description: "handles rockets" },
    ]
    expect(route("rockets are handles for everything, rockets everywhere", tied)).toBeUndefined()
  })

  test("falls back to default when there are no candidates", () => {
    expect(route("audit for vulnerabilities", [])).toBeUndefined()
  })

  test("honors a custom threshold", () => {
    const agents = [{ name: "alpha", description: "handles rockets" }]
    expect(route("rockets", agents, THRESHOLD)).toBeUndefined()
    expect(route("rockets", agents, 1)?.agent).toBe("alpha")
  })

  test("reports which stemmed tokens matched", () => {
    const choice = route("audit the auth module for vulnerabilities and leaked secrets", AGENTS)
    expect(choice?.matched).toContain("vulnerability")
    expect(choice?.matched).toContain("secret")
  })
})

describe("explain", () => {
  test("names the chosen agent and the matched tokens", () => {
    const choice = route("audit the auth module for vulnerabilities and leaked secrets", AGENTS)
    expect(explain(choice, "code")).toBe(`auto-agent: security (matched: ${choice?.matched.join(", ")})`)
  })

  test("names the fallback agent when no candidate was confident", () => {
    expect(explain(undefined, "code")).toBe("auto-agent: code (default, no confident match)")
  })
})

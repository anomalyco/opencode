import { describe, expect, test } from "bun:test"
import { readVerdict, resolvePersonas } from "@/loop/spec-queue/personas"

const REGISTRY = ["build", "plan", "coder", "tester", "reviewer", "researcher"]

describe("resolvePersonas", () => {
  test("defaults bind when the agents exist and config says nothing", () => {
    const { bindings, errors } = resolvePersonas(undefined, REGISTRY)
    expect(errors).toEqual([])
    expect(bindings).toEqual({ implement: "coder", test: "tester", verify: "reviewer" })
  })

  // A repo without these personas is not misconfigured — it just gets the
  // behaviour it had before. Only an explicit name that is wrong is an error.
  test("a default whose agent is absent binds nothing and reports nothing", () => {
    const { bindings, errors } = resolvePersonas(undefined, ["build", "coder"])
    expect(errors).toEqual([])
    expect(bindings).toEqual({ implement: "coder" })
  })

  test("false turns a gate off", () => {
    const { bindings, errors } = resolvePersonas({ verify: false }, REGISTRY)
    expect(errors).toEqual([])
    expect(bindings.verify).toBeUndefined()
    expect(bindings.implement).toBe("coder")
  })

  test("an explicit name overrides the default", () => {
    const { bindings, errors } = resolvePersonas({ verify: "researcher" }, REGISTRY)
    expect(errors).toEqual([])
    expect(bindings.verify).toBe("researcher")
  })

  test("naming an agent that does not exist is an error, not a silent skip", () => {
    const { bindings, errors } = resolvePersonas({ verify: "nobody" }, REGISTRY)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("nobody")
    expect(errors[0]).toContain("verify")
    expect(bindings.verify).toBeUndefined()
  })

  test("a gate with no default can be bound by config", () => {
    const { bindings, errors } = resolvePersonas({ commit: "coder" }, REGISTRY)
    expect(errors).toEqual([])
    expect(bindings.commit).toBe("coder")
  })
})

describe("readVerdict", () => {
  test("LGTM passes", () => {
    expect(readVerdict("Summary: fine.\n\n**Verdict:** LGTM").passed).toBe(true)
  })

  test("NEEDS_WORK fails and carries the whole review as the reason", () => {
    const review = "Findings: the ceiling is never restored on throw.\n\nVerdict: NEEDS_WORK"
    const verdict = readVerdict(review)
    expect(verdict.passed).toBe(false)
    if (!verdict.passed) expect(verdict.reason).toContain("ceiling is never restored")
  })

  // Everything below must fail. This is the last gate before commit in an
  // unattended run: a reviewer that crashed, said nothing, or hedged is not
  // approval, and reading it as approval ships a bad change with nobody
  // watching. One extra model turn is the entire cost of being wrong the other way.
  test("empty output fails", () => {
    const verdict = readVerdict("")
    expect(verdict.passed).toBe(false)
    if (!verdict.passed) expect(verdict.reason).toContain("no output")
  })

  test("undefined output fails", () => {
    expect(readVerdict(undefined).passed).toBe(false)
  })

  test("output with no recognisable verdict fails", () => {
    const verdict = readVerdict("I looked at the diff and it seems mostly reasonable.")
    expect(verdict.passed).toBe(false)
    if (!verdict.passed) expect(verdict.reason).toContain("no recognisable verdict")
  })

  test("a review naming both tokens is read by its conclusion", () => {
    expect(readVerdict("I considered LGTM but no.\n\nVerdict: NEEDS_WORK").passed).toBe(false)
  })

  // A review that quotes its own instructions ("return LGTM or NEEDS_WORK")
  // early and then concludes must not be failed by the quote.
  test("a mention far above the conclusion does not override it", () => {
    const review = ["My instructions say to return LGTM or NEEDS_WORK.", "x".repeat(600), "Verdict: LGTM"].join("\n")
    expect(readVerdict(review).passed).toBe(true)
  })
})

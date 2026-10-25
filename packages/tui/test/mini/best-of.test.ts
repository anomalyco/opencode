import { describe, expect, test } from "bun:test"
import { judgePrompt, LIMIT, parseCandidates, parseVerdict } from "../../../src/cli/cmd/run/best-of"

describe("cli.run.best-of", () => {
  test("parseCandidates splits, trims, and dedupes provider/model entries", () => {
    const result = parseCandidates(" anthropic/claude-sonnet-4 , openai/gpt-5, anthropic/claude-sonnet-4 ")
    expect(result).toEqual([
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
      { providerID: "openai", modelID: "gpt-5" },
    ])
  })

  test("parseCandidates keeps nested model paths intact", () => {
    const result = parseCandidates("openrouter/openai/gpt-5-chat,anthropic/claude-sonnet-4")
    expect(result).toEqual([
      { providerID: "openrouter", modelID: "openai/gpt-5-chat" },
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
    ])
  })

  test("parseCandidates rejects fewer than two models", () => {
    expect(typeof parseCandidates("anthropic/claude-sonnet-4")).toBe("string")
    expect(typeof parseCandidates("a/b,a/b")).toBe("string")
    expect(typeof parseCandidates("")).toBe("string")
  })

  test("parseCandidates rejects entries without a provider/model shape", () => {
    expect(typeof parseCandidates("anthropic/claude,gpt-5")).toBe("string")
    expect(typeof parseCandidates("anthropic/claude,/gpt-5")).toBe("string")
    expect(typeof parseCandidates("anthropic/claude,openai/")).toBe("string")
  })

  test("parseCandidates enforces the candidate limit", () => {
    const many = Array.from({ length: LIMIT + 1 }, (_, i) => `p/m${i}`).join(",")
    expect(typeof parseCandidates(many)).toBe("string")
  })

  test("judgePrompt embeds the task, every labeled output, and the verdict format", () => {
    const prompt = judgePrompt("write a haiku", [
      { label: "A", text: "one" },
      { label: "B", text: "two" },
    ])
    expect(prompt).toContain("write a haiku")
    expect(prompt).toContain("### Candidate A")
    expect(prompt).toContain("### Candidate B")
    expect(prompt).toContain("RANKING:")
    expect(prompt).toContain("(A, B)")
  })

  test("judgePrompt marks empty outputs instead of dropping them", () => {
    const prompt = judgePrompt("task", [
      { label: "A", text: "  " },
      { label: "B", text: "answer" },
    ])
    expect(prompt).toContain("(empty output)")
  })

  test("parseVerdict extracts the final ranking line", () => {
    const text = "B is correct.\nA is incomplete.\n\nRANKING: B > A"
    expect(parseVerdict(text, ["A", "B"])).toEqual(["B", "A"])
  })

  test("parseVerdict uses the last ranking when the judge repeats itself", () => {
    const text = 'The format is "RANKING: X > Y".\nRANKING: A > B\nOn reflection:\nRANKING: B > A'
    expect(parseVerdict(text, ["A", "B"])).toEqual(["B", "A"])
  })

  test("parseVerdict tolerates case and spacing", () => {
    expect(parseVerdict("ranking: c>a > b", ["A", "B", "C"])).toEqual(["C", "A", "B"])
  })

  test("parseVerdict rejects incomplete or duplicated rankings", () => {
    expect(parseVerdict("RANKING: A > B", ["A", "B", "C"])).toBeUndefined()
    expect(parseVerdict("RANKING: A > A", ["A", "B"])).toBeUndefined()
    expect(parseVerdict("RANKING: A > D", ["A", "B"])).toBeUndefined()
    expect(parseVerdict("no verdict here", ["A", "B"])).toBeUndefined()
  })
})

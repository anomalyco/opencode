import { describe, expect, test } from "bun:test"
import {
  compressToBudget,
  estimateTokens,
  rankByRelevance,
  relevanceScore,
  tokenizeQuery,
} from "@opencode-ai/core/system-context/relevance"

describe("estimateTokens", () => {
  test("floors small inputs at 1 and scales with length", () => {
    expect(estimateTokens("")).toBe(1)
    expect(estimateTokens("ab")).toBe(1) // ceil(2/4)=1
    expect(estimateTokens("abcd")).toBe(1) // ceil(4/4)=1
    expect(estimateTokens("abcde")).toBe(2) // ceil(5/4)=2
  })
})

describe("tokenizeQuery", () => {
  test("lowercases, splits, and drops stopwords", () => {
    expect(tokenizeQuery("Fix BUG, in the auth flow!")).toEqual(["fix", "bug", "auth", "flow"])
  })

  test("returns [] for an all-stopword query", () => {
    expect(tokenizeQuery("the and of in on")).toEqual([])
  })
})

describe("relevanceScore", () => {
  test("counts distinct query terms present in the document", () => {
    expect(relevanceScore("fix auth", "the auth module")).toBe(1)
    expect(relevanceScore("fix auth", "fix the auth")).toBe(2)
    expect(relevanceScore("fix auth", "unrelated readme")).toBe(0)
  })

  test("stopwords in the query contribute nothing", () => {
    expect(relevanceScore("fix the auth", "auth module")).toBe(1)
  })
})

describe("rankByRelevance", () => {
  test("scores descending and keeps original order on ties", () => {
    const items = ["auth flow", "fix auth", "auth flow", "random notes"]
    const ranked = rankByRelevance("fix auth", items, (item) => item)
    expect(ranked.map((item) => item.source)).toEqual(["fix auth", "auth flow", "auth flow", "random notes"])
    expect(ranked.map((item) => item.score)).toEqual([2, 1, 1, 0])
  })
})

describe("compressToBudget", () => {
  test("keeps a length-ordered prefix that fits the budget and stops at the first overflow", () => {
    const items = [{ text: "ab" }, { text: "abcdef" }, { text: "abcdefghij" }] // costs 1,2,3
    // budget 1 → only first (cost1 fits, second cost2 → 1+2>1 stop)
    expect(compressToBudget(items, 1).map((item) => item.text)).toEqual(["ab"])
    // budget 3 → first(1)+second(2)=3 fits; third(3)→ 3+3>3 stop
    expect(compressToBudget(items, 3).map((item) => item.text)).toEqual(["ab", "abcdef"])
    // budget 10 → all
    expect(compressToBudget(items, 10).map((item) => item.text)).toEqual(["ab", "abcdef", "abcdefghij"])
  })

  test("honors a custom tokenizer", () => {
    const items = [{ text: "a" }, { text: "b" }]
    expect(compressToBudget(items, 2, () => 2).map((item) => item.text)).toEqual(["a"])
  })
})

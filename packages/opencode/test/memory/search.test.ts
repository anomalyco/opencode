import { describe, expect, test } from "bun:test"
import * as Bm25 from "@/memory/bm25"
import { tokenize, queryTokens } from "@/memory/tokenize"
import { parsePath } from "@/memory/paths"

describe("memory/tokenize", () => {
  test("splits on punctuation into lowercase alnum runs", () => {
    expect(tokenize("postgres://host:5433")).toEqual(["postgres", "host", "5433"])
    expect(tokenize("T5.3 closure")).toEqual(["t5", "3", "closure"])
  })

  test("queryTokens dedupes preserving order", () => {
    expect(queryTokens("foo foo bar")).toEqual(["foo", "bar"])
  })
})

describe("memory/paths", () => {
  test("parses global scope", () => {
    const loc = parsePath("/data/memory/global/MEMORY.md")
    expect(loc).toEqual({ scope: "global", scope_id: "", type: "memory", key: "MEMORY" })
  })

  test("parses session checkpoint", () => {
    const loc = parsePath("/data/memory/sessions/ses_123/checkpoint.md")
    expect(loc).toMatchObject({ scope: "sessions", scope_id: "ses_123", type: "checkpoint", key: "checkpoint" })
  })

  test("returns null for non-memory paths", () => {
    expect(parsePath("/some/other/file.md")).toBeNull()
  })
})

describe("memory/bm25", () => {
  const docs: Bm25.Doc[] = [
    { path: "a", body: "the deadlock happened in the permission system" },
    { path: "b", body: "general notes about configuration and database" },
    { path: "c", body: "permission checks run before every tool call" },
  ]

  test("ranks the most relevant doc first", () => {
    const res = Bm25.search(docs, "permission deadlock", { limit: 10 })
    expect(res.length).toBeGreaterThan(0)
    expect(res[0].path).toBe("a")
  })

  test("returns empty for no token overlap", () => {
    expect(Bm25.search(docs, "kubernetes helm chart", { limit: 10 })).toEqual([])
  })

  test("snippet highlights matched terms", () => {
    const res = Bm25.search(docs, "deadlock", { limit: 1 })
    expect(res[0].snippet).toContain("<<deadlock>>")
  })

  test("respects limit", () => {
    const res = Bm25.search(docs, "permission", { limit: 1, floorRatio: 0 })
    expect(res.length).toBe(1)
  })
})

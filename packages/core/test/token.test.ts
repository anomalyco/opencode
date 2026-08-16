import { afterEach, describe, expect, test } from "bun:test"
import { Token } from "../src/util/token"

const text = "x".repeat(1200)

describe("Token.estimate", () => {
  afterEach(() => {
    Token.register(undefined)
  })

  test("prose default stays at 4 chars per token", () => {
    expect(Token.estimate(text)).toBe(300)
    expect(Token.estimate("")).toBe(0)
  })

  test("format tags select the measured density", () => {
    expect(Token.estimate(text, "csv")).toBe(Math.round(1200 / 1.3))
    expect(Token.estimate(text, "tsv")).toBe(Math.round(1200 / 1.3))
    expect(Token.estimate(text, "json")).toBe(800)
    expect(Token.estimate(text, "ndjson")).toBe(800)
    expect(Token.estimate(text, "jsonl")).toBe(800)
    expect(Token.estimate(text, "log")).toBe(600)
  })

  test("filenames derive the hint from their extension", () => {
    expect(Token.estimate(text, "data/report.CSV")).toBe(Math.round(1200 / 1.3))
    expect(Token.estimate(text, "server.log")).toBe(600)
    expect(Token.estimate(text, "payload.json")).toBe(800)
  })

  test("unknown hints fall back to the prose default", () => {
    expect(Token.estimate(text, "notes.md")).toBe(300)
    expect(Token.estimate(text, "Makefile")).toBe(300)
    expect(Token.estimate(text, "weird")).toBe(300)
  })

  test("a registered estimator wins and can be cleared", () => {
    const seen: Array<{ length: number; hint?: string }> = []
    Token.register((input, hint) => {
      seen.push({ length: input.length, hint })
      return 42.4
    })
    expect(Token.estimate(text, "csv")).toBe(42)
    expect(seen).toEqual([{ length: 1200, hint: "csv" }])
    Token.register(undefined)
    expect(Token.estimate(text, "csv")).toBe(Math.round(1200 / 1.3))
  })
})

import { describe, it, expect } from "bun:test"
import { supports1MContext } from "./anthropic"

describe("supports1MContext", () => {
  //#given a model string
  //#when checking if it supports 1M context
  //#then return true for Opus 4.6 models

  it("returns true for claude-opus-4-6", () => {
    expect(supports1MContext("claude-opus-4-6")).toBe(true)
  })

  it("returns true for claude-opus-4-6 with snapshot date suffix", () => {
    expect(supports1MContext("claude-opus-4-6-20260101")).toBe(true)
  })

  //#given a model string
  //#when checking if it supports 1M context
  //#then return true for Sonnet 4.5 models

  it("returns true for claude-sonnet-4-5", () => {
    expect(supports1MContext("claude-sonnet-4-5")).toBe(true)
  })

  it("returns true for claude-sonnet-4-5 with snapshot date suffix", () => {
    expect(supports1MContext("claude-sonnet-4-5-20250929")).toBe(true)
  })

  //#given a model string
  //#when checking if it supports 1M context
  //#then return true for Sonnet 4 models (prefix match)

  it("returns true for claude-sonnet-4 (canonical)", () => {
    expect(supports1MContext("claude-sonnet-4")).toBe(true)
  })

  it("returns true for claude-sonnet-4-20250514", () => {
    expect(supports1MContext("claude-sonnet-4-20250514")).toBe(true)
  })

  //#given a model string
  //#when checking if it supports 1M context
  //#then return false for Opus 4.5 models (not supported)

  it("returns false for claude-opus-4-5-20251101", () => {
    expect(supports1MContext("claude-opus-4-5-20251101")).toBe(false)
  })

  it("returns false for claude-opus-4-5", () => {
    expect(supports1MContext("claude-opus-4-5")).toBe(false)
  })

  //#given a model string
  //#when checking if it supports 1M context
  //#then return false for older Opus models

  it("returns false for claude-opus-4-1-20250805", () => {
    expect(supports1MContext("claude-opus-4-1-20250805")).toBe(false)
  })

  //#given a model string
  //#when checking if it supports 1M context
  //#then return false for Haiku models

  it("returns false for claude-haiku-4-5-20251001", () => {
    expect(supports1MContext("claude-haiku-4-5-20251001")).toBe(false)
  })

  it("returns false for claude-3-haiku-20240307", () => {
    expect(supports1MContext("claude-3-haiku-20240307")).toBe(false)
  })

  //#given a model string
  //#when checking if it supports 1M context
  //#then return false for unknown models

  it("returns false for unknown model", () => {
    expect(supports1MContext("some-random-model")).toBe(false)
  })

  //#given an empty string
  //#when checking if it supports 1M context
  //#then return false

  it("returns false for empty string", () => {
    expect(supports1MContext("")).toBe(false)
  })
})

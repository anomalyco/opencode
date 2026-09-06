import { describe, expect, test } from "bun:test"
import { parseDiscoveryResult } from "./dialog-custom-provider-models"

describe("parseDiscoveryResult", () => {
  test("returns trimmed, deduped ids for a successful result", () => {
    const result = parseDiscoveryResult({ ok: true, ids: ["model-a", "model-a", "  ", " b "] })
    expect(result).toEqual({ ok: true, models: ["model-a", "b"] })
  })

  test("translates every error kind", () => {
    for (const kind of ["invalidUrl", "unauthorized", "invalidFormat", "timeout", "failed"] as const) {
      expect(parseDiscoveryResult({ ok: false, kind })).toEqual({ ok: false, error: kind })
    }
  })

  test("preserves the optional message field without surfacing it", () => {
    expect(parseDiscoveryResult({ ok: false, kind: "unauthorized", message: "bad key" })).toEqual({
      ok: false,
      error: "unauthorized",
    })
  })

  test("reports invalidFormat when the ok payload lacks a string id array", () => {
    expect(parseDiscoveryResult({ ok: true, ids: "models" })).toEqual({ ok: false, error: "invalidFormat" })
    expect(parseDiscoveryResult({ ok: true, ids: [42] })).toEqual({ ok: false, error: "invalidFormat" })
  })

  test("reports failed for an unknown error kind", () => {
    expect(parseDiscoveryResult({ ok: false, kind: "unexpected" })).toEqual({ ok: false, error: "failed" })
  })

  test("reports failed for an unexpected payload shape", () => {
    expect(parseDiscoveryResult(null)).toEqual({ ok: false, error: "failed" })
    expect(parseDiscoveryResult({ object: "list" })).toEqual({ ok: false, error: "failed" })
  })
})

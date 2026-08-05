import { describe, expect, test } from "bun:test"
import {
  attachToolStructured,
  hasToolStructured,
  readToolRendererMetadata,
  readToolStructured,
} from "./session-tool-structured"

describe("session tool structured projection", () => {
  test("prefers a current structured value over legacy metadata", () => {
    expect(readToolStructured({ structured: { version: 1 }, metadata: { legacy: true } })).toEqual({ version: 1 })
    expect(readToolStructured({ structured: undefined, metadata: { legacy: true } })).toBeUndefined()
    expect(readToolStructured({ structured: null, metadata: { legacy: true } })).toBeNull()
  })

  test("falls back to legacy metadata when structured is absent", () => {
    expect(readToolStructured({ metadata: { legacy: true } })).toEqual({ legacy: true })
  })

  test("rejects null and array containers", () => {
    expect(readToolStructured(null)).toBeUndefined()
    expect(readToolStructured([])).toBeUndefined()
  })

  test("does not attach an undefined structured value", () => {
    expect(attachToolStructured({ status: "running" }, undefined)).toEqual({ status: "running" })
    expect(attachToolStructured({ status: "running" }, null)).toEqual({ status: "running", structured: null })
    expect(attachToolStructured({ status: "running" }, { version: 1 })).toEqual({
      status: "running",
      structured: { version: 1 },
    })
  })

  test("distinguishes an explicit structured field from a legacy metadata fallback", () => {
    expect(hasToolStructured({ metadata: {} })).toBeFalse()
    expect(hasToolStructured({ structured: undefined })).toBeTrue()
    expect(hasToolStructured({ structured: null })).toBeTrue()
  })

  test("keeps renderer metadata and only falls back to structured data for ordinary tools", () => {
    expect(
      readToolRendererMetadata("edit", {
        metadata: { source: "legacy" },
        structured: { source: "current" },
      }),
    ).toEqual({ source: "legacy" })
    expect(readToolRendererMetadata("edit", { structured: { source: "current" } })).toEqual({ source: "current" })
    expect(
      readToolRendererMetadata("visualization_create", {
        structured: { version: 1, title: "Chart", html: "<section>chart</section>" },
      }),
    ).toBeUndefined()
  })
})

import { expect, test } from "bun:test"
import { aboveCeiling, computeRecommendedCtx, MAX_CTX, MIN_WORKFLOW_CTX, PRESETS } from "../src/local/model-fit"

function mem(overrides: Partial<Parameters<typeof computeRecommendedCtx>[0]> = {}) {
  return {
    freeMb: 0,
    totalMb: 24560,
    usedMb: 0,
    label: "VRAM",
    modelMb: 8000,
    kvEstMb: 1024,
    ...overrides,
  }
}

test("returns null without enough signal", () => {
  expect(computeRecommendedCtx(mem({ kvEstMb: 0 }), 32768)).toBeNull()
  expect(computeRecommendedCtx(mem(), 0)).toBeNull()
})

test("scales the KV budget by the current hard ctx", () => {
  // 1024 MB KV at 32k + 1024 MB free → 2× the ctx.
  expect(computeRecommendedCtx(mem({ freeMb: 1024 }), 32768)).toBe(65536)
})

test("clamps to the workflow range when no ceiling is known", () => {
  expect(computeRecommendedCtx(mem({ freeMb: 0 }), 8192)).toBe(MIN_WORKFLOW_CTX)
  expect(computeRecommendedCtx(mem({ freeMb: 1_000_000 }), 32768)).toBe(MAX_CTX)
})

test("never recommends above max_fit_ctx", () => {
  // Plenty of free VRAM but max_fit_ctx says 32k is the VRAM limit.
  // Uncapped this returned ~250k.
  expect(computeRecommendedCtx(mem({ freeMb: 1_000_000 }), 32768)).toBe(MAX_CTX)
  expect(computeRecommendedCtx(mem({ freeMb: 1_000_000 }), 32768, 32768)).toBe(32768)
})

test("the ceiling outranks the workflow floor", () => {
  // max_fit_ctx 32k means VRAM only supports 32k; recommending above that
  // writes a --ctx-size the backend cannot load.
  expect(computeRecommendedCtx(mem({ freeMb: 0 }), 8192, 32768)).toBe(32768)
})

test("an unknown ceiling caps nothing", () => {
  expect(computeRecommendedCtx(mem({ freeMb: 1024 }), 32768, 0)).toBe(65536)
  expect(computeRecommendedCtx(mem({ freeMb: 1024 }), 32768, undefined)).toBe(65536)
})

test("aboveCeiling only fires on a known ceiling", () => {
  expect(aboveCeiling(98304, 32768)).toBe(true)
  expect(aboveCeiling(32768, 32768)).toBe(false)
  expect(aboveCeiling(4096, 32768)).toBe(false)
  expect(aboveCeiling(98304, 0)).toBe(false)
  expect(aboveCeiling(98304, undefined)).toBe(false)
})

test("PRESETS offers sizes above a typical VRAM ceiling", () => {
  // Guards the premise of the fix: the hand-authored preset list reaches far
  // past what a host with 32k max_fit_ctx can load, so the ceiling annotation
  // must exist.
  expect(PRESETS.filter((n) => aboveCeiling(n, 32768)).length).toBeGreaterThan(0)
  expect(PRESETS).toContain(98304)
})

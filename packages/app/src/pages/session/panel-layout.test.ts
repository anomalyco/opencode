import { describe, expect, test } from "bun:test"
import {
  normalizePanelState,
  normalizePanelWeights,
  panelAvailableSize,
  panelBoundary,
  panelGap,
  panelHandleOffset,
  panelPixels,
  panelTrackTemplate,
  resizePanelWeights,
} from "./panel-layout"

describe("panel layout", () => {
  test("normalizes stale or partially migrated panel state", () => {
    expect(normalizePanelState(undefined)).toEqual({
      width: 0,
      height: 0,
      columns: [],
      rows: [],
    })

    expect(
      normalizePanelState({
        width: 900,
        height: Number.POSITIVE_INFINITY,
        columns: [2, 1],
      }),
    ).toEqual({
      width: 900,
      height: 0,
      columns: [2, 1],
      rows: [],
    })
  })

  test("fills missing and invalid weights with equal tracks", () => {
    expect(normalizePanelWeights([], 2)).toEqual([0.5, 0.5])
    expect(normalizePanelWeights([3, -1, Number.NaN], 3)).toEqual([0.6, 0.2, 0.2])
  })

  test("builds minmax tracks so panels can shrink without horizontal overflow", () => {
    expect(panelTrackTemplate([0.25, 0.75])).toBe("minmax(0, 0.25fr) minmax(0, 0.75fr)")
  })

  test("subtracts only visible gaps from available space", () => {
    expect(panelAvailableSize(1000, 1)).toBe(1000)
    expect(panelAvailableSize(1000, 3)).toBe(1000 - panelGap * 2)
  })

  test("computes handle offsets at track boundaries plus half the gap", () => {
    expect(panelHandleOffset([300, 200], 0)).toBe(304)
    expect(panelHandleOffset([300, 200, 100], 1)).toBe(512)
  })

  test("resizes adjacent tracks while preserving total panel width", () => {
    const weights = resizePanelWeights([300, 300], 0, 420, 180)
    const pixels = panelPixels(weights, 600)

    expect(pixels.map(Math.round)).toEqual([420, 180])
    expect(Math.round(pixels.reduce((sum, value) => sum + value, 0))).toBe(600)
  })

  test("clamps resize at minimum track size", () => {
    const weights = resizePanelWeights([300, 300], 0, 80, 180)

    expect(panelPixels(weights, 600).map(Math.round)).toEqual([180, 420])
  })

  test("relaxes the minimum when adjacent tracks are already too small", () => {
    const weights = resizePanelWeights([120, 120, 760], 0, 220, 180)

    expect(panelPixels(weights, 1000).map(Math.round)).toEqual([120, 120, 760])
  })

  test("only changes the adjacent pair in multi-track layouts", () => {
    const weights = resizePanelWeights([200, 300, 500], 1, 620, 180)
    const pixels = panelPixels(weights, 1000)

    expect(pixels.map(Math.round)).toEqual([200, 420, 380])
    expect(panelBoundary(pixels, 1)).toBe(620)
  })
})

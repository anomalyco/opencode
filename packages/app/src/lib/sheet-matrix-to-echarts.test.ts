import { describe, expect, test } from "bun:test"
import { tableToEChartsOption } from "./sheet-matrix-to-echarts"

const palette = {
  fg: "#111111",
  muted: "#666666",
  border: "#cccccc",
  series: ["#3366ff", "#33aa66", "#ff6633", "#aa33cc"],
}

describe("tableToEChartsOption", () => {
  test("bar with series in columns uses first column as categories", () => {
    const opt = tableToEChartsOption({
      kind: "bar",
      seriesInRows: false,
      table: {
        headers: ["", "A", "B"],
        rows: [
          ["x", 1, 2],
          ["y", 3, 4],
        ],
      },
      palette,
    })
    const series = opt.series as { name: string; data: number[] }[]
    expect(series).toHaveLength(2)
    expect(series[0]!.name).toBe("A")
    expect(series[0]!.data).toEqual([1, 3])
    expect(series[1]!.data).toEqual([2, 4])
    const xAxis = opt.xAxis as { data: string[] }
    expect(xAxis.data).toEqual(["x", "y"])
  })

  test("coerces numeric strings", () => {
    const opt = tableToEChartsOption({
      kind: "bar",
      seriesInRows: false,
      table: {
        headers: ["h0", "h1"],
        rows: [["a", "10"]],
      },
      palette,
    })
    const series = opt.series as { data: number[] }[]
    expect(series[0]!.data).toEqual([10])
  })

  test("pie pairs without headers", () => {
    const opt = tableToEChartsOption({
      kind: "pie",
      seriesInRows: false,
      table: {
        rows: [
          ["east", 12],
          ["west", 8],
        ],
      },
      palette,
    })
    const series = opt.series as { type: string; data: { name: string; value: number }[] }[]
    expect(series[0]!.type).toBe("pie")
    expect(series[0]!.data).toEqual([
      { name: "east", value: 12 },
      { name: "west", value: 8 },
    ])
  })

  test("stack sets stack on bar series", () => {
    const opt = tableToEChartsOption({
      kind: "stack",
      seriesInRows: false,
      table: {
        headers: ["", "S1", "S2"],
        rows: [
          ["a", 1, 2],
          ["b", 3, 4],
        ],
      },
      palette,
    })
    const series = opt.series as { stack?: string }[]
    expect(series.every((s) => s.stack === "tot")).toBe(true)
  })

  test("series-in-rows uses header slice for x axis", () => {
    const opt = tableToEChartsOption({
      kind: "line",
      seriesInRows: true,
      table: {
        headers: ["region", "Q1", "Q2"],
        rows: [
          ["North", 1, 2],
          ["South", 3, 4],
        ],
      },
      palette,
    })
    const xAxis = opt.xAxis as { data: string[] }
    expect(xAxis.data).toEqual(["Q1", "Q2"])
    const series = opt.series as { name: string; data: number[] }[]
    expect(series.map((s) => s.name)).toEqual(["North", "South"])
    expect(series[0]!.data).toEqual([1, 2])
  })
})

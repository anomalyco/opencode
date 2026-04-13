import { describe, expect, test } from "bun:test"
import { elapsed, formatDuration, taskState } from "./runtime"

const i18n = {
  locale: () => "en",
  t: (key: string, params?: Record<string, string | number | boolean>) => {
    if (key === "ui.message.duration.seconds") return `${params?.count}s`
    if (key === "ui.message.duration.minutesSeconds") return `${params?.minutes}m ${params?.seconds}s`
    if (key === "ui.message.queued") return "Queued"
    if (key === "ui.tool.task.running") return "Running"
    if (key === "ui.tool.task.completed") return "Completed"
    if (key === "ui.toolErrorCard.failed") return "Failed"
    return key
  },
}

describe("formatDuration", () => {
  test("formats seconds", () => {
    expect(formatDuration(i18n, 4_300)).toBe("4s")
  })

  test("formats minutes and seconds", () => {
    expect(formatDuration(i18n, 61_000)).toBe("1m 1s")
  })
})

describe("elapsed", () => {
  test("uses the recorded end time when present", () => {
    expect(elapsed({ start: 1_000, end: 4_200 }, 20_000)).toBe(3_200)
  })

  test("uses now for running tools", () => {
    expect(elapsed({ start: 1_000 }, 4_200)).toBe(3_200)
  })

  test("skips invalid ranges", () => {
    expect(elapsed({ start: 5_000, end: 1_000 })).toBeUndefined()
  })
})

describe("taskState", () => {
  test("maps tool states to labels", () => {
    expect(taskState(i18n, "pending")).toBe("Queued")
    expect(taskState(i18n, "running")).toBe("Running")
    expect(taskState(i18n, "completed")).toBe("Completed")
    expect(taskState(i18n, "error")).toBe("Failed")
  })
})

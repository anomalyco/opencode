import { describe, expect, test } from "bun:test"
import type { UiI18n } from "@opencode-ai/ui/context/i18n"
import { formatMessageStamp, handleCopyResponseClick } from "./message-actions"
import { readPartText } from "./message-part-text"
import { toolMeta } from "./tool-meta"

const i18n: UiI18n = {
  locale: () => "en-US",
  t: (key, values) => {
    if (key === "ui.message.duration.seconds") return `${values?.count}s`
    if (key === "ui.message.duration.minutesSeconds") return `${values?.minutes}m ${values?.seconds}s`
    if (key === "ui.message.interrupted") return "Interrupted"
    if (key === "ui.toolErrorCard.failed") return "Failed"
    return key
  },
}

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})

describe("toolMeta", () => {
  test("formats completed tool start time and duration", () => {
    expect(
      toolMeta(i18n, {
        status: "completed",
        start: Date.UTC(2026, 5, 28, 14, 3, 0),
        end: Date.UTC(2026, 5, 28, 14, 3, 5),
        now: Date.UTC(2026, 5, 28, 14, 3, 8),
      }),
    ).toBe("2:03 PM · 5s")
  })

  test("formats running tool start time and live duration", () => {
    expect(
      toolMeta(i18n, {
        status: "running",
        start: Date.UTC(2026, 5, 28, 14, 3, 0),
        now: Date.UTC(2026, 5, 28, 14, 3, 7),
      }),
    ).toBe("2:03 PM · 7s")
  })

  test("shows interrupted state without duration", () => {
    expect(
      toolMeta(i18n, {
        status: "interrupted",
        start: Date.UTC(2026, 5, 28, 14, 3, 0),
        now: Date.UTC(2026, 5, 28, 14, 3, 7),
      }),
    ).toBe("2:03 PM · Interrupted")
  })

  test("returns empty meta for pending tool without start time", () => {
    expect(
      toolMeta(i18n, {
        status: "pending",
        now: Date.UTC(2026, 5, 28, 14, 3, 7),
      }),
    ).toBe("")
  })

  test("formats error tool start time and failed state", () => {
    expect(
      toolMeta(i18n, {
        status: "error",
        start: Date.UTC(2026, 5, 28, 14, 3, 0),
        end: Date.UTC(2026, 5, 28, 14, 3, 5),
        now: Date.UTC(2026, 5, 28, 14, 3, 8),
      }),
    ).toBe("2:03 PM · Failed")
  })

  test("formats minute durations", () => {
    expect(
      toolMeta(i18n, {
        status: "completed",
        start: Date.UTC(2026, 5, 28, 14, 3, 0),
        end: Date.UTC(2026, 5, 28, 14, 4, 5),
        now: Date.UTC(2026, 5, 28, 14, 4, 8),
      }),
    ).toBe("2:03 PM · 1m 5s")
  })
})

describe("handleCopyResponseClick", () => {
  test("stops timeline click propagation before copying the response", () => {
    let stopped = false
    let copied = false

    handleCopyResponseClick(
      {
        stopPropagation: () => {
          stopped = true
        },
      },
      () => {
        copied = stopped
      },
    )

    expect(stopped).toBe(true)
    expect(copied).toBe(true)
  })
})

describe("formatMessageStamp", () => {
  test("formats message date and time", () => {
    expect(formatMessageStamp("en-US", Date.UTC(2026, 5, 28, 14, 3, 0))).toBe("Jun 28, 2026, 2:03 PM")
  })
})

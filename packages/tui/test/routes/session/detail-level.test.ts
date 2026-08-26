import { describe, expect, test } from "bun:test"
import { nextTranscriptDetail, transcriptDetailAt } from "../../../src/routes/session/detail-level"

describe("transcript detail", () => {
  test("maps the slider into three equal stops", () => {
    expect(transcriptDetailAt(-1, 30)).toBe("final")
    expect(transcriptDetailAt(0, 30)).toBe("final")
    expect(transcriptDetailAt(9, 30)).toBe("final")
    expect(transcriptDetailAt(10, 30)).toBe("compact")
    expect(transcriptDetailAt(19, 30)).toBe("compact")
    expect(transcriptDetailAt(20, 30)).toBe("full")
    expect(transcriptDetailAt(30, 30)).toBe("full")
  })

  test("cycles through every stop", () => {
    expect(nextTranscriptDetail("final")).toBe("compact")
    expect(nextTranscriptDetail("compact")).toBe("full")
    expect(nextTranscriptDetail("full")).toBe("final")
  })
})

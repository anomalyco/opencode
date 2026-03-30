import { describe, expect, test } from "bun:test"
import { dataUrlFromMediaValue, mediaKindFromPath } from "./media"

describe("media", () => {
  test("detects svg and pdf by extension", () => {
    expect(mediaKindFromPath("icon.svg")).toBe("svg")
    expect(mediaKindFromPath("guide.pdf")).toBe("pdf")
  })

  test("builds svg and pdf data URLs from file records", () => {
    expect(
      dataUrlFromMediaValue(
        {
          mimeType: "image/svg+xml",
          content: "<svg></svg>",
        },
        "svg",
      ),
    ).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E")

    expect(
      dataUrlFromMediaValue(
        {
          mimeType: "application/pdf",
          encoding: "base64",
          content: "JVBERi0xLjc=",
        },
        "pdf",
      ),
    ).toBe("data:application/pdf;base64,JVBERi0xLjc=")
  })
})

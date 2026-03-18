import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { screenshotName, screenshotText } from "./session-screenshot"

describe("screenshotText", () => {
  test("keeps prompt text and inline references", () => {
    expect(
      screenshotText([
        {
          type: "text",
          text: "Review @src/app.ts with @build and this image",
          synthetic: false,
          ignored: false,
        } as unknown as Part,
        {
          type: "file",
          id: "f_1",
          mime: "text/plain",
          filename: "app.ts",
          url: "file:///repo/src/app.ts",
          source: {
            type: "text",
            value: "@src/app.ts",
            start: 7,
            end: 18,
            path: "/repo/src/app.ts",
          },
        } as unknown as Part,
        {
          type: "agent",
          id: "a_1",
          name: "build",
          source: {
            value: "@build",
            start: 24,
            end: 30,
          },
        } as unknown as Part,
        {
          type: "file",
          id: "f_2",
          mime: "image/png",
          filename: "mock.png",
          url: "data:image/png;base64,abc",
        } as unknown as Part,
      ]),
    ).toBe("Review @src/app.ts with @build and this image[image: mock.png]")
  })
})

describe("screenshotName", () => {
  test("builds a clean png filename", () => {
    expect(screenshotName("Ship launch: v1", new Date("2026-03-06T12:00:00.000Z"))).toBe(
      "ship-launch-v1-screenshot-2026-03-06.png",
    )
  })
})

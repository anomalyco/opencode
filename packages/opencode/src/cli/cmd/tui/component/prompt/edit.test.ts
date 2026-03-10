import { describe, expect, test } from "bun:test"
import { lead } from "./edit"

describe("prompt edit", () => {
  test("leads prompt text and shifts parts", () => {
    const next = lead(
      {
        input: "hello @build @src/app.ts [pasted]",
        parts: [
          {
            type: "agent",
            name: "build",
            source: { start: 6, end: 12, value: "@build" },
          },
          {
            type: "file",
            mime: "text/plain",
            filename: "src/app.ts",
            url: "file:///src/app.ts",
            source: {
              type: "file",
              path: "src/app.ts",
              text: { start: 13, end: 24, value: "@src/app.ts" },
            },
          },
          {
            type: "text",
            text: "pasted",
            source: {
              text: { start: 25, end: 33, value: "[pasted]" },
            },
          },
        ],
      },
      "/skill ",
    )

    expect(next.input).toBe("/skill hello @build @src/app.ts [pasted]")
    expect(next.parts).toEqual([
      {
        type: "agent",
        name: "build",
        source: { start: 13, end: 19, value: "@build" },
      },
      {
        type: "file",
        mime: "text/plain",
        filename: "src/app.ts",
        url: "file:///src/app.ts",
        source: {
          type: "file",
          path: "src/app.ts",
          text: { start: 20, end: 31, value: "@src/app.ts" },
        },
      },
      {
        type: "text",
        text: "pasted",
        source: {
          text: { start: 32, end: 40, value: "[pasted]" },
        },
      },
    ])
  })
})

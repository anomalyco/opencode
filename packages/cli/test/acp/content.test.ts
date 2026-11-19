import type { ContentBlock } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { promptContentToParts } from "../../src/acp/content"

const blob = "JVBERi0xLjQK"

describe("acp embedded resource", () => {
  test("keeps a blob whose mimeType is omitted", () => {
    const parts = promptContentToParts([
      { type: "text", text: "Inspect this file" },
      { type: "resource", resource: { uri: "mcp://context/report.pdf", blob } } as ContentBlock,
    ])

    expect(parts).toEqual([
      { type: "text", text: "Inspect this file" },
      {
        type: "file",
        url: `data:application/octet-stream;base64,${blob}`,
        filename: "report.pdf",
        mime: "application/octet-stream",
      },
    ])
  })

  test("keeps the declared mimeType", () => {
    const parts = promptContentToParts([
      { type: "resource", resource: { uri: "mcp://context/report.pdf", mimeType: "application/pdf", blob } },
    ])

    expect(parts).toEqual([
      { type: "file", url: `data:application/pdf;base64,${blob}`, filename: "report.pdf", mime: "application/pdf" },
    ])
  })
})

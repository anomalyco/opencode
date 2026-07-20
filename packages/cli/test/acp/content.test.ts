import { describe, expect, test } from "bun:test"
import { pathToFileURL } from "node:url"
import { contentBlockToParts, partsToContentChunks } from "../../src/acp/content"

describe("acp content", () => {
  test("converts annotated text and images", () => {
    expect(contentBlockToParts({ type: "text", text: "internal", annotations: { audience: ["assistant"] } })).toEqual([
      { type: "text", text: "internal", synthetic: true },
    ])
    expect(contentBlockToParts({ type: "image", data: "AAAA", mimeType: "image/png" })).toEqual([
      { type: "file", url: "data:image/png;base64,AAAA", filename: "image", mime: "image/png" },
    ])
  })

  test("converts file and embedded resources", () => {
    expect(
      contentBlockToParts({ type: "resource_link", uri: "file:///tmp/notes.txt", name: "notes.txt" }),
    ).toEqual([{ type: "file", url: "file:///tmp/notes.txt", filename: "notes.txt", mime: "text/plain" }])
    expect(
      contentBlockToParts({ type: "resource", resource: { uri: "mcp://context", text: "hello" } }),
    ).toEqual([{ type: "text", text: "[mcp://context]\nhello" }])
  })

  test("replays files and data urls", () => {
    expect(
      partsToContentChunks([
        { type: "file", url: "file:///tmp/readme.md", filename: "readme.md", mime: "text/markdown" },
        { type: "file", url: "data:text/plain;base64,aGVsbG8=", filename: "note.txt", mime: "text/plain" },
      ]),
    ).toEqual([
      { content: { type: "resource_link", uri: "file:///tmp/readme.md", name: "readme.md", mimeType: "text/markdown" } },
      {
        content: {
          type: "resource",
          resource: { uri: pathToFileURL("note.txt").href, mimeType: "text/plain", text: "hello" },
        },
      },
    ])
  })
})

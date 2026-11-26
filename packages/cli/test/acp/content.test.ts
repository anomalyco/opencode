import { describe, expect, test } from "bun:test"
import { pathToFileURL } from "node:url"
import { partsToContentChunks, promptContentToParts } from "../../src/acp/content"

describe("acp prompt content", () => {
  test("attaches an embedded blob without a mimeType, inferring it from the name (#64687)", () => {
    expect(
      promptContentToParts([
        { type: "resource", resource: { uri: "mcp://context/report.pdf", blob: "JVBERi0xLjQK" } },
        { type: "resource", resource: { uri: "mcp://context/blob", blob: "AAAA" } },
      ]),
    ).toEqual([
      {
        type: "file",
        url: "data:application/pdf;base64,JVBERi0xLjQK",
        filename: "report.pdf",
        mime: "application/pdf",
      },
      {
        type: "file",
        url: "data:application/octet-stream;base64,AAAA",
        filename: "blob",
        mime: "application/octet-stream",
      },
    ])
  })

  test("attaches local resource links under every file URI spelling (#60298)", () => {
    expect(
      ["file:/tmp/a.txt", "file:///tmp/a.txt"].map((uri) =>
        promptContentToParts([{ type: "resource_link", uri, name: "a.txt", mimeType: "text/plain" }]),
      ),
    ).toEqual([
      [{ type: "file", url: "file:///tmp/a.txt", filename: "a.txt", mime: "text/plain" }],
      [{ type: "file", url: "file:///tmp/a.txt", filename: "a.txt", mime: "text/plain" }],
    ])
  })

  test("decodes attachment names once and replays them without encoding them twice (#59792)", () => {
    const parts = promptContentToParts([
      { type: "image", data: "", mimeType: "image/png", uri: "file:///tmp/photo%201.png" },
      {
        type: "resource",
        resource: { uri: "file:///tmp/caf%C3%A9%20%231.bin", mimeType: "application/octet-stream", blob: "AAAA" },
      },
      { type: "image", data: "", mimeType: "image/png", uri: "zed:///agent/file?path=%2Ftmp%2Fodd%2520name.png" },
    ])

    expect(parts.map((part) => (part.type === "file" ? part.filename : undefined))).toEqual([
      "photo 1.png",
      "café #1.bin",
      "odd%20name.png",
    ])
    expect(
      partsToContentChunks([
        { type: "file", url: "data:image/png;base64,AAAA", filename: "photo 1.png", mime: "image/png" },
      ]).map((chunk) => (chunk.content.type === "image" ? chunk.content.uri : undefined)),
    ).toEqual([pathToFileURL("photo 1.png").href])
  })
})

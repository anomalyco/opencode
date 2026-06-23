import { describe, expect, test } from "bun:test"
import type { ContentBlock } from "@agentclientprotocol/sdk"
import { pathToFileURL } from "node:url"
import { contentBlockToParts, partsToContentChunks, promptContentToParts } from "../../src/acp/content"

describe("acp content conversion", () => {
  test("plain text block becomes a text part", () => {
    expect(contentBlockToParts({ type: "text", text: "hello" })).toEqual([{ type: "text", text: "hello" }])
  })

  test("assistant-only text audience becomes synthetic", () => {
    expect(
      contentBlockToParts({
        type: "text",
        text: "internal",
        annotations: { audience: ["assistant"] },
      }),
    ).toEqual([{ type: "text", text: "internal", synthetic: true }])
  })

  test("user-only text audience becomes ignored", () => {
    expect(
      contentBlockToParts({
        type: "text",
        text: "visible to user",
        annotations: { audience: ["user"] },
      }),
    ).toEqual([{ type: "text", text: "visible to user", ignored: true }])
  })

  test("image block with base64 data becomes a data URL file part", () => {
    expect(
      contentBlockToParts({
        type: "image",
        data: "AAAA",
        mimeType: "image/png",
        uri: "file:///tmp/screenshot.png",
      }),
    ).toEqual([
      {
        type: "file",
        url: "data:image/png;base64,AAAA",
        filename: "screenshot.png",
        mime: "image/png",
      },
    ])
  })

  test("image block with http URI becomes a file part", () => {
    expect(
      contentBlockToParts({
        type: "image",
        data: "",
        mimeType: "image/jpeg",
        uri: "http://example.com/assets/photo.jpg",
      }),
    ).toEqual([
      {
        type: "file",
        url: "http://example.com/assets/photo.jpg",
        filename: "photo.jpg",
        mime: "image/jpeg",
      },
    ])
  })

  test("resource_link file URL becomes a file part with name and fallback mime", () => {
    expect(
      contentBlockToParts({
        type: "resource_link",
        uri: "file:///tmp/notes.txt",
        name: "client-notes.txt",
      }),
    ).toEqual([
      {
        type: "file",
        url: "file:///tmp/notes.txt",
        filename: "client-notes.txt",
        mime: "text/plain",
      },
    ])
  })

  test("resource_link zed path becomes a file URL part", () => {
    expect(
      contentBlockToParts({
        type: "resource_link",
        uri: "zed://workspace?path=/tmp/project/src/app.ts",
        name: "app.ts",
        mimeType: "text/typescript",
      }),
    ).toEqual([
      {
        type: "file",
        url: pathToFileURL("/tmp/project/src/app.ts").href,
        filename: "app.ts",
        mime: "text/typescript",
      },
    ])
  })

  test("resource with text becomes a sourced text part", () => {
    expect(
      contentBlockToParts({
        type: "resource",
        resource: {
          uri: "file:///tmp/context.txt#L12-L14",
          mimeType: "text/plain",
          text: "context",
        },
      }),
    ).toEqual([{ type: "text", text: "[/tmp/context.txt:12]\ncontext" }])
  })

  test("resource with text uses URI fallback for non-file resources", () => {
    expect(
      contentBlockToParts({
        type: "resource",
        resource: {
          uri: "mcp://server/context",
          text: "context",
        },
      }),
    ).toEqual([{ type: "text", text: "[mcp://server/context]\ncontext" }])
  })

  test("resource with blob and mimeType becomes a data URL file part", () => {
    expect(
      contentBlockToParts({
        type: "resource",
        resource: {
          uri: "file:///tmp/report.pdf",
          mimeType: "application/pdf",
          blob: "JVBERg==",
        },
      }),
    ).toEqual([
      {
        type: "file",
        url: "data:application/pdf;base64,JVBERg==",
        filename: "report.pdf",
        mime: "application/pdf",
      },
    ])
  })

  test("data URL resource is preserved as a file part", () => {
    expect(
      contentBlockToParts({
        type: "resource",
        resource: {
          uri: "data:text/plain;base64,aGVsbG8=",
          mimeType: "text/plain",
          blob: "ignored",
        },
      }),
    ).toEqual([
      {
        type: "file",
        url: "data:text/plain;base64,aGVsbG8=",
        filename: "file",
        mime: "text/plain",
      },
    ])
  })

  test("unsupported blocks are ignored", () => {
    expect(promptContentToParts([{ type: "audio", data: "AAAA", mimeType: "audio/wav" }])).toEqual([])
    expect(promptContentToParts([{ type: "unknown", text: "skip" } as unknown as ContentBlock])).toEqual([])
  })
})

describe("acp replay conversion", () => {
  test("replays text audience annotations", () => {
    expect(partsToContentChunks([{ type: "text", text: "cached", synthetic: true }])).toEqual([
      {
        content: {
          type: "text",
          text: "cached",
          annotations: { audience: ["assistant"] },
        },
      },
    ])
  })

  test("replays file and data URL parts as ACP content", () => {
    expect(
      partsToContentChunks([
        { type: "file", url: "file:///tmp/readme.md", filename: "readme.md", mime: "text/markdown" },
        { type: "file", url: "data:text/plain;base64,aGVsbG8=", filename: "note.txt", mime: "text/plain" },
      ]),
    ).toEqual([
      {
        content: {
          type: "resource_link",
          uri: "file:///tmp/readme.md",
          name: "readme.md",
          mimeType: "text/markdown",
        },
      },
      {
        content: {
          type: "resource",
          resource: {
            uri: pathToFileURL("note.txt").href,
            mimeType: "text/plain",
            text: "hello",
          },
        },
      },
    ])
  })
})

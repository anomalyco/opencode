import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import type { SessionMessageUser } from "@opencode/client/promise"
import { extractPromptContext, extractPromptFromMessage, type PromptSource } from "./prompt"
import { buildPromptRequest } from "./request"
import { contextItemKey, Prompt } from "./schema"

describe("extractPromptFromMessage", () => {
  test("restores a renamed session and preserves file offsets when resubmitted", () => {
    const id = "ses_0123456789abcdefghijklmnop"
    const text = `@session:${id} @a.ts`

    const prompt = extractPromptFromMessage(
      {
        id: "msg_mention",
        text,
        files: [
          {
            data: "",
            mime: "text/plain",
            source: { type: "uri", uri: "file:///repo/a.ts" },
            mention: { text: "@a.ts", start: 40, end: 45 },
          },
        ],
      },
      { sessionTitle: () => "Renamed", directory: "/repo" },
    )

    expect(prompt).toMatchObject([
      { type: "session", id, content: "@Renamed", start: 0, end: 8 },
      { type: "text", content: " ", start: 8, end: 9 },
      { type: "file", content: "@a.ts", start: 9, end: 14 },
    ])

    const result = buildPromptRequest({
      prompt,
      context: [],
      images: [],
      text: "@Renamed @a.ts",
      sessionDirectory: "/repo",
    })

    expect(result.text).toBe(text)
    expect(result.files[0]?.mention).toEqual({ text: "@a.ts", start: 40, end: 45 })
  })

  test("restores uploaded attachments in order, optimistic data URLs, and review comments", () => {
    const message = {
      id: "msg_1",
      type: "user",
      text: "model text",
      metadata: {
        displayText: "visible text",
        comments: [
          {
            path: "src/app.ts",
            comment: "check this",
            selection: { startLine: 2, startChar: 0, endLine: 2, endChar: 4 },
            origin: "review",
          },
        ],
      },
      files: [
        { data: "AAA", mime: "image/png", source: { type: "inline" }, name: "a.png" },
        { data: "BBB", mime: "application/pdf", source: { type: "inline" }, name: "b.pdf" },
        { data: "", mime: "image/png", source: { type: "uri", uri: "data:image/png;base64,CCC" }, name: "c.png" },
      ],
      time: { created: 1 },
    } satisfies SessionMessageUser

    expect(extractPromptFromMessage(message)).toEqual([
      { type: "text", content: "visible text", start: 0, end: 12 },
      ...[
        ["a.png", "image/png", "data:image/png;base64,AAA"],
        ["b.pdf", "application/pdf", "data:application/pdf;base64,BBB"],
        ["c.png", "image/png", "data:image/png;base64,CCC"],
      ].map(([filename, mime, url], index) => ({
        type: "image" as const,
        id: `msg_1:file:${index}`,
        filename,
        mime,
        blob: { id: url, url },
      })),
    ])
    expect(extractPromptContext(message)).toMatchObject({
      comments: [{ type: "file", path: "src/app.ts", comment: "check this", commentOrigin: "review" }],
      files: [],
    })
  })

  test("restores a URI-sourced attachment from its inline bytes, and skips a handoff row with none", () => {
    const message = {
      id: "msg_uri",
      type: "user",
      text: "",
      files: [
        { data: "AAA", mime: "image/png", source: { type: "uri", uri: "https://example.com/a.png" }, name: "a.png" },
        { data: "", mime: "image/png", source: { type: "uri", uri: "blob:http://app/handoff" }, name: "b.png" },
      ],
      time: { created: 1 },
    } satisfies SessionMessageUser

    expect(extractPromptFromMessage(message)).toEqual([
      { type: "text", content: "", start: 0, end: 0 },
      {
        type: "image",
        id: "msg_uri:file:0",
        filename: "a.png",
        mime: "image/png",
        blob: { id: "data:image/png;base64,AAA", url: "data:image/png;base64,AAA" },
      },
    ])
  })

  test("keeps the directory of a file mention without an at-sign", () => {
    const message = {
      id: "msg_1",
      type: "user",
      text: "inspect src/client.ts",
      files: [
        {
          data: "",
          mime: "text/plain",
          source: { type: "uri", uri: "file:///repo/src/client.ts" },
          name: "client.ts",
          mention: { text: "src/client.ts", start: 8, end: 21 },
        },
      ],
      time: { created: 1 },
    } satisfies SessionMessageUser

    expect(extractPromptFromMessage(message)).toMatchObject([
      { type: "text", content: "inspect " },
      { type: "file", content: "src/client.ts", path: "src/client.ts" },
    ])
  })

  test("uses model text when presentation metadata is incomplete", () => {
    const message = {
      id: "msg_1",
      type: "user",
      text: "model text",
      metadata: { displayText: "partial display text" },
      time: { created: 1 },
    } satisfies SessionMessageUser

    expect(extractPromptFromMessage(message)[0]).toMatchObject({ type: "text", content: "model text" })
  })

  test("restores every input another client sent without duplicating review comment files", () => {
    const message = {
      id: "msg_1",
      type: "user",
      text: "model text",
      metadata: {
        displayText: "日本 @main.ts",
        comments: [
          {
            path: "/repo/app.ts",
            comment: "check this",
            selection: { startLine: 2, startChar: 0, endLine: 2, endChar: 0 },
          },
        ],
        attachments: [{ name: "report.zip", mime: "application/zip", path: "/repo/report.zip" }],
      },
      files: [
        // Display-width offsets, as the TUI records them after wide characters.
        {
          data: "",
          mime: "text/plain",
          source: { type: "uri", uri: "file:///repo/main.ts" },
          name: "main.ts",
          mention: { text: "@main.ts", start: 5, end: 13 },
        },
        {
          data: "aGk=",
          mime: "text/plain",
          source: { type: "uri", uri: "file:///repo/app.ts?start=2&end=2" },
          name: "app.ts",
        },
        {
          data: "bm90ZXM=",
          mime: "text/markdown",
          source: { type: "uri", uri: "file:///repo/notes.md" },
          name: "notes.md",
          description: "the failing version",
        },
        {
          data: "c3JjLw==",
          mime: "application/x-directory",
          source: { type: "uri", uri: "file:///repo/src" },
          name: "src",
        },
        // The workspace root has no relative path.
        { data: "", mime: "application/x-directory", source: { type: "uri", uri: "file:///repo" }, name: "repo" },
        // An empty file is stored with empty data, not missing data.
        { data: "", mime: "text/plain", source: { type: "inline" }, name: "empty.txt" },
      ],
      agents: [{ name: "plan" }],
      skills: [{ id: "review", name: "Review" }],
      time: { created: 1 },
    } satisfies SessionMessageUser

    expect(extractPromptFromMessage(message, { directory: "/repo" })).toMatchObject([
      { type: "text", content: "日本 " },
      { type: "file", content: "@main.ts", url: "file:///repo/main.ts" },
      { type: "text", content: " " },
      { type: "agent", content: "@plan", name: "plan" },
      { type: "text", content: " " },
      { type: "skill", content: "@review", id: "review" },
      { type: "image", filename: "empty.txt", mime: "text/plain", blob: { url: "data:text/plain;base64," } },
      { type: "path", filename: "report.zip", path: "/repo/report.zip" },
    ])

    // Unmentioned file references return as context chips, not mention text, as the TUI keeps them.
    const context = extractPromptContext(message, { directory: "/repo" })

    expect(context.files).toEqual([
      { type: "file", path: "notes.md", name: "notes.md", description: "the failing version" },
      // A directory keeps its URI rather than turning into a snapshot of its listing.
      { type: "file", path: "src", name: "src" },
      { type: "file", path: "/repo", name: "repo" },
    ])
    // Resubmitting the restored context sends each file once, under the URI, name, and description it had.
    expect(
      buildPromptRequest({
        prompt: [],
        context: [...context.comments, ...context.files].map((item) => ({ ...item, key: contextItemKey(item) })),
        images: [],
        text: "",
        sessionDirectory: "/repo",
      }).files.map((file) => [file.uri, file.name, file.description]),
    ).toEqual([
      ["file:///repo/app.ts?start=2&end=2", "app.ts", undefined],
      ["file:///repo/notes.md", "notes.md", "the failing version"],
      ["file:///repo/src", "src", undefined],
      ["file:///repo", "repo", undefined],
    ])
  })

  test("restores skill mentions as structured Composer parts", () => {
    const message = {
      id: "msg_1",
      type: "user",
      text: "Use @review",
      skills: [{ id: "review", name: "Review", mention: { text: "@review", start: 4, end: 11 } }],
      time: { created: 1 },
    } satisfies SessionMessageUser

    expect(extractPromptFromMessage(message)).toMatchObject([
      { type: "text", content: "Use " },
      {
        type: "skill",
        id: "review",
        name: "Review",
        content: "@review",
      },
    ])
  })

  test("restores experimental-media-uri attachments, whose bytes stay on the server", () => {
    const imageHash = "a".repeat(64)

    const message = {
      id: "msg_media",
      type: "user",
      text: "inspect @src/app.ts",
      files: [
        {
          uri: `media:${imageHash}`,
          mime: "image/png",
          source: { type: "inline" },
          width: 640,
          height: 480,
          bytes: 4096,
          name: "screen.png",
        },
        {
          uri: `media:${"b".repeat(64)}`,
          mime: "text/plain",
          bytes: 128,
          source: { type: "uri", uri: "file:///repo/src/app.ts?start=3&end=7" },
          name: "app.ts",
          mention: { text: "@src/app.ts", start: 8, end: 19 },
        },
        {
          uri: `media:${"c".repeat(64)}`,
          mime: "text/plain",
          bytes: 256,
          source: { type: "uri", uri: "file:///repo/src/context.ts" },
          name: "context.ts",
        },
      ],
      time: { created: 1 },
    } satisfies PromptSource & { type: "user"; time: { created: number } }

    expect(extractPromptFromMessage(message, { directory: "/repo" })).toMatchObject([
      { type: "text", content: "inspect " },
      {
        type: "file",
        content: "@src/app.ts",
        path: "src/app.ts",
        url: "file:///repo/src/app.ts?start=3&end=7",
        selection: { startLine: 3, endLine: 7 },
      },
      {
        type: "image",
        filename: "screen.png",
        mime: "image/png",
        blob: { id: `media:${imageHash}`, url: "" },
      },
    ])
    // Revert, fork and recall put this prompt into a persisted draft, so it must encode.
    expect(() => Schema.encodeSync(Prompt)(extractPromptFromMessage(message, { directory: "/repo" }))).not.toThrow()

    expect(extractPromptContext(message, { directory: "/repo" }).files).toEqual([
      { type: "file", path: "src/context.ts", name: "context.ts" },
    ])
  })
})

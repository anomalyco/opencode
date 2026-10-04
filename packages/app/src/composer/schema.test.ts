import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { SessionMessage } from "@opencode/schema/session-message"
import {
  CommentStore,
  ComposerStore,
  DEFAULT_PROMPT,
  PromptHistoryState,
  type TextPart,
  type ImageAttachmentPart,
  type FileAttachmentPart,
  type LineComment,
} from "./schema"

const text: TextPart = { type: "text", content: "hello", start: 0, end: 5 }
const image: Omit<ImageAttachmentPart, "blob"> = {
  type: "image",
  id: "image",
  filename: "image.png",
  mime: "image/png",
}
const comment = { id: "comment", path: "src/app.ts", selection: { start: 1, end: 2 }, comment: "note", time: 1 }
const decode = Schema.decodeUnknownSync(
  Persistence.withInitial(ComposerStore, { prompt: DEFAULT_PROMPT, context: { items: [] } }),
)

describe("composer persistence schemas", () => {
  test("defaults missing or invalid fields independently and normalizes the cursor", () => {
    expect(decode({})).toEqual({ prompt: DEFAULT_PROMPT, context: { items: [] } })
    const selection = { startLine: 1, startChar: 0, endLine: 2, endChar: 3 }
    const value = decode({
      prompt: [null, { type: "unknown" }],
      cursor: -1,
      mode: "unknown",
      model: { providerID: 42, modelID: "model" },
      retry: { id: "bad", agent: "build", providerID: "provider", modelID: "model" },
      context: {
        items: [
          { type: "file", path: "src/app.ts", commentID: "note", key: "stale" },
          null,
          { type: "file", path: "src/app.ts", selection, comment: "Check this", key: "untrusted" },
          { type: "file", path: 42 },
        ],
      },
    })
    expect(value.prompt).toEqual(DEFAULT_PROMPT)
    expect(value.cursor).toBe(0)
    expect(value.mode).toBeUndefined()
    expect(value.model).toBeUndefined()
    expect(value.retry).toBeUndefined()
    expect(value.context.items).toEqual([
      { type: "file", path: "src/app.ts", commentID: "note", key: "file:src/app.ts:undefined:undefined:c=note" },
      // A comment without an ID is keyed by a digest of its text.
      {
        type: "file",
        path: "src/app.ts",
        selection,
        comment: "Check this",
        key: expect.stringMatching(/^file:src\/app\.ts:1:2:c=/),
      },
    ])
    expect(decode({ prompt: false, cursor: Infinity, context: null })).toEqual({
      prompt: DEFAULT_PROMPT,
      context: { items: [] },
    })
    const first = decode({})
    first.prompt[0] = { type: "text", content: "changed", start: 0, end: 7 }
    expect(decode({}).prompt).toEqual(DEFAULT_PROMPT)
  })

  test("restores extension notes and legacy browser comments without their process-bound refs", () => {
    const durable = {
      type: "note" as const,
      origin: "example",
      label: "button#save",
      icon: "select-element",
      subject: 'the "button#save" element',
      href: "tab_00000000-0000-4000-8000-000000000000",
      comment: "Rename this",
      commentID: "note",
    }
    const note = {
      ...durable,
      live: { subject: 'the "button#save" element (browser ref @e42)', href: `${durable.href}#e42` },
    }
    // A draft stored by a build before extension notes, as its composer schema encoded it.
    const browser = {
      type: "browser" as const,
      tabID: "tab_00000000-0000-4000-8000-000000000000",
      url: "http://localhost:5173/",
      element: { ref: "e42", selector: "#save", label: "button#save", role: 42 },
      comment: "Rename this",
      commentID: "picked",
      key: "browser:tab_00000000-0000-4000-8000-000000000000:c=picked",
    }
    const value = decode({ context: { items: [note, { ...note, subject: null }, browser, { ...browser, url: null }] } })
    expect(value.context.items).toEqual([
      { ...durable, key: "note:example:c=note" },
      {
        type: "note",
        origin: "browser",
        label: "button#save",
        icon: "select-element",
        subject:
          'the "button#save" element in browser tab tab_00000000-0000-4000-8000-000000000000 at http://localhost:5173/ (selector "#save")',
        href: "tab_00000000-0000-4000-8000-000000000000",
        comment: "Rename this",
        commentID: "picked",
        key: "note:browser:c=picked",
      },
    ])
  })

  test("drops invalid parts without losing valid mentions or optional field recovery", () => {
    const value = decode({
      prompt: [
        text,
        { type: "agent", content: "@build", start: 5, end: 11, name: "build" },
        { type: "skill", content: "@effect", start: 11, end: 18, id: "effect", name: "Effect" },
        { type: "agent", content: "@broken", start: 18, end: 25, name: 42 },
        {
          type: "file",
          path: "src/app.ts",
          content: "@src/app.ts",
          start: 18,
          end: 29,
          selection: { startLine: "broken" },
          mime: 42,
          filename: "app.ts",
          source: { type: "invalid" },
        },
      ],
      model: { providerID: "provider", modelID: "model", variant: null },
      retry: { id: "msg_retry", agent: "build", providerID: "provider", modelID: "model", variant: false },
    })
    expect(value.prompt.map((part) => part.type)).toEqual(["text", "agent", "skill", "file"])
    expect(value.prompt[3]).toEqual({
      type: "file",
      path: "src/app.ts",
      content: "@src/app.ts",
      start: 18,
      end: 29,
      filename: "app.ts",
    })
    expect(value.model?.variant).toBeNull()
    expect(value.retry).toEqual({
      id: SessionMessage.ID.make("msg_retry"),
      agent: "build",
      providerID: "provider",
      modelID: "model",
    })
    expect(decode(Schema.encodeSync(ComposerStore)(value))).toEqual(value)
  })

  test("preserves file source variants through canonical round trips", () => {
    const sourceText = { value: "@source", start: 0, end: 7 }
    const sources: NonNullable<FileAttachmentPart["source"]>[] = [
      { type: "file", path: "src/app.ts", text: sourceText },
      { type: "resource", clientName: "docs", uri: "docs://example", text: sourceText },
      {
        type: "symbol",
        path: "src/app.ts",
        name: "App",
        kind: 1,
        range: { start: { line: 1, character: 0 }, end: { line: 2, character: 1 } },
        text: sourceText,
      },
    ]
    const value = decode({
      prompt: sources.map((source) => ({
        type: "file",
        path: "src/app.ts",
        content: "@source",
        start: 0,
        end: 7,
        source,
        selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 1 },
      })),
    })
    expect(value.prompt).toHaveLength(3)
    expect(value.prompt.map((part) => part.type === "file" && part.source)).toEqual(sources)
    expect(decode(Schema.encodeSync(ComposerStore)(value))).toEqual(value)
  })

  test("migrates inline images, keeps store references without a URL, and never encodes dataUrl", () => {
    const value = decode({
      prompt: [
        { ...image, dataUrl: "data:image/png;base64,YQ==", sourcePath: "/image.png" },
        { ...image, blob: { id: "data:image/png;base64,Yg==" } },
        { ...image, blob: { id: "hash", url: "blob:hydrated" } },
        { ...image, blob: { id: "missing" } },
        { ...image, blob: { id: "bad", url: "https://example.com/image.png" } },
        { ...image, blob: { id: "missing" }, dataUrl: "data:image/png;base64,YQ==" },
        { ...image, blob: { id: 42 } },
      ],
    })
    expect(value.prompt).toHaveLength(6)
    expect(value.prompt[0]).toEqual({
      ...image,
      sourcePath: "/image.png",
      blob: { id: "data:image/png;base64,YQ==", url: "data:image/png;base64,YQ==" },
    })
    // Bytes still in the draft store resolve on use; a non-blob URL is discarded in favour of the id.
    expect(value.prompt[3]).toEqual({ ...image, blob: { id: "missing", url: "" } })
    expect(value.prompt[4]).toEqual({ ...image, blob: { id: "bad", url: "" } })
    expect(value.prompt[5]).toEqual({ ...image, blob: { id: "missing", url: "" } })
    const encoded = Schema.encodeSync(ComposerStore)(value)
    expect(JSON.stringify(encoded)).not.toContain("dataUrl")
    expect(decode(encoded)).toEqual(value)
  })

  test("migrates legacy history arrays and recovers entries, parts, and comments independently", () => {
    const value = Schema.decodeUnknownSync(Persistence.withInitial(PromptHistoryState, { entries: [] }))({
      entries: [
        [text, null, { ...image, dataUrl: "data:image/png;base64,YQ==" }],
        null,
        {},
        { prompt: false, comments: [] },
        { prompt: [text, { type: "invalid" }], comments: [comment, { ...comment, selection: null }, false] },
        { prompt: [text], comments: false },
      ],
    })
    expect(value.entries).toHaveLength(3)
    expect(value.entries[0].prompt).toHaveLength(2)
    expect(value.entries[0].comments).toEqual([])
    expect(value.entries[1]).toEqual({ prompt: [text], comments: [comment] })
    expect(value.entries[2]).toEqual({ prompt: [text], comments: [] })
    const encoded = Schema.encodeSync(PromptHistoryState)(value)
    expect(encoded.entries?.every((entry) => !Array.isArray(entry))).toBe(true)
    expect(JSON.stringify(encoded)).not.toContain("dataUrl")
    expect(Schema.decodeUnknownSync(Persistence.withInitial(PromptHistoryState, { entries: [] }))(encoded)).toEqual(
      value,
    )
    expect(
      Schema.decodeUnknownSync(Persistence.withInitial(PromptHistoryState, { entries: [] }))({ entries: "invalid" }),
    ).toEqual({ entries: [] })
  })

  test("recovers comments per file and entry without discarding healthy siblings", () => {
    const line: LineComment = {
      id: "comment",
      file: "src/app.ts",
      selection: { start: 1, end: 2, side: "additions", endSide: "deletions" },
      comment: "note",
      time: 1,
    }
    const value = Schema.decodeUnknownSync(Persistence.withInitial(CommentStore, { comments: {} }))({
      comments: {
        "src/app.ts": [line, null, { ...line, time: "bad" }, { ...line, selection: { start: 2, end: 4, side: "bad" } }],
        "broken.ts": { invalid: true },
        "healthy.ts": [{ ...line, file: "healthy.ts" }],
      },
    })
    expect(value.comments["src/app.ts"]).toEqual([line, { ...line, selection: { start: 2, end: 4 } }])
    expect(value.comments["broken.ts"]).toEqual([])
    expect(value.comments["healthy.ts"]).toEqual([{ ...line, file: "healthy.ts" }])
    expect(
      Schema.decodeUnknownSync(Persistence.withInitial(CommentStore, { comments: {} }))(
        Schema.encodeSync(CommentStore)(value),
      ),
    ).toEqual(value)
    expect(Schema.decodeUnknownSync(Persistence.withInitial(CommentStore, { comments: {} }))({})).toEqual({
      comments: {},
    })
    expect(Schema.decodeUnknownSync(Persistence.withInitial(CommentStore, { comments: {} }))({ comments: [] })).toEqual(
      { comments: {} },
    )
  })
})

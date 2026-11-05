import { describe, expect, test } from "bun:test"
import type { Prompt } from "@opencode/schema"
import { projectedPromptInput, restoredPromptInput } from "../../src/prompt/codec"

describe("prompt codec", () => {
  test("converts projected URI and inline attachments without mutation", () => {
    const input = {
      text: "Review @note.ts and image.png with @scan",
      files: [
        {
          data: "",
          mime: "text/plain",
          source: { type: "uri", uri: "file:///tmp/note.ts" },
          name: "note.ts",
          mention: { start: 7, end: 15, text: "@note.ts" },
        },
        {
          data: "YWJj",
          mime: "image/png",
          source: { type: "inline" },
          name: "image.png",
          description: "screenshot",
        },
      ],
      agents: [{ name: "scan", mention: { start: 35, end: 40, text: "@scan" } }],
    } satisfies Prompt
    const before = structuredClone(input)

    const output = projectedPromptInput(input, true)

    expect(output).toEqual({
      text: input.text,
      files: [
        {
          uri: "file:///tmp/note.ts",
          name: "note.ts",
          description: undefined,
          mention: { start: 7, end: 15, text: "@note.ts" },
        },
        {
          uri: "data:image/png;base64,YWJj",
          name: "image.png",
          description: "screenshot",
          mention: undefined,
        },
      ],
      agents: [{ name: "scan", mention: { start: 35, end: 40, text: "@scan" } }],
    })
    expect(input).toEqual(before)
    expect(output.files?.[0]?.mention).not.toBe(input.files[0].mention)
    expect(output.agents?.[0]?.mention).not.toBe(input.agents[0].mention)
  })

  // A server-side `file:` source names a file only a local server's terminal can read again.
  test.each([
    { localServer: true, mention: "[Image 1]", uri: "file:///home/devbox/shot.png" },
    { localServer: false, mention: "[Image 1]", uri: `media:${"d".repeat(64)}` },
    { localServer: false, mention: "@shot.png", uri: "file:///home/devbox/shot.png" },
  ])("with localServer $localServer, a $mention file stored from a file source restores as $uri", (row) => {
    const file = {
      uri: `media:${"d".repeat(64)}`,
      mime: "image/png",
      source: { type: "uri", uri: "file:///home/devbox/shot.png" },
      mention: { start: 0, end: row.mention.length, text: row.mention },
    } as const
    expect(projectedPromptInput({ text: row.mention, files: [file] }, row.localServer).files?.[0]?.uri).toBe(row.uri)
  })

  test("retains empty attachment keys for editable prompt replacement", () => {
    expect(projectedPromptInput({ text: "plain" }, true)).toEqual({
      text: "plain",
      files: undefined,
      agents: undefined,
    })
  })
})

describe("restored prompt input", () => {
  const hash = "c".repeat(64)
  const message = {
    text: "Compare [Image 1] with [Image 2]",
    files: [
      {
        uri: `media:${hash}`,
        mime: "image/png",
        source: { type: "inline" },
        name: "stored.png",
        mention: { start: 8, end: 17, text: "[Image 1]" },
      },
      {
        data: "YWJj",
        mime: "image/jpeg",
        source: { type: "inline" },
        name: "inline.jpg",
        mention: { start: 23, end: 32, text: "[Image 2]" },
      },
    ],
  } satisfies Parameters<typeof restoredPromptInput>[0]

  test("keeps media refs as refs in the synchronous projection", () => {
    expect(projectedPromptInput(message, true).files?.map((file) => file.uri)).toEqual([
      `media:${hash}`,
      "data:image/jpeg;base64,YWJj",
    ])
  })

  test("reads media refs back into data URIs and leaves inline files alone", async () => {
    const reads: string[] = []
    const output = await restoredPromptInput(
      message,
      async (uri) => {
        reads.push(uri)
        return new Uint8Array([137, 80, 78, 71])
      },
      true,
    )

    expect(reads).toEqual([`media:${hash}`])
    expect(output).toEqual({
      ...projectedPromptInput(message, true),
      files: [
        {
          uri: `data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString("base64")}`,
          name: "stored.png",
          description: undefined,
          mention: { start: 8, end: 17, text: "[Image 1]" },
        },
        {
          uri: "data:image/jpeg;base64,YWJj",
          name: "inline.jpg",
          description: undefined,
          mention: { start: 23, end: 32, text: "[Image 2]" },
        },
      ],
    })
  })

  test("reads nothing for a prompt without media refs", async () => {
    const inline = { ...message, files: [message.files[1]] }
    const output = await restoredPromptInput(inline, () => Promise.reject(new Error("unexpected read")), true)

    expect(output).toEqual(projectedPromptInput(inline, true))
  })

  test("rejects when a media ref cannot be read, so callers keep the server copy", async () => {
    await expect(restoredPromptInput(message, () => Promise.reject(new Error("offline")), true)).rejects.toThrow(
      "offline",
    )
  })

  test("leaves out a file whose read resolves undefined", async () => {
    const output = await restoredPromptInput(message, async () => undefined, true)

    expect(output.text).toBe(message.text)
    expect(output.files?.map((file) => file.uri)).toEqual(["data:image/jpeg;base64,YWJj"])
  })
})

import { expect, test } from "bun:test"
import {
  createClipboard,
  type ClipboardReadOptions,
  type ClipboardReadResult,
  type ClipboardService as CoreClipboardService,
  type ClipboardWriteOptions,
  type ClipboardWriteResult,
  type HostClipboardService,
} from "@opentui/core"
import { createClipboardAdapter } from "../src/clipboard"

function coreClipboard(options: {
  read?: ClipboardReadResult
  write?: ClipboardWriteResult
  onRead?: (input: ClipboardReadOptions) => void
  onWrite?: (text: string, input: ClipboardWriteOptions) => void
}): CoreClipboardService {
  return {
    async read(input) {
      options.onRead?.(input)
      return options.read ?? { status: "empty" }
    },
    async writeText(text, input) {
      options.onWrite?.(text, input)
      return (
        options.write ?? {
          host: { status: "written" },
          terminal: { status: "not-attempted", capability: "unknown" },
        }
      )
    },
    async clear() {
      return {
        host: { status: "cleared" },
        terminal: { status: "not-attempted", capability: "unknown" },
      }
    },
    async dispose() {},
  }
}

test("adapts OpenTUI image and text reads", async () => {
  const requests: ClipboardReadOptions[] = []
  const image = createClipboardAdapter(
    coreClipboard({
      read: {
        status: "read",
        representation: { mimeType: "image/png", bytes: new Uint8Array([0, 1, 2, 255]) },
      },
      onRead: (input) => requests.push(input),
    }),
  )
  const text = "line 1\r\n\t世界"
  const plain = createClipboardAdapter(
    coreClipboard({
      read: {
        status: "read",
        representation: { mimeType: "text/plain", bytes: new TextEncoder().encode(text) },
      },
    }),
  )

  expect(await image.read()).toEqual({ data: "AAEC/w==", mime: "image/png" })
  expect(await plain.read()).toEqual({ data: text, mime: "text/plain" })
  expect(requests).toEqual([{ preferredTypes: ["image/png", "text/plain"], selection: "clipboard" }])
})

test("uses all available routes but skips the process host remotely", async () => {
  const writes = { host: 0, terminal: 0 }
  const host: HostClipboardService = {
    maxWriteBytes: 8 * 1024 * 1024,
    async read() {
      return { status: "empty" }
    },
    async writeText() {
      writes.host++
      return { status: "written" }
    },
    async clear() {
      return { status: "cleared" }
    },
    async dispose() {},
  }
  const clipboard = createClipboardAdapter(
    createClipboard({
      host,
      terminal: {
        remote: true,
        writeText() {
          writes.terminal++
          return { status: "attempted", capability: "supported" }
        },
        clear() {
          return { status: "attempted", capability: "supported" }
        },
      },
    }),
  )

  expect(await clipboard.write("hello")).toBeUndefined()
  expect(writes).toEqual({ host: 0, terminal: 1 })
})

test("removes NUL characters before writing", async () => {
  const writes: string[] = []
  const clipboard = createClipboardAdapter(
    coreClipboard({
      onWrite: (text) => writes.push(text),
    }),
  )

  expect(await clipboard.write("before\0after")).toBeUndefined()
  expect(await clipboard.write("clean")).toBeUndefined()
  expect(writes).toEqual(["beforeafter", "clean"])
})

test("rejects only when no clipboard route accepted the write", async () => {
  const writes: [string, ClipboardWriteOptions][] = []
  const failure = new Error("native clipboard failed")
  const fallback = createClipboardAdapter(
    coreClipboard({
      write: {
        host: { status: "written" },
        terminal: { status: "local-failure", capability: "supported" },
      },
    }),
  )
  const clipboard = createClipboardAdapter(
    coreClipboard({
      write: {
        host: { status: "failed", error: failure },
        terminal: { status: "local-failure", capability: "supported" },
      },
      onWrite: (text, input) => writes.push([text, input]),
    }),
  )

  expect(await fallback.write("hello")).toBeUndefined()
  expect(await clipboard.write("hello").then(undefined, (error) => error)).toBe(failure)
  expect(writes).toEqual([["hello", { destination: "all-available", selection: "clipboard" }]])
})

test("routes reads to the configured selection", async () => {
  const requests: ClipboardReadOptions[] = []
  const primary = createClipboardAdapter(
    coreClipboard({
      read: {
        status: "read",
        representation: { mimeType: "text/plain", bytes: new TextEncoder().encode("middle") },
      },
      onRead: (input) => requests.push(input),
    }),
    "primary",
  )
  const both = createClipboardAdapter(
    coreClipboard({
      read: {
        status: "read",
        representation: { mimeType: "text/plain", bytes: new TextEncoder().encode("both") },
      },
      onRead: (input) => requests.push(input),
    }),
    "both",
  )

  expect(await primary.read()).toEqual({ data: "middle", mime: "text/plain" })
  expect(await both.read()).toEqual({ data: "both", mime: "text/plain" })
  expect(requests).toEqual([
    { preferredTypes: ["image/png", "text/plain"], selection: "primary" },
    { preferredTypes: ["image/png", "text/plain"], selection: "clipboard" },
  ])
})

test("writes both selections when configured", async () => {
  const writes: [string, ClipboardWriteOptions][] = []
  const both = createClipboardAdapter(
    coreClipboard({
      onWrite: (text, input) => writes.push([text, input]),
    }),
    "both",
  )

  expect(await both.write("hello")).toBeUndefined()
  expect(writes).toEqual([
    ["hello", { destination: "all-available", selection: "clipboard" }],
    ["hello", { destination: "all-available", selection: "primary" }],
  ])
})

test("succeeds when at least one selection accepts the write", async () => {
  const writes: [string, ClipboardWriteOptions["selection"] | undefined][] = []
  const both = createClipboardAdapter(
    {
      async read() {
        return { status: "empty" }
      },
      async writeText(text, input) {
        writes.push([text, input?.selection])
        return input?.selection === "primary"
          ? {
              host: { status: "unsupported" },
              terminal: { status: "not-attempted", capability: "unknown" },
            }
          : {
              host: { status: "written" },
              terminal: { status: "not-attempted", capability: "unknown" },
            }
      },
      async clear() {
        return {
          host: { status: "cleared" },
          terminal: { status: "not-attempted", capability: "unknown" },
        }
      },
      async dispose() {},
    },
    "both",
  )

  expect(await both.write("hello")).toBeUndefined()
  expect(writes).toEqual([
    ["hello", "clipboard"],
    ["hello", "primary"],
  ])
})

import { afterEach, describe, expect, test } from "bun:test"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import { createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { isServer } from "solid-js/web"
import { createReviewEditor } from "./editor"

const disposers: Array<() => void> = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))

const diff = {
  file: "src/file.ts",
  patch: "@@ -2 +2 @@\n-old\n+new",
  additions: 1,
  deletions: 1,
  status: "modified",
} satisfies FileDiffInfo

const utf8 = (text: string) => new TextEncoder().encode(text)

function setup(input: Partial<Pick<Parameters<typeof createReviewEditor>[0], "read" | "write">> = {}) {
  return createRoot((dispose) => {
    disposers.push(dispose)
    const [state, setState] = createStore({ directory: "/repo" })
    const files = new Map<string, Uint8Array>()
    const reads: Array<{ directory: string; path: string }> = []
    const writes: Array<{ directory: string; path: string; content: Uint8Array; expected: Uint8Array }> = []
    const saved: Array<{ directory: string; path: string }> = []
    files.set(JSON.stringify(["/repo", diff.file]), utf8("before\nnew\nafter\n"))
    const editor = createReviewEditor({
      directory: () => state.directory,
      read: async (directory, path) => {
        reads.push({ directory, path })
        if (input.read) return input.read(directory, path)
        const bytes = files.get(JSON.stringify([directory, path]))
        if (!bytes) throw new Error("Missing file")
        return bytes.slice()
      },
      write: async (directory, path, content, expected) => {
        writes.push({ directory, path, content, expected })
        if (input.write) await input.write(directory, path, content, expected)
        const key = JSON.stringify([directory, path])
        const current = files.get(key)
        if (
          !current ||
          current.length !== expected.length ||
          !current.every((byte, index) => byte === expected[index])
        ) {
          throw { _tag: "FileSystemWriteConflictError", path, message: "File changed" }
        }
        files.set(key, content.slice())
      },
      onSaved: (directory, path) => saved.push({ directory, path }),
    })
    return {
      editor,
      // Browser runs also verify reactivity; the default unit command uses Solid's server build.
      pending: isServer ? () => editor.pending() : createMemo(() => editor.pending()),
      diffs: isServer ? () => editor.diffs() : createMemo(() => editor.diffs()),
      reads,
      writes,
      saved,
      setDirectory: (directory: string) => setState("directory", directory),
      put: (contents: Uint8Array, directory = "/repo", path = diff.file) =>
        files.set(JSON.stringify([directory, path]), contents),
      bytes: (directory = "/repo", path = diff.file) => files.get(JSON.stringify([directory, path])),
    }
  })
}

describe("review editor", () => {
  test("loads full file bytes, not the diff patch, and keeps a diff snapshot", async () => {
    const ctx = setup()
    const snapshot = { ...diff }
    const opening = ctx.editor.open(snapshot)
    expect(ctx.editor.get(diff.file)).toMatchObject({ loading: true, loaded: false, contents: "" })
    expect(ctx.pending()).toBe(false)
    await opening

    snapshot.patch = "changed outside the editor"
    expect(ctx.editor.get(diff.file)).toMatchObject({
      diff,
      original: "before\nnew\nafter\n",
      contents: "before\nnew\nafter\n",
      loading: false,
      loaded: true,
      saving: false,
    })
    expect(ctx.reads).toEqual([{ directory: "/repo", path: diff.file }])
    expect(ctx.diffs()).toEqual([diff])
    ctx.editor.change(diff.file, "edited\n")
    expect(ctx.pending()).toBe(true)
    expect(ctx.diffs()).toEqual([diff])
    ctx.editor.discard(diff.file)
    expect(ctx.pending()).toBe(false)
    expect(ctx.diffs()).toEqual([])
  })

  test.each([
    { name: "UTF-8 LF", original: "caf\u00e9\nold\n", edited: "caf\u00e9\nnew\n", saved: "caf\u00e9\nnew\n" },
    {
      name: "UTF-8 BOM CRLF",
      original: "\ufeffold\r\nline\r\n",
      edited: "new\nline\n",
      saved: "\ufeffnew\r\nline\r\n",
    },
    { name: "CRLF", original: "old\r\nline", edited: "new\nline", saved: "new\r\nline" },
    { name: "BOM only", original: "\ufeff", edited: "new", saved: "\ufeffnew" },
    { name: "empty file", original: "", edited: "new\n", saved: "new\n" },
    { name: "CR", original: "old\rline\r", edited: "new\nline\n", saved: "new\rline\r" },
  ])("preserves $name when saving normalized text", async (value) => {
    const ctx = setup()
    ctx.put(utf8(value.original))
    await ctx.editor.open(diff)
    expect(ctx.editor.get(diff.file)?.contents).toBe(value.original.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n"))
    ctx.editor.change(diff.file, value.edited)
    await ctx.editor.save(diff.file)

    expect(ctx.writes[0]?.expected).toEqual(utf8(value.original))
    expect(ctx.bytes()).toEqual(utf8(value.saved))
    expect(ctx.saved).toEqual([{ directory: "/repo", path: diff.file }])
    expect(ctx.editor.get(diff.file)).toBeUndefined()
    expect(ctx.pending()).toBe(false)
  })

  test.each([
    { name: "NUL", bytes: utf8("before\0after") },
    { name: "invalid UTF-8", bytes: new Uint8Array([0xc3, 0x28]) },
    { name: "incomplete UTF-8", bytes: new Uint8Array([0xe2, 0x82]) },
  ])("rejects $name without allowing a write", async (value) => {
    const ctx = setup()
    ctx.put(value.bytes)
    await ctx.editor.open(diff)
    expect(ctx.editor.get(diff.file)).toMatchObject({ loading: false, loaded: false, error: "unsupported" })
    ctx.editor.change(diff.file, "replacement")
    await ctx.editor.save(diff.file)
    expect(ctx.writes).toEqual([])
    expect(ctx.pending()).toBe(false)
    expect(ctx.bytes()).toEqual(value.bytes)
  })

  test("retains load errors and can reopen after discard", async () => {
    const ctx = setup()
    const missing = { ...diff, file: "missing.ts" }
    await ctx.editor.open(missing)
    expect(ctx.editor.get(missing.file)).toMatchObject({ loaded: false, loading: false, error: "load" })
    await ctx.editor.save(missing.file)
    expect(ctx.writes).toEqual([])
    ctx.editor.discard(missing.file)
    ctx.put(utf8("available"), "/repo", missing.file)
    await ctx.editor.open(missing)
    expect(ctx.editor.get(missing.file)).toMatchObject({ loaded: true, contents: "available" })
    expect(ctx.editor.get(missing.file)?.error).toBeUndefined()
  })

  test("retains failed saves and retries against the original bytes", async () => {
    const failure = { active: true }
    const ctx = setup({
      write: async () => {
        if (failure.active) throw new Error("Write failed")
      },
    })
    await ctx.editor.open(diff)
    ctx.editor.change(diff.file, "edited\n")
    await ctx.editor.save(diff.file)
    ctx.editor.ready(diff.file)
    expect(ctx.editor.get(diff.file)).toMatchObject({
      original: "before\nnew\nafter\n",
      contents: "edited\n",
      saving: false,
      error: "save",
    })
    expect(ctx.pending()).toBe(true)
    expect(ctx.saved).toEqual([])
    failure.active = false
    await ctx.editor.save(diff.file)
    expect(ctx.bytes()).toEqual(utf8("edited\n"))
    expect(ctx.writes[1]?.expected).toEqual(ctx.writes[0]?.expected)
    expect(ctx.editor.get(diff.file)).toBeUndefined()
  })

  test("retains a conflicted draft without replacing external changes", async () => {
    const ctx = setup()
    await ctx.editor.open(diff)
    ctx.editor.change(diff.file, "my edits")
    ctx.put(utf8("external edits"))
    await ctx.editor.save(diff.file)
    ctx.editor.ready(diff.file)
    expect(ctx.editor.get(diff.file)).toMatchObject({ error: "conflict", contents: "my edits", saving: false })
    expect(ctx.bytes()).toEqual(utf8("external edits"))
    expect(ctx.saved).toEqual([])
    expect(ctx.pending()).toBe(true)
    await ctx.editor.save(diff.file)
    expect(ctx.editor.get(diff.file)?.error).toBe("conflict")
    ctx.editor.discard(diff.file)
    await ctx.editor.open(diff)
    expect(ctx.editor.get(diff.file)?.original).toBe("external edits")
  })

  test("keeps A-B-A navigation scoped while tracking all unsaved drafts", async () => {
    const ctx = setup()
    await ctx.editor.open(diff)
    ctx.editor.change(diff.file, "A edits")
    ctx.setDirectory("/other")
    expect(ctx.editor.get(diff.file)).toBeUndefined()
    expect(ctx.diffs()).toEqual([])
    expect(ctx.pending()).toBe(true)
    ctx.put(utf8("B original"), "/other")
    await ctx.editor.open(diff)
    ctx.editor.change(diff.file, "B edits")
    ctx.setDirectory("/repo")
    expect(ctx.editor.get(diff.file)?.contents).toBe("A edits")
    await ctx.editor.save(diff.file)
    expect(ctx.bytes()).toEqual(utf8("A edits"))
    expect(ctx.bytes("/other")).toEqual(utf8("B original"))
    expect(ctx.pending()).toBe(true)
    ctx.setDirectory("/other")
    expect(ctx.editor.get(diff.file)?.contents).toBe("B edits")
    ctx.editor.discard(diff.file)
    expect(ctx.pending()).toBe(false)
  })

  test("keeps in-flight reads and writes attached to their starting directory", async () => {
    const reading = Promise.withResolvers<Uint8Array>()
    const writing = Promise.withResolvers<void>()
    const ctx = setup({ read: () => reading.promise, write: () => writing.promise })
    const opening = ctx.editor.open(diff)
    ctx.setDirectory("/other")
    reading.resolve(utf8("before\nnew\nafter\n"))
    await opening
    expect(ctx.editor.get(diff.file)).toBeUndefined()
    ctx.setDirectory("/repo")
    ctx.editor.change(diff.file, "A edits")
    const saving = ctx.editor.save(diff.file)
    ctx.setDirectory("/other")
    expect(ctx.pending()).toBe(true)
    writing.resolve()
    await saving
    expect(ctx.saved).toEqual([{ directory: "/repo", path: diff.file }])
    expect(ctx.writes[0]?.directory).toBe("/repo")
    expect(ctx.bytes()).toEqual(utf8("A edits"))
    expect(ctx.diffs()).toEqual([])
    ctx.setDirectory("/repo")
    expect(ctx.editor.get(diff.file)).toBeUndefined()
  })

  test("ignores duplicate opens and saves and cannot discard a saving draft", async () => {
    const reading = Promise.withResolvers<Uint8Array>()
    const writing = Promise.withResolvers<void>()
    const ctx = setup({ read: () => reading.promise, write: () => writing.promise })
    const opening = ctx.editor.open(diff)
    await ctx.editor.open({ ...diff, patch: "duplicate" })
    ctx.editor.change(diff.file, "ignored before loading")
    await ctx.editor.save(diff.file)
    expect(ctx.reads).toHaveLength(1)
    expect(ctx.writes).toHaveLength(0)
    reading.resolve(utf8("before\nnew\nafter\n"))
    await opening
    ctx.editor.change(diff.file, "edited")
    await ctx.editor.open(diff)
    expect(ctx.editor.get(diff.file)?.contents).toBe("edited")
    expect(ctx.reads).toHaveLength(1)
    const saving = ctx.editor.save(diff.file)
    await ctx.editor.save(diff.file)
    ctx.editor.discard(diff.file)
    expect(ctx.editor.get(diff.file)).toMatchObject({ saving: true, contents: "edited" })
    expect(ctx.writes).toHaveLength(1)
    writing.resolve()
    await saving
    expect(ctx.saved).toHaveLength(1)
    expect(ctx.editor.get(diff.file)).toBeUndefined()
  })

  test.each([false, true])("ignores a discarded stale load, including rejection=%s", async (reject) => {
    const first = Promise.withResolvers<Uint8Array>()
    const second = Promise.withResolvers<Uint8Array>()
    const requests = [first.promise, second.promise]
    const ctx = setup({ read: () => requests.shift()! })
    const stale = ctx.editor.open(diff)
    ctx.editor.discard(diff.file)
    expect(ctx.editor.get(diff.file)).toBeUndefined()
    const current = ctx.editor.open(diff)
    second.resolve(utf8("current"))
    await current
    ctx.editor.change(diff.file, "current edits")
    reject ? first.reject(new Error("Stale failure")) : first.resolve(utf8("stale"))
    await stale
    expect(ctx.editor.get(diff.file)).toMatchObject({ original: "current", contents: "current edits", loaded: true })
    expect(ctx.editor.get(diff.file)?.error).toBeUndefined()
  })

  test("retains typing during save and uses the saved bytes as the next baseline", async () => {
    const writing = Promise.withResolvers<void>()
    const ctx = setup({ write: () => writing.promise })
    ctx.put(utf8("\ufefforiginal\r\n"))
    await ctx.editor.open(diff)
    ctx.editor.change(diff.file, "first\n")
    const saving = ctx.editor.save(diff.file)
    ctx.editor.change(diff.file, "second\n")
    writing.resolve()
    await saving
    expect(ctx.bytes()).toEqual(utf8("\ufefffirst\r\n"))
    expect(ctx.editor.get(diff.file)).toMatchObject({ original: "first\n", contents: "second\n", saving: false })
    expect(ctx.pending()).toBe(true)
    await ctx.editor.save(diff.file)
    expect(ctx.writes[1]?.expected).toEqual(utf8("\ufefffirst\r\n"))
    expect(ctx.bytes()).toEqual(utf8("\ufeffsecond\r\n"))
    expect(ctx.saved).toHaveLength(2)
    expect(ctx.pending()).toBe(false)
  })

  test("stays pending when text is reverted during a save", async () => {
    const writing = Promise.withResolvers<void>()
    const ctx = setup({ write: () => writing.promise })
    await ctx.editor.open(diff)
    ctx.editor.change(diff.file, "edited")
    const saving = ctx.editor.save(diff.file)
    ctx.editor.change(diff.file, "before\nnew\nafter\n")
    expect(ctx.pending()).toBe(true)
    writing.resolve()
    await saving
    expect(ctx.pending()).toBe(true)
    expect(ctx.editor.get(diff.file)).toMatchObject({ original: "edited", contents: "before\nnew\nafter\n" })
    await ctx.editor.save(diff.file)
    expect(ctx.bytes()).toEqual(utf8("before\nnew\nafter\n"))
  })

  test("retains editor failures and does not write clean or missing drafts", async () => {
    const ctx = setup()
    ctx.editor.change(diff.file, "missing")
    ctx.editor.fail(diff.file)
    await ctx.editor.save(diff.file)
    expect(ctx.editor.get(diff.file)).toBeUndefined()
    await ctx.editor.open(diff)
    await ctx.editor.save(diff.file)
    expect(ctx.writes).toHaveLength(0)
    ctx.editor.change(diff.file, "unsaved")
    ctx.editor.fail(diff.file)
    expect(ctx.editor.get(diff.file)).toMatchObject({ error: "editor", contents: "unsaved" })
    await ctx.editor.save(diff.file)
    expect(ctx.writes).toHaveLength(0)
    expect(ctx.pending()).toBe(true)
    ctx.editor.ready(diff.file)
    expect(ctx.editor.get(diff.file)?.error).toBeUndefined()
    expect(ctx.editor.get(diff.file)?.contents).toBe("unsaved")
    ctx.editor.discard(diff.file)
    expect(ctx.pending()).toBe(false)
  })

  test("handles prototype names and directory-path tuple collisions", async () => {
    const ctx = setup()
    ctx.put(utf8("prototype"), "/repo", "__proto__")
    await ctx.editor.open({ ...diff, file: "__proto__" })
    ctx.editor.change("__proto__", "safe")
    await ctx.editor.save("__proto__")
    expect(ctx.bytes("/repo", "__proto__")).toEqual(utf8("safe"))

    ctx.setDirectory("/repo")
    ctx.put(utf8("first"), "/repo", "nested/file")
    await ctx.editor.open({ ...diff, file: "nested/file" })
    ctx.editor.change("nested/file", "first edits")
    ctx.setDirectory("/repo/nested")
    ctx.put(utf8("second"), "/repo/nested", "file")
    await ctx.editor.open({ ...diff, file: "file" })
    expect(ctx.editor.get("file")?.contents).toBe("second")
    ctx.setDirectory("/repo")
    expect(ctx.editor.get("nested/file")?.contents).toBe("first edits")
  })
})

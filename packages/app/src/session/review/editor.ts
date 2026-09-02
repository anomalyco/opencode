import { isFileSystemWriteConflictError, type FileDiffInfo } from "@opencode-ai/client/promise"
import type { Accessor } from "solid-js"
import { createStore } from "solid-js/store"

export type ReviewEditorError = "load" | "save" | "conflict" | "unsupported" | "editor"

export type Draft = {
  diff: FileDiffInfo
  original: string
  contents: string
  loading: boolean
  saving: boolean
  error?: ReviewEditorError
  loaded: boolean
}

export function createReviewEditor(input: {
  directory: Accessor<string>
  read: (directory: string, path: string) => Promise<Uint8Array>
  write: (directory: string, path: string, content: Uint8Array, expected: Uint8Array) => Promise<unknown>
  onSaved: (directory: string, path: string) => void
}) {
  const [drafts, setDrafts] = createStore<
    Record<string, (Draft & { directory: string; source?: ReturnType<typeof decode> }) | undefined>
  >({})

  return {
    get(path: string): Draft | undefined {
      return drafts[JSON.stringify([input.directory(), path])]
    },
    async open(diff: FileDiffInfo): Promise<void> {
      const directory = input.directory()
      const key = JSON.stringify([directory, diff.file])
      if (drafts[key]) return
      setDrafts(key, {
        directory,
        diff: { ...diff },
        original: "",
        contents: "",
        loading: true,
        saving: false,
        loaded: false,
      })
      const draft = drafts[key]
      try {
        const bytes = await input.read(directory, diff.file)
        if (drafts[key] !== draft) return
        const source = decode(bytes)
        if (!source) {
          setDrafts(key, { loading: false, error: "unsupported" })
          return
        }
        setDrafts(key, {
          source,
          original: source.contents,
          contents: source.contents,
          loading: false,
          loaded: true,
        })
      } catch {
        if (drafts[key] !== draft) return
        setDrafts(key, { loading: false, error: "load" })
      }
    },
    change(path: string, contents: string): void {
      const key = JSON.stringify([input.directory(), path])
      const draft = drafts[key]
      if (!draft?.loaded) return
      setDrafts(key, { contents, error: undefined })
    },
    async save(path: string): Promise<void> {
      const directory = input.directory()
      const key = JSON.stringify([directory, path])
      const draft = drafts[key]
      if (!draft?.loaded || draft.saving || !draft.source || draft.error === "editor") return
      if (draft.contents === draft.original) return
      const contents = draft.contents
      const bytes = encode(contents, draft.source)
      setDrafts(key, { saving: true, error: undefined })
      try {
        await input.write(directory, path, bytes, draft.source.bytes)
      } catch (error) {
        setDrafts(key, { saving: false, error: isFileSystemWriteConflictError(error) ? "conflict" : "save" })
        return
      }
      // Edits made during the write now compare against the bytes that reached disk.
      setDrafts(
        key,
        draft.contents === contents
          ? undefined
          : { original: contents, saving: false, source: { ...draft.source, bytes, contents } },
      )
      input.onSaved(directory, path)
    },
    discard(path: string): void {
      const key = JSON.stringify([input.directory(), path])
      if (drafts[key]?.saving) return
      setDrafts(key, undefined)
    },
    fail(path: string): void {
      const key = JSON.stringify([input.directory(), path])
      if (!drafts[key]) return
      setDrafts(key, "error", "editor")
    },
    ready(path: string): void {
      const key = JSON.stringify([input.directory(), path])
      if (drafts[key]?.error === "editor") setDrafts(key, "error", undefined)
    },
    pending(): boolean {
      return Object.values(drafts).some((draft) => draft && (draft.saving || draft.contents !== draft.original))
    },
    diffs(): FileDiffInfo[] {
      const directory = input.directory()
      return Object.values(drafts).flatMap((draft) => (draft?.directory === directory ? [draft.diff] : []))
    },
  }
}

function decode(bytes: Uint8Array) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    if (text.includes("\0")) return undefined
    return {
      bytes,
      contents: text.replace(/\r\n?/g, "\n"),
      bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      eol: text.match(/\r\n|\r|\n/)?.[0] ?? "\n",
    }
  } catch {
    return undefined
  }
}

function encode(contents: string, source: { bom: boolean; eol: string }) {
  return new TextEncoder().encode((source.bom ? "\ufeff" : "") + contents.replace(/\n/g, source.eol))
}

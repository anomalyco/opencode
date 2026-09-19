import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createBlobReference } from "@/runtime/persistence/drafts"
import { uuid } from "@/runtime/persistence/uuid"
import type { ComposerPrompt } from "../types"
import type { ImageAttachmentPart, PathAttachmentPart } from "../state"
import type { AttachmentDestination } from "./destination"
import { uploads } from "./uploads"

type PromptTarget = {
  current: () => ComposerPrompt
  cursor: () => number | undefined
  set: (prompt: ComposerPrompt, cursor?: number) => void
}

export type ComposerAttachmentConfig = {
  picker?: (
    options: { defaultPath?: string; multiple?: boolean; accept?: string[] },
    onFile: (file: File) => Promise<unknown>,
  ) => Promise<void>
  directory: () => string
  destination: () => AttachmentDestination
  isDialogActive: () => boolean
  duplicate: () => void
  onError: (error: unknown) => void
  onUploadError: (error: unknown) => void
  readClipboardImage?: () => Promise<File | null>
  getPathForFile?: (file: File) => string
  onDragCancel?: (callback: () => void) => () => void
  store?: (file: File) => Promise<{ id: string; url: string }>
}

export function createComposerAttachments(
  input: ComposerAttachmentConfig & {
    capture: () => PromptTarget
    editor: () => HTMLElement | undefined
    focusEditor: () => void
    addPart: (part: ComposerPrompt[number]) => boolean
    setDraggingType: (type: "image" | "@mention" | null) => void
  },
) {
  const clearDrag = () => {
    input.setDraggingType(null)
  }
  const capture = () => {
    const prompt = input.capture()
    const editor = input.editor()
    if (!editor) return
    return { prompt, cursor: prompt.cursor() ?? cursorPosition(editor) }
  }
  // Uploads this composer started; they finish (or fail) even if the composer unmounts.
  const [pending, setPending] = createStore<{ ids: string[] }>({ ids: [] })

  // Media the model reads natively travels inline with the prompt, so its bytes live in the draft
  // store. Everything else, including text, reaches the model as a path on the server that its
  // tools open; those bytes never enter the store, and never get base64-encoded into the request.
  const add = async (file: File, target = capture(), clipboard = false) => {
    if (!target) return false
    const mime = await attachmentMime(file)
    const destination = input.destination()
    if (native(mime, destination.input) && file.size <= MAX_INLINE_BYTES) return addInline(file, mime, target, clipboard)
    const sourcePath = input.getPathForFile?.(file) || undefined
    if (destination.local && sourcePath) return addPath(target, { filename: file.name, mime, path: sourcePath })
    void stage(file, mime, target, destination)
    return true
  }
  const addInline = async (file: File, mime: string, target: NonNullable<ReturnType<typeof capture>>, clipboard: boolean) => {
    const blob = input.store ? await input.store(file) : await createBlobReference(file)
    const sourcePath = input.getPathForFile?.(file) || undefined
    // Native clipboard images arrive with a fresh timestamped filename on every paste, so identical
    // clipboard content is matched on bytes alone.
    const duplicate = target.prompt
      .current()
      .some(
        (part) =>
          part.type === "image" &&
          part.blob.id === blob.id &&
          (sourcePath
            ? part.sourcePath === sourcePath
            : !part.sourcePath && (clipboard || part.filename === file.name)),
      )
    if (duplicate) {
      input.duplicate()
      return true
    }
    const attachment: ImageAttachmentPart = { type: "image", id: uuid(), filename: file.name, sourcePath, mime, blob }
    target.prompt.set([...target.prompt.current(), attachment], target.cursor)
    return true
  }
  const addPath = (
    target: NonNullable<ReturnType<typeof capture>>,
    attachment: Pick<PathAttachmentPart, "filename" | "mime" | "path">,
  ) => {
    if (target.prompt.current().some((part) => part.type === "path" && part.path === attachment.path)) {
      input.duplicate()
      return true
    }
    target.prompt.set([...target.prompt.current(), { type: "path", id: uuid(), ...attachment }], target.prompt.cursor())
    return true
  }
  const stage = async (
    file: File,
    mime: string,
    target: NonNullable<ReturnType<typeof capture>>,
    destination: AttachmentDestination,
  ) => {
    const id = uuid()
    setPending("ids", (ids) => [...ids, id])
    const path = await uploads
      .track({ id, filename: file.name, mime, size: file.size }, (report, signal) =>
        destination.upload(file, report, signal),
      )
      .catch((error: unknown) => {
        input.onUploadError(error)
        return undefined
      })
      .finally(() => setPending("ids", (ids) => ids.filter((item) => item !== id)))
    if (path) addPath(target, { filename: file.name, mime, path })
  }
  const addAttachments = async (files: File[], target = capture()) => {
    return files.reduce(async (result, file) => {
      const previous = await result
      return (await add(file, target)) || previous
    }, Promise.resolve(false))
  }
  const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return
    const target = capture()
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    const files = Array.from(clipboardData.items).flatMap((item) => {
      if (item.kind !== "file") return []
      const file = item.getAsFile()
      return file ? [file] : []
    })
    if (files.length > 0) {
      await addAttachments(files, target)
      return
    }
    const plainText = clipboardData.getData("text/plain") ?? ""
    if (input.readClipboardImage && !plainText) {
      const file = await input.readClipboardImage()
      if (file && (await add(file, target, true))) return
    }
    if (!plainText) return
    const text = plainText.includes("\r") ? plainText.replace(/\r\n?/g, "\n") : plainText
    const put = () => {
      if (input.addPart({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor()
      return input.addPart({ type: "text", content: text, start: 0, end: 0 })
    }
    if (text.includes("\n") || largePaste(text)) {
      put()
      return
    }
    if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return
    put()
  }
  const handleDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return
    event.preventDefault()
    clearDrag()
    const plainText = event.dataTransfer?.getData("text/plain")
    if (plainText?.startsWith("file:")) {
      const path = plainText.slice("file:".length)
      input.focusEditor()
      input.addPart({ type: "file", path, content: `@${path}`, start: 0, end: 0 })
      return
    }
    const files = event.dataTransfer?.files
    if (files) await addAttachments(Array.from(files))
  }

  onMount(() => {
    const cancel = input.onDragCancel?.(clearDrag)
    if (cancel) onCleanup(cancel)
    makeEventListener(document, "dragover", (event) => {
      if (input.isDialogActive()) return
      event.preventDefault()
      if (event.dataTransfer?.types.includes("Files")) input.setDraggingType("image")
      else if (event.dataTransfer?.types.includes("text/plain")) input.setDraggingType("@mention")
    })
    makeEventListener(document, "dragleave", (event) => {
      if (!input.isDialogActive() && !event.relatedTarget) clearDrag()
    })
    makeEventListener(document, "keydown", (event) => {
      if (event.key === "Escape") clearDrag()
    })
    makeEventListener(document, "drop", handleDrop)
  })

  return {
    addAttachments,
    handlePaste,
    handleDrop,
    /** Uploads still in flight for this composer; sending waits for them. */
    pending: () => uploads.items().filter((item) => pending.ids.includes(item.id)),
    cancel(id: string) {
      uploads.items().find((item) => item.id === id)?.cancel()
    },
    pick(fallback: () => void) {
      if (!input.picker) {
        fallback()
        return
      }
      void input.picker({ defaultPath: input.directory(), multiple: true }, (file) => add(file)).catch(input.onError)
    },
  }
}

const imageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

// The server rejects inline attachments above this size, so larger media takes the path route.
const MAX_INLINE_BYTES = 20 * 1024 * 1024

// Mirrors the media the server forwards to the model as message content.
function native(mime: string, input: AttachmentDestination["input"]) {
  if (imageMimes.has(mime)) return input.image
  if (mime === "application/pdf") return input.pdf
  return false
}

const imageExtensions = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
])
const textMimes = new Set([
  "application/json",
  "application/ld+json",
  "application/toml",
  "application/x-toml",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
])

// Text-like files normalize to text/plain so the chip labels them as text; every other file keeps
// a binary type. Delivery is decided separately: native media inline, everything else by path.
async function attachmentMime(file: File) {
  const type = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  if (imageMimes.has(type) || type === "application/pdf") return type
  const index = file.name.lastIndexOf(".")
  const suffix = index === -1 ? "" : file.name.slice(index + 1).toLowerCase()
  const fallback = imageExtensions.get(suffix) ?? (suffix === "pdf" ? "application/pdf" : undefined)
  if ((!type || type === "application/octet-stream") && fallback) return fallback
  if (type.startsWith("text/") || textMimes.has(type) || type.endsWith("+json") || type.endsWith("+xml")) {
    return "text/plain"
  }
  const binary = type || "application/octet-stream"
  const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  if (bytes.some((byte) => byte === 0)) return binary
  const control = bytes.filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length
  if (bytes.length > 0 && control / bytes.length > 0.3) return binary
  return "text/plain"
}

function cursorPosition(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return 0
  const before = range.cloneRange()
  before.selectNodeContents(editor)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString().replace(/\u200B/g, "").length
}

function largePaste(text: string) {
  if (text.length >= 8000) return true
  return text.split("\n").length - 1 >= 120
}

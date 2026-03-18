import { onCleanup, onMount } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { usePrompt, type ContentPart, type ImageAttachmentPart } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { uuid } from "@/utils/uuid"
import { getCursorPosition } from "./editor-dom"
import { ACCEPTED_FILE_TYPES, attachmentMime } from "./files"
import { normalizePaste, pasteMode } from "./paste"

function dataUrl(file: File, mime: string) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.addEventListener("error", () => resolve(""))
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      const idx = value.indexOf(",")
      if (idx === -1) {
        resolve(value)
        return
      }
      resolve(`data:${mime};base64,${value.slice(idx + 1)}`)
    })
    reader.readAsDataURL(file)
  })
}

const NATIVE_DROP_EVENT = "opencode:native-file-drop"

type PathFile = File & { path?: string }
type NativeDropDetail = { paths?: string[] }

const WINDOWS_PATH = /^[A-Za-z]:[\\/]/
const UNC_PATH = /^\\\\/

type PromptAttachmentsInput = {
  editor: () => HTMLDivElement | undefined
  isDialogActive: () => boolean
  setDraggingType: (type: "image" | "@mention" | null) => void
  focusEditor: () => void
  addPart: (part: ContentPart) => boolean
  readClipboardImage?: () => Promise<File | null>
  readAttachmentFromPath?: (path: string) => Promise<{ filename: string; mime: string; dataUrl: string } | null>
}

export function createPromptAttachments(input: PromptAttachmentsInput) {
  const prompt = usePrompt()
  const language = useLanguage()
  let recentDrop = {
    time: 0,
    paths: new Set<string>(),
  }

  const warn = () => {
    showToast({
      title: language.t("prompt.toast.pasteUnsupported.title"),
      description: language.t("prompt.toast.pasteUnsupported.description"),
    })
  }

  const add = async (file: File, toast = true) => {
    const mime = await attachmentMime(file)
    if (!mime) {
      if (toast) warn()
      return false
    }

    const editor = input.editor()
    if (!editor) return false

    const url = await dataUrl(file, mime)
    if (!url) return false

    const attachment: ImageAttachmentPart = {
      type: "image",
      id: uuid(),
      filename: file.name,
      mime,
      dataUrl: url,
    }
    const cursor = prompt.cursor() ?? getCursorPosition(editor)
    prompt.set([...prompt.current(), attachment], cursor)
    return true
  }

  const addImageAttachment = (attachment: { filename: string; mime: string; dataUrl: string }) => {
    if (!ACCEPTED_FILE_TYPES.includes(attachment.mime)) return false
    const editor = input.editor()
    if (!editor) return false
    const next: ImageAttachmentPart = {
      type: "image",
      id: uuid(),
      filename: attachment.filename,
      mime: attachment.mime,
      dataUrl: attachment.dataUrl,
    }
    const cursor = prompt.cursor() ?? getCursorPosition(editor)
    prompt.set([...prompt.current(), next], cursor)
    return true
  }

  const addFileReference = (path: string) => {
    if (!path) return
    if (prompt.current().some((part) => part.type === "file" && part.path === path)) return
    input.focusEditor()
    input.addPart({ type: "file", path, content: "@" + path, start: 0, end: 0 })
  }

  const addPath = async (path: string) => {
    if (!path) return
    const attachment = await input.readAttachmentFromPath?.(path).catch(() => null)
    if (attachment && addImageAttachment(attachment)) return
    addFileReference(path)
  }

  const fileItemPath = (file: File | null) => {
    if (!file) return null
    const path = (file as PathFile).path
    if (!path?.trim()) return null
    return path
  }

  const fromFileUri = (value: string) => {
    if (!value.startsWith("file:")) return null
    if (!URL.canParse(value)) return value.slice(5)
    const uri = new URL(value)
    if (uri.protocol !== "file:") return null
    const pathname = decodeURIComponent(uri.pathname)
    if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1)
    if (uri.host) return `//${uri.host}${pathname}`
    return pathname
  }

  const normalizePath = (value: string) => {
    const path = value.trim()
    if (!path) return null
    const next = fromFileUri(path)
    if (next) return next
    if (path.startsWith("/") || WINDOWS_PATH.test(path) || UNC_PATH.test(path)) return path
    return null
  }

  const droppedPaths = (event: DragEvent) => {
    const transfer = event.dataTransfer
    const hasFiles = (transfer?.files.length ?? 0) > 0
    const types = [
      "text/uri-list",
      "text/plain",
      "public.file-url",
      "text/x-moz-url",
      ...(transfer?.types ?? []).filter((type) => type.includes("uri") || type.includes("file")),
    ]
    const list = Array.from(new Set(types))
      .map((type) => transfer?.getData(type) ?? "")
      .flatMap((text) => (text ?? "").split("\n"))
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .flatMap((line) => {
        const path = normalizePath(line)
        if (path) return [path]
        if (!hasFiles) return []
        if (line.startsWith("/") || WINDOWS_PATH.test(line) || UNC_PATH.test(line)) return [decodeURIComponent(line)]
        return []
      })
    return Array.from(new Set(list))
  }

  const addAttachment = (file: File) => add(file)

  const removeImageAttachment = (id: string) => {
    const current = prompt.current()
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    prompt.set(next, prompt.cursor())
  }

  const isDuplicateDrop = (paths: string[]) => {
    if (Date.now() - recentDrop.time >= 1000) return false
    if (paths.length === 0) return false
    return paths.every((path) => recentDrop.paths.has(path))
  }

  const setRecentDrop = (paths: string[]) => {
    if (paths.length === 0) return
    recentDrop = {
      time: Date.now(),
      paths: new Set(paths),
    }
  }

  const addDroppedPaths = async (paths: string[]) => {
    const existing = new Set(prompt.current().flatMap((part) => (part.type === "file" ? [part.path] : [])))
    const next = paths.filter((path, index, list) => list.indexOf(path) === index).filter((path) => !existing.has(path))
    if (next.length === 0) {
      setRecentDrop(paths)
      return
    }
    for (const path of next) {
      await addPath(path)
    }
    setRecentDrop(paths)
  }

  const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    event.preventDefault()
    event.stopPropagation()

    const items = Array.from(clipboardData.items)
    const fileItems = items.filter((item) => item.kind === "file")

    if (fileItems.length > 0) {
      let found = false
      for (const item of fileItems) {
        const file = item.getAsFile()
        if (!file) continue
        const path = fileItemPath(file)
        if (path) {
          await addPath(path)
          found = true
          continue
        }
        const ok = await add(file, false)
        if (ok) found = true
      }
      if (!found) warn()
      return
    }

    const plainText = clipboardData.getData("text/plain") ?? ""

    if (input.readClipboardImage && !plainText) {
      const file = await input.readClipboardImage()
      if (file) {
        await addAttachment(file)
        return
      }
    }

    if (!plainText) return

    const text = normalizePaste(plainText)

    const put = () => {
      if (input.addPart({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor()
      return input.addPart({ type: "text", content: text, start: 0, end: 0 })
    }

    if (pasteMode(text) === "manual") {
      put()
      return
    }

    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text)
    if (inserted) return

    put()
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    const hasText = event.dataTransfer?.types.includes("text/plain")
    if (hasFiles) {
      const files = Array.from(event.dataTransfer?.items ?? []).filter((item) => item.kind === "file")
      const hasMedia = files.some((item) => item.type.startsWith("image/") || item.type === "application/pdf")
      input.setDraggingType(hasMedia ? "image" : "@mention")
      return
    }
    if (hasText) input.setDraggingType("@mention")
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (input.isDialogActive()) return
    if (!event.relatedTarget) {
      input.setDraggingType(null)
    }
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    input.setDraggingType(null)

    const paths = droppedPaths(event)
    if (paths.length > 0) {
      if (isDuplicateDrop(paths)) return
      await addDroppedPaths(paths)
      return
    }

    const dropped = event.dataTransfer?.files
    if (!dropped) return

    const filePaths = Array.from(dropped)
      .flatMap((file) => {
        const path = fileItemPath(file)
        return path ? [path] : []
      })
      .filter((path, index, list) => list.indexOf(path) === index)
    if (isDuplicateDrop(filePaths)) return

    let found = false
    for (const file of Array.from(dropped)) {
      const path = fileItemPath(file)
      if (path) {
        await addPath(path)
        found = true
        continue
      }

      const ok = await add(file, false)
      if (ok) found = true
    }
    if (!found && dropped.length > 0) warn()
  }

  const handleNativeDrop = (event: Event) => {
    if (input.isDialogActive()) return
    const detail = (event as CustomEvent<NativeDropDetail>).detail
    const paths = (detail?.paths ?? []).flatMap((path) => {
      const value = normalizePath(path)
      return value ? [value] : []
    })
    if (paths.length === 0) return
    const deduped = Array.from(new Set(paths))
    if (isDuplicateDrop(deduped)) return
    void addDroppedPaths(deduped)
  }

  onMount(() => {
    window.addEventListener(NATIVE_DROP_EVENT, handleNativeDrop as EventListener)
    document.addEventListener("dragover", handleGlobalDragOver)
    document.addEventListener("dragleave", handleGlobalDragLeave)
    document.addEventListener("drop", handleGlobalDrop)
  })

  onCleanup(() => {
    window.removeEventListener(NATIVE_DROP_EVENT, handleNativeDrop as EventListener)
    document.removeEventListener("dragover", handleGlobalDragOver)
    document.removeEventListener("dragleave", handleGlobalDragLeave)
    document.removeEventListener("drop", handleGlobalDrop)
  })

  return {
    addAttachment,
    addImageAttachment,
    addPath,
    removeImageAttachment,
    handlePaste,
  }
}

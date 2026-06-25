import { onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { showToast } from "@/utils/toast"
import { type ContentPart, type ImageAttachmentPart, type usePrompt } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { uuid } from "@/utils/uuid"
import { getCursorPosition } from "./editor-dom"
import { attachmentMime } from "./files"
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

type PromptTarget = Pick<ReturnType<ReturnType<typeof usePrompt>["capture"]>, "current" | "cursor" | "set">
type AttachmentTarget = { prompt: PromptTarget; cursor: number | undefined }

type PromptAttachmentsCoreInput = {
  capture: () => PromptTarget
  editor: () => HTMLDivElement | undefined
  focusEditor?: () => void
  addPart?: (part: ContentPart) => boolean
  warn?: () => void
  readClipboardImage?: () => Promise<File | null>
  getPathForFile?: (file: File) => string
}

type PromptAttachmentsInput = {
  prompt: ReturnType<typeof usePrompt>
  editor: () => HTMLDivElement | undefined
  isDialogActive: () => boolean
  setDraggingType: (type: "image" | "@mention" | null) => void
  focusEditor: () => void
  addPart: (part: ContentPart) => boolean
  readClipboardImage?: () => Promise<File | null>
  getPathForFile?: (file: File) => string
}

export function createPromptAttachmentsCore(input: PromptAttachmentsCoreInput) {
  const capture = (): AttachmentTarget | undefined => {
    const prompt = input.capture()
    const editor = input.editor()
    if (!editor) return
    return { prompt, cursor: prompt.cursor() ?? getCursorPosition(editor) }
  }

  const add = async (file: File, toast = true, target = capture()) => {
    if (!target) return false
    const mime = await attachmentMime(file)
    if (!mime) {
      if (toast) input.warn?.()
      return false
    }

    const url = await dataUrl(file, mime)
    if (!url) return false

    const attachment: ImageAttachmentPart = {
      type: "image",
      id: uuid(),
      filename: file.name,
      sourcePath: input.getPathForFile?.(file) || undefined,
      mime,
      dataUrl: url,
    }
    target.prompt.set([...target.prompt.current(), attachment], target.cursor)
    return true
  }

  const addAttachment = (file: File) => add(file)

  const addAttachments = async (files: File[], toast = true, target = capture()) => {
    let found = false

    for (const file of files) {
      const ok = await add(file, false, target)
      if (ok) found = true
    }

    if (!found && files.length > 0 && toast) input.warn?.()
    return found
  }

  const addClipboardAttachment = async (pending: Promise<File | null>, target = capture()) => {
    const file = await pending
    if (!file) return false
    return add(file, true, target)
  }

  const removeAttachment = (id: string) => {
    const target = input.capture()
    const current = target.current()
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    target.set(next, target.cursor())
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
      await addAttachments(files, true, target)
      return
    }

    const plainText = clipboardData.getData("text/plain") ?? ""

    // Desktop: Browser clipboard has no images and no text, try platform's native clipboard for images
    if (input.readClipboardImage && !plainText) {
      if (await addClipboardAttachment(input.readClipboardImage(), target)) return
    }

    if (!plainText) return

    const text = normalizePaste(plainText)

    const put = () => {
      if (input.addPart?.({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor?.()
      return input.addPart?.({ type: "text", content: text, start: 0, end: 0 }) ?? false
    }

    if (pasteMode(text) === "manual") {
      put()
      return
    }

    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text)
    if (inserted) return

    put()
  }

  return {
    addAttachment,
    addAttachments,
    addClipboardAttachment,
    removeAttachment,
    handlePaste,
  }
}

export function createPromptAttachments(input: PromptAttachmentsInput) {
  const language = useLanguage()
  const attachments = createPromptAttachmentsCore({
    ...input,
    capture: input.prompt.capture,
    warn: () => {
      showToast({
        title: language.t("prompt.toast.pasteUnsupported.title"),
        description: language.t("prompt.toast.pasteUnsupported.description"),
      })
    },
  })

  const handleGlobalDragOver = (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    const hasText = event.dataTransfer?.types.includes("text/plain")
    if (hasFiles) {
      input.setDraggingType("image")
    } else if (hasText) {
      input.setDraggingType("@mention")
    }
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

    const plainText = event.dataTransfer?.getData("text/plain")
    const filePrefix = "file:"
    if (plainText?.startsWith(filePrefix)) {
      const filePath = plainText.slice(filePrefix.length)
      input.focusEditor()
      input.addPart({ type: "file", path: filePath, content: "@" + filePath, start: 0, end: 0 })
      return
    }

    const dropped = event.dataTransfer?.files
    if (!dropped) return

    await attachments.addAttachments(Array.from(dropped))
  }

  onMount(() => {
    makeEventListener(document, "dragover", handleGlobalDragOver)
    makeEventListener(document, "dragleave", handleGlobalDragLeave)
    makeEventListener(document, "drop", handleGlobalDrop)
  })

  return attachments
}

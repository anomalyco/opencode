import { createEffect, createMemo, createResource, type Accessor } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import { getDirectory, getFilename } from "@/utils"
import { createSpeechRecognition } from "@/utils/speech"
import {
  createAttachmentDisplay,
  mentionPattern,
  mentionTriggerPattern,
  type PromptAttachmentPart,
  type PromptAttachmentSegment,
} from "./prompt-form-helpers"
import type { LocalFile, TextSelection } from "@/context/local"

export type MentionRange = {
  start: number
  end: number
}

export interface PromptFormState {
  promptInput: string
  isDragOver: boolean
  mentionOpen: boolean
  mentionQuery: string
  mentionRange: MentionRange | undefined
  mentionIndex: number
  mentionAnchorOffset: { x: number; y: number }
  inlineAliases: Map<string, PromptAttachmentPart>
}

interface MentionControllerOptions {
  state: PromptFormState
  setState: SetStoreFunction<PromptFormState>
  attachmentSegments: Accessor<PromptAttachmentSegment[]>
  getInputRef: () => HTMLTextAreaElement | undefined
  getOverlayRef: () => HTMLDivElement | undefined
  getMeasureRef: () => HTMLDivElement | undefined
  searchFiles: (query: string) => Promise<string[]>
  resolveFile: (path: string) => LocalFile | undefined
  addContextFile: (path: string, selection?: TextSelection) => void
  getActiveContext: () => { path: string; selection?: TextSelection } | undefined
}

interface MentionKeyDownOptions {
  event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }
  mentionItems: () => string[]
  insertMention: (path: string) => void
}

interface ScrollSyncOptions {
  state: PromptFormState
  getInputRef: () => HTMLTextAreaElement | undefined
  getOverlayRef: () => HTMLDivElement | undefined
  interim: Accessor<string>
  updateMentionPosition: (element: HTMLTextAreaElement, range?: MentionRange) => void
}

export function usePromptSpeech(updatePromptInput: (updater: (prev: string) => string) => void) {
  return createSpeechRecognition({
    onFinal: (text) => updatePromptInput((prev) => (prev && !prev.endsWith(" ") ? `${prev} ` : prev) + text),
  })
}

export function useMentionController(options: MentionControllerOptions) {
  const mentionSource = createMemo(() => (options.state.mentionOpen ? options.state.mentionQuery : undefined))
  const [mentionResults, { mutate: mutateMentionResults }] = createResource(mentionSource, (query) => {
    if (!options.state.mentionOpen) return []
    return options.searchFiles(query ?? "")
  })
  const mentionItems = createMemo(() => mentionResults() ?? [])

  createEffect(() => {
    if (!options.state.mentionOpen) return
    options.state.mentionQuery
    options.setState("mentionIndex", 0)
  })

  createEffect(() => {
    if (!options.state.mentionOpen) return
    queueMicrotask(() => {
      const input = options.getInputRef()
      if (!input) return
      if (document.activeElement === input) return
      input.focus()
    })
  })

  createEffect(() => {
    const used = new Set<string>()
    for (const match of options.state.promptInput.matchAll(mentionPattern)) {
      const token = match[1]
      if (token) used.add(token.toLowerCase())
    }
    options.setState("inlineAliases", (prev) => {
      if (prev.size === 0) return prev
      const next = new Map(prev)
      let changed = false
      for (const key of prev.keys()) {
        if (!used.has(key.toLowerCase())) {
          next.delete(key)
          changed = true
        }
      }
      return changed ? next : prev
    })
  })

  createEffect(() => {
    if (!options.state.mentionOpen) return
    const items = mentionItems()
    if (items.length === 0) {
      options.setState("mentionIndex", 0)
      return
    }
    if (options.state.mentionIndex < items.length) return
    options.setState("mentionIndex", items.length - 1)
  })

  createEffect(() => {
    if (!options.state.mentionOpen) return
    const rangeValue = options.state.mentionRange
    if (!rangeValue) return
    options.state.promptInput
    queueMicrotask(() => {
      const input = options.getInputRef()
      if (!input) return
      updateMentionPosition(input, rangeValue)
    })
  })

  function closeMention() {
    if (options.state.mentionOpen) options.setState("mentionOpen", false)
    options.setState("mentionQuery", "")
    options.setState("mentionRange", undefined)
    options.setState("mentionIndex", 0)
    mutateMentionResults(() => undefined)
    options.setState("mentionAnchorOffset", { x: 0, y: 0 })
  }

  function updateMentionPosition(element: HTMLTextAreaElement, rangeValue = options.state.mentionRange) {
    const measure = options.getMeasureRef()
    if (!measure) return
    if (!rangeValue) return
    measure.style.width = `${element.clientWidth}px`
    const measurement = element.value.slice(0, rangeValue.end)
    measure.textContent = measurement
    const caretSpan = document.createElement("span")
    caretSpan.textContent = "\u200b"
    measure.append(caretSpan)
    const caretRect = caretSpan.getBoundingClientRect()
    const containerRect = measure.getBoundingClientRect()
    measure.removeChild(caretSpan)
    const left = caretRect.left - containerRect.left
    const top = caretRect.top - containerRect.top - element.scrollTop
    options.setState("mentionAnchorOffset", { x: left, y: top < 0 ? 0 : top })
  }

  function isValidMentionQuery(value: string) {
    return /^[A-Za-z0-9_\-./]*$/.test(value)
  }

  function syncMentionFromCaret(element: HTMLTextAreaElement) {
    if (!options.state.mentionOpen) return
    const rangeValue = options.state.mentionRange
    if (!rangeValue) {
      closeMention()
      return
    }
    const caret = element.selectionEnd ?? element.selectionStart ?? element.value.length
    if (rangeValue.start < 0 || rangeValue.start >= element.value.length) {
      closeMention()
      return
    }
    if (element.value[rangeValue.start] !== "@") {
      closeMention()
      return
    }
    if (caret <= rangeValue.start) {
      closeMention()
      return
    }
    const mentionValue = element.value.slice(rangeValue.start + 1, caret)
    if (!isValidMentionQuery(mentionValue)) {
      closeMention()
      return
    }
    options.setState("mentionRange", { start: rangeValue.start, end: caret })
    options.setState("mentionQuery", mentionValue)
    updateMentionPosition(element, { start: rangeValue.start, end: caret })
  }

  function tryOpenMentionFromCaret(element: HTMLTextAreaElement) {
    const selectionStart = element.selectionStart ?? element.value.length
    const selectionEnd = element.selectionEnd ?? selectionStart
    if (selectionStart !== selectionEnd) return false
    const caret = selectionEnd
    if (options.attachmentSegments().some((segment) => caret >= segment.start && caret <= segment.end)) {
      return false
    }
    const before = element.value.slice(0, caret)
    const match = before.match(mentionTriggerPattern)
    if (!match) return false
    const token = match[2] ?? ""
    const start = caret - token.length - 1
    if (start < 0) return false
    options.setState("mentionOpen", true)
    options.setState("mentionRange", { start, end: caret })
    options.setState("mentionQuery", token)
    options.setState("mentionIndex", 0)
    queueMicrotask(() => {
      updateMentionPosition(element, { start, end: caret })
    })
    return true
  }

  function handlePromptInput(event: InputEvent & { currentTarget: HTMLTextAreaElement }) {
    const element = event.currentTarget
    options.setState("promptInput", element.value)
    if (options.state.mentionOpen) {
      syncMentionFromCaret(element)
      if (options.state.mentionOpen) return
    }
    const isDeletion = event.inputType ? event.inputType.startsWith("delete") : false
    if (!isDeletion && tryOpenMentionFromCaret(element)) return
    closeMention()
  }

  function handleMentionKeyDown({ event, mentionItems: items, insertMention }: MentionKeyDownOptions) {
    if (!options.state.mentionOpen) return false
    const list = items()
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (list.length === 0) return true
      const next = options.state.mentionIndex + 1 >= list.length ? 0 : options.state.mentionIndex + 1
      options.setState("mentionIndex", next)
      return true
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      if (list.length === 0) return true
      const previous = options.state.mentionIndex - 1 < 0 ? list.length - 1 : options.state.mentionIndex - 1
      options.setState("mentionIndex", previous)
      return true
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const targetItem = list[options.state.mentionIndex] ?? list[0]
      if (targetItem) insertMention(targetItem)
      return true
    }
    if (event.key === "Escape") {
      event.preventDefault()
      closeMention()
      return true
    }
    return false
  }

  function generateMentionAlias(path: string) {
    const existing = new Set<string>()
    for (const key of options.state.inlineAliases.keys()) {
      existing.add(key.toLowerCase())
    }
    for (const match of options.state.promptInput.matchAll(mentionPattern)) {
      const token = match[1]
      if (token) existing.add(token.toLowerCase())
    }

    const base = getFilename(path)
    if (base) {
      if (!existing.has(base.toLowerCase())) return base
    }

    const directory = getDirectory(path)
    if (base && directory) {
      const segments = directory.split("/").filter(Boolean)
      for (let i = segments.length - 1; i >= 0; i -= 1) {
        const candidate = `${segments.slice(i).join("/")}/${base}`
        if (!existing.has(candidate.toLowerCase())) return candidate
      }
    }

    if (!existing.has(path.toLowerCase())) return path

    const fallback = base || path || "file"
    let index = 2
    let candidate = `${fallback}-${index}`
    while (existing.has(candidate.toLowerCase())) {
      index += 1
      candidate = `${fallback}-${index}`
    }
    return candidate
  }

  function insertMention(path: string) {
    const input = options.getInputRef()
    if (!input) return
    const rangeValue = options.state.mentionRange
    if (!rangeValue) return
    const node = options.resolveFile(path)
    const alias = generateMentionAlias(path)
    const mentionText = `@${alias}`
    const value = options.state.promptInput
    const before = value.slice(0, rangeValue.start)
    const after = value.slice(rangeValue.end)
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
    const needsTrailingSpace = after.length > 0 && !/^\s/.test(after)
    const leading = needsLeadingSpace ? `${before} ` : before
    const trailingSpacer = needsTrailingSpace ? " " : ""
    const nextValue = `${leading}${mentionText}${trailingSpacer}${after}`
    const origin = options.getActiveContext()?.path === path ? "active" : "context"
    const part: PromptAttachmentPart = {
      kind: "attachment",
      token: alias,
      display: createAttachmentDisplay(path, node?.selection),
      path,
      selection: node?.selection,
      origin,
    }
    options.setState("promptInput", nextValue)
    if (input.value !== nextValue) {
      input.value = nextValue
    }
    options.setState("inlineAliases", (prev) => {
      const next = new Map(prev)
      next.set(alias, part)
      return next
    })
    options.addContextFile(path, node?.selection)
    closeMention()
    queueMicrotask(() => {
      const caret = leading.length + mentionText.length + trailingSpacer.length
      input.setSelectionRange(caret, caret)
      syncMentionFromCaret(input)
    })
  }

  return {
    mentionResults,
    mentionItems,
    closeMention,
    syncMentionFromCaret,
    tryOpenMentionFromCaret,
    updateMentionPosition,
    handlePromptInput,
    handleMentionKeyDown,
    insertMention,
  }
}

export function usePromptScrollSync(options: ScrollSyncOptions) {
  let shouldAutoScroll = true

  createEffect(() => {
    options.state.promptInput
    options.interim()
    queueMicrotask(() => {
      const input = options.getInputRef()
      const overlay = options.getOverlayRef()
      if (!input || !overlay) return
      if (!shouldAutoScroll) {
        overlay.scrollTop = input.scrollTop
        if (options.state.mentionOpen) options.updateMentionPosition(input)
        return
      }
      const maxInputScroll = input.scrollHeight - input.clientHeight
      const next = maxInputScroll > 0 ? maxInputScroll : 0
      input.scrollTop = next
      overlay.scrollTop = next
      if (options.state.mentionOpen) options.updateMentionPosition(input)
    })
  })

  function handlePromptScroll(event: Event & { currentTarget: HTMLTextAreaElement }) {
    const target = event.currentTarget
    shouldAutoScroll = target.scrollTop + target.clientHeight >= target.scrollHeight - 4
    const overlay = options.getOverlayRef()
    if (overlay) overlay.scrollTop = target.scrollTop
    if (options.state.mentionOpen) options.updateMentionPosition(target)
  }

  function resetScrollPosition() {
    shouldAutoScroll = true
    const input = options.getInputRef()
    const overlay = options.getOverlayRef()
    if (input) input.scrollTop = 0
    if (overlay) overlay.scrollTop = 0
  }

  return {
    handlePromptScroll,
    resetScrollPosition,
    setAutoScroll: (value: boolean) => {
      shouldAutoScroll = value
    },
  }
}

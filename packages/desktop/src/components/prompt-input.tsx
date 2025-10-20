import { createEffect, on, Component, createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"

interface TextPart {
  type: "text"
  content: string
}

interface AttachmentPart {
  type: "attachment"
  fileId: string
  name: string
}

export type ContentPart = TextPart | AttachmentPart

export interface AttachmentToAdd {
  id: string
  name: string
}

type AddAttachmentCallback = (attachment: AttachmentToAdd) => void

export interface PopoverState {
  isOpen: boolean
  searchQuery: string
  addAttachment: AddAttachmentCallback
}

interface PromptInputProps {
  onSubmit: (parts: ContentPart[]) => void
  onShowAttachments?: (state: PopoverState | null) => void
  class?: string
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  let editorRef: HTMLDivElement | undefined

  const defaultParts = [{ type: "text", content: "" } as const]
  const [store, setStore] = createStore<{
    contentParts: ContentPart[]
    popover: {
      isOpen: boolean
      searchQuery: string
    }
  }>({
    contentParts: defaultParts,
    popover: {
      isOpen: false,
      searchQuery: "",
    },
  })

  const isEmpty = createMemo(() => isEqual(store.contentParts, defaultParts))

  createEffect(
    on(
      () => store.contentParts,
      (currentParts) => {
        if (!editorRef) return
        const domParts = parseFromDOM()
        if (isEqual(currentParts, domParts)) return

        const selection = window.getSelection()
        let cursorPosition: number | null = null
        if (selection && selection.rangeCount > 0 && editorRef.contains(selection.anchorNode)) {
          cursorPosition = getCursorPosition(editorRef)
        }

        editorRef.innerHTML = ""
        currentParts.forEach((part) => {
          if (part.type === "text") {
            editorRef!.appendChild(document.createTextNode(part.content))
          } else if (part.type === "attachment") {
            const pill = document.createElement("span")
            pill.textContent = `@${part.name}`
            pill.className = "attachment-pill"
            pill.setAttribute("data-file-id", part.fileId)
            pill.setAttribute("contenteditable", "false")
            editorRef!.appendChild(pill)
          }
        })

        if (cursorPosition !== null) {
          setCursorPosition(editorRef, cursorPosition)
        }
      },
    ),
  )

  createEffect(() => {
    if (store.popover.isOpen) {
      props.onShowAttachments?.({
        isOpen: true,
        searchQuery: store.popover.searchQuery,
        addAttachment: addAttachment,
      })
    } else {
      props.onShowAttachments?.(null)
    }
  })

  const parseFromDOM = (): ContentPart[] => {
    if (!editorRef) return []
    const newParts: ContentPart[] = []
    editorRef.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) newParts.push({ type: "text", content: node.textContent })
      } else if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.fileId) {
        newParts.push({
          type: "attachment",
          fileId: (node as HTMLElement).dataset.fileId!,
          name: node.textContent!.substring(1),
        })
      }
    })
    if (newParts.length === 0) newParts.push(...defaultParts)
    return newParts
  }

  const handleInput = () => {
    const rawParts = parseFromDOM()
    const cursorPosition = getCursorPosition(editorRef!)
    const rawText = rawParts.map((p) => (p.type === "text" ? p.content : `@${p.name}`)).join("")

    const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
    if (atMatch) {
      setStore("popover", { isOpen: true, searchQuery: atMatch[1] })
    } else if (store.popover.isOpen) {
      setStore("popover", "isOpen", false)
    }

    setStore("contentParts", rawParts)
  }

  const addAttachment: AddAttachmentCallback = (attachment) => {
    const rawText = store.contentParts.map((p) => (p.type === "text" ? p.content : `@${p.name}`)).join("")
    const cursorPosition = getCursorPosition(editorRef!)

    const textBeforeCursor = rawText.substring(0, cursorPosition)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)

    if (!atMatch) return

    const startIndex = atMatch.index!

    // Create new structured content
    const newParts: ContentPart[] = []
    const textBeforeTrigger = rawText.substring(0, startIndex)
    if (textBeforeTrigger) newParts.push({ type: "text", content: textBeforeTrigger })

    newParts.push({ type: "attachment", fileId: attachment.id, name: attachment.name })

    // Add a space after the pill for better UX
    newParts.push({ type: "text", content: " " })

    const textAfterCursor = rawText.substring(cursorPosition)
    if (textAfterCursor) newParts.push({ type: "text", content: textAfterCursor })

    setStore("contentParts", newParts)
    setStore("popover", "isOpen", false)

    // Set cursor position after the newly added pill + space
    // We need to wait for the DOM to update
    queueMicrotask(() => {
      setCursorPosition(editorRef!, textBeforeTrigger.length + 1 + attachment.name.length + 1)
    })
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (store.popover.isOpen && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")) {
      // In a real implementation, you'd prevent default and delegate this to the popover
      console.log("Key press delegated to popover:", event.key)
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (store.contentParts.length > 0) {
        props.onSubmit([...store.contentParts])
        setStore("contentParts", defaultParts)
      }
    }
  }

  return (
    <div
      classList={{
        "size-full max-w-xl bg-surface-raised-stronger-non-alpha border border-border-strong-base": true,
        "rounded-2xl overflow-clip focus-within:shadow-xs-border-selected": true,
        [props.class ?? ""]: !!props.class,
      }}
    >
      <div class="p-3" />
      <div class="relative">
        <div
          ref={editorRef}
          contenteditable="true"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          classList={{
            "w-full p-3 text-sm focus:outline-none": true,
          }}
        />
        <Show when={isEmpty()}>
          <div class="absolute bottom-0 left-0 p-3 text-sm text-text-weak pointer-events-none">
            Plan and build anything
          </div>
        </Show>
      </div>
      <div class="p-3" />
    </div>
  )
}

function isEqual(arrA: ContentPart[], arrB: ContentPart[]): boolean {
  if (arrA.length !== arrB.length) return false
  for (let i = 0; i < arrA.length; i++) {
    const partA = arrA[i]
    const partB = arrB[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB as TextPart).content) {
      return false
    }
    if (partA.type === "attachment" && partA.fileId !== (partB as AttachmentPart).fileId) {
      return false
    }
  }
  return true
}

function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return preCaretRange.toString().length
}

function setCursorPosition(parent: HTMLElement, position: number) {
  let child = parent.firstChild
  let offset = position
  while (child) {
    if (offset > child.textContent!.length) {
      offset -= child.textContent!.length
      child = child.nextSibling
    } else {
      try {
        const range = document.createRange()
        const sel = window.getSelection()
        range.setStart(child, offset)
        range.collapse(true)
        sel?.removeAllRanges()
        sel?.addRange(range)
      } catch (e) {
        console.error("Failed to set cursor position.", e)
      }
      return
    }
  }
}

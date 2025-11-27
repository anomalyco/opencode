import { useFilteredList } from "@opencode-ai/ui/hooks"
import { createEffect, on, Component, Show, For, onMount, onCleanup, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { createFocusSignal } from "@solid-primitives/active-element"
import { useLocal } from "@/context/local"
import { DateTime } from "luxon"
import { ContentPart, DEFAULT_PROMPT, isPromptEqual, Prompt, useSession } from "@/context/session"
import { useSDK } from "@/context/sdk"
import { useNavigate } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { getDirectory, getFilename } from "@opencode-ai/util/path"

interface PromptInputProps {
  class?: string
  ref?: (el: HTMLDivElement) => void
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const session = useSession()
  let editorRef!: HTMLDivElement

  const [store, setStore] = createStore<{
    popoverIsOpen: boolean
  }>({
    popoverIsOpen: false,
  })

  createEffect(() => {
    session.id
    editorRef.focus()
  })

  const isFocused = createFocusSignal(() => editorRef)

  const handlePaste = (event: ClipboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    // @ts-expect-error
    const plainText = (event.clipboardData || window.clipboardData)?.getData("text/plain") ?? ""
    addPart({ type: "text", content: plainText, start: 0, end: 0 })
  }

  onMount(() => {
    editorRef.addEventListener("paste", handlePaste)
  })
  onCleanup(() => {
    editorRef.removeEventListener("paste", handlePaste)
  })

  createEffect(() => {
    if (isFocused()) {
      handleInput()
    } else {
      setStore("popoverIsOpen", false)
    }
  })

  const handleFileSelect = (path: string | undefined) => {
    if (!path) return
    addPart({ type: "file", path, content: "@" + getFilename(path), start: 0, end: 0 })
  }

  const { flat, active, onInput, onKeyDown, refetch } = useFilteredList<string>({
    items: local.file.searchFilesAndDirectories,
    key: (x) => x,
    onSelect: handleFileSelect,
  })

  createEffect(() => {
    local.model.recent()
    refetch()
  })

  createEffect(
    on(
      () => session.prompt.current(),
      (currentParts) => {
        const domParts = parseFromDOM()
        if (isPromptEqual(currentParts, domParts)) return

        const selection = window.getSelection()
        let cursorPosition: number | null = null
        if (selection && selection.rangeCount > 0 && editorRef.contains(selection.anchorNode)) {
          cursorPosition = getCursorPosition(editorRef)
        }

        editorRef.innerHTML = ""
        currentParts.forEach((part) => {
          if (part.type === "text") {
            editorRef.appendChild(document.createTextNode(part.content))
          } else if (part.type === "file") {
            const pill = document.createElement("span")
            pill.textContent = part.content
            pill.setAttribute("data-type", "file")
            pill.setAttribute("data-path", part.path)
            pill.setAttribute("contenteditable", "false")
            pill.style.userSelect = "text"
            pill.style.cursor = "default"
            editorRef.appendChild(pill)
          }
        })

        if (cursorPosition !== null) {
          setCursorPosition(editorRef, cursorPosition)
        }
      },
    ),
  )

  const parseFromDOM = (): Prompt => {
    const newParts: Prompt = []
    let position = 0
    editorRef.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) {
          const content = node.textContent
          newParts.push({ type: "text", content, start: position, end: position + content.length })
          position += content.length
        }
      } else if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type) {
        switch ((node as HTMLElement).dataset.type) {
          case "file":
            const content = node.textContent!
            newParts.push({
              type: "file",
              path: (node as HTMLElement).dataset.path!,
              content,
              start: position,
              end: position + content.length,
            })
            position += content.length
            break
          default:
            break
        }
      }
    })
    if (newParts.length === 0) newParts.push(...DEFAULT_PROMPT)
    return newParts
  }

  const handleInput = () => {
    const rawParts = parseFromDOM()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText = rawParts.map((p) => p.content).join("")

    const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
    if (atMatch) {
      onInput(atMatch[1])
      setStore("popoverIsOpen", true)
    } else if (store.popoverIsOpen) {
      setStore("popoverIsOpen", false)
    }

    session.prompt.set(rawParts, cursorPosition)
  }

  const addPart = (part: ContentPart) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const cursorPosition = getCursorPosition(editorRef)
    const prompt = session.prompt.current()
    const rawText = prompt.map((p) => p.content).join("")
    const textBeforeCursor = rawText.substring(0, cursorPosition)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)

    if (part.type === "file") {
      const pill = document.createElement("span")
      pill.textContent = part.content
      pill.setAttribute("data-type", "file")
      pill.setAttribute("data-path", part.path)
      pill.setAttribute("contenteditable", "false")
      pill.style.userSelect = "text"
      pill.style.cursor = "default"

      const gap = document.createTextNode(" ")
      const range = selection.getRangeAt(0)

      if (atMatch) {
        // let node: Node | null = range.startContainer
        // let offset = range.startOffset
        let runningLength = 0

        const walker = document.createTreeWalker(editorRef, NodeFilter.SHOW_TEXT, null)
        let currentNode = walker.nextNode()
        while (currentNode) {
          const textContent = currentNode.textContent || ""
          if (runningLength + textContent.length >= atMatch.index!) {
            const localStart = atMatch.index! - runningLength
            const localEnd = cursorPosition - runningLength
            if (currentNode === range.startContainer || runningLength + textContent.length >= cursorPosition) {
              range.setStart(currentNode, localStart)
              range.setEnd(currentNode, Math.min(localEnd, textContent.length))
              break
            }
          }
          runningLength += textContent.length
          currentNode = walker.nextNode()
        }
      }

      range.deleteContents()
      range.insertNode(gap)
      range.insertNode(pill)
      range.setStartAfter(gap)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    } else if (part.type === "text") {
      const textNode = document.createTextNode(part.content)
      const range = selection.getRangeAt(0)
      range.deleteContents()
      range.insertNode(textNode)
      range.setStartAfter(textNode)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    handleInput()
    setStore("popoverIsOpen", false)
  }

  const abort = () =>
    sdk.client.session.abort({
      path: {
        id: session.id!,
      },
    })

  const handleKeyDown = (event: KeyboardEvent) => {
    if (store.popoverIsOpen && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")) {
      onKeyDown(event)
      event.preventDefault()
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      handleSubmit(event)
    }
    if (event.key === "Escape") {
      if (store.popoverIsOpen) {
        setStore("popoverIsOpen", false)
      } else if (session.working()) {
        abort()
      }
    }
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()
    const prompt = session.prompt.current()
    const text = prompt.map((part) => part.content).join("")
    if (text.trim().length === 0) {
      if (session.working()) abort()
      return
    }

    let existing = session.info()
    if (!existing) {
      const created = await sdk.client.session.create()
      existing = created.data ?? undefined
      if (existing) navigate(existing.id)
    }
    if (!existing) return

    // if (!session.id) {
    // session.layout.setOpenedTabs(
    // session.layout.copyTabs("", session.id)
    // }

    const toAbsolutePath = (path: string) => (path.startsWith("/") ? path : sync.absolute(path))
    const attachments = prompt.filter((part) => part.type === "file")

    // const activeFile = local.context.active()
    // if (activeFile) {
    //   registerAttachment(
    //     activeFile.path,
    //     activeFile.selection,
    //     activeFile.name ?? formatAttachmentLabel(activeFile.path, activeFile.selection),
    //   )
    // }

    // for (const contextFile of local.context.all()) {
    //   registerAttachment(
    //     contextFile.path,
    //     contextFile.selection,
    //     formatAttachmentLabel(contextFile.path, contextFile.selection),
    //   )
    // }

    const attachmentParts = attachments.map((attachment) => {
      const absolute = toAbsolutePath(attachment.path)
      const query = attachment.selection
        ? `?start=${attachment.selection.startLine}&end=${attachment.selection.endLine}`
        : ""
      return {
        type: "file" as const,
        mime: "text/plain",
        url: `file://${absolute}${query}`,
        filename: getFilename(attachment.path),
        source: {
          type: "file" as const,
          text: {
            value: attachment.content,
            start: attachment.start,
            end: attachment.end,
          },
          path: absolute,
        },
      }
    })

    session.layout.setActiveTab(undefined)
    session.messages.setActive(undefined)
    // Clear the editor DOM directly to ensure it's empty
    editorRef.innerHTML = ""
    session.prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)

    sdk.client.session.prompt({
      path: { id: existing.id },
      body: {
        agent: local.agent.current()!.name,
        model: {
          modelID: local.model.current()!.id,
          providerID: local.model.current()!.provider.id,
        },
        parts: [
          {
            type: "text",
            text,
          },
          ...attachmentParts,
        ],
      },
    })
  }

  return (
    <div class="relative size-full _max-h-[320px] flex flex-col gap-3">
      <Show when={store.popoverIsOpen}>
        <div
          class="absolute inset-x-0 -top-3 -translate-y-full origin-bottom-left max-h-[252px] min-h-10
                 overflow-auto no-scrollbar flex flex-col p-2 pb-0 rounded-md
                 border border-border-base bg-surface-raised-stronger-non-alpha shadow-md"
        >
          <Show when={flat().length > 0} fallback={<div class="text-text-weak px-2">No matching files</div>}>
            <For each={flat()}>
              {(i) => (
                <button
                  classList={{
                    "w-full flex items-center justify-between rounded-md": true,
                    "bg-surface-raised-base-hover": active() === i,
                  }}
                  onClick={() => handleFileSelect(i)}
                >
                  <div class="flex items-center gap-x-2 grow min-w-0">
                    <FileIcon node={{ path: i, type: "file" }} class="shrink-0 size-4" />
                    <div class="flex items-center text-14-regular">
                      <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                        {getDirectory(i)}
                      </span>
                      <Show when={!i.endsWith("/")}>
                        <span class="text-text-strong whitespace-nowrap">{getFilename(i)}</span>
                      </Show>
                    </div>
                  </div>
                  <div class="flex items-center gap-x-1 text-text-muted/40 shrink-0"></div>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
      <form
        onSubmit={handleSubmit}
        classList={{
          "bg-surface-raised-stronger-non-alpha border border-border-strong-base": true,
          "rounded-md overflow-clip focus-within:border-transparent focus-within:shadow-xs-border-select": true,
          [props.class ?? ""]: !!props.class,
        }}
      >
        <div class="relative max-h-[240px] overflow-y-auto">
          <div
            ref={(el) => {
              editorRef = el
              props.ref?.(el)
            }}
            contenteditable="true"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            classList={{
              "w-full px-5 py-3 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
              "[&>[data-type=file]]:text-icon-info-active": true,
            }}
          />
          <Show when={!session.prompt.dirty()}>
            <div class="absolute top-0 left-0 px-5 py-3 text-14-regular text-text-weak pointer-events-none">
              Plan and build anything
            </div>
          </Show>
        </div>
        <div class="relative p-3 flex items-center justify-between">
          <div class="flex items-center justify-start gap-1">
            <Select
              options={local.agent.list().map((agent) => agent.name)}
              current={local.agent.current().name}
              onSelect={local.agent.set}
              class="capitalize"
              variant="ghost"
            />
            <SelectDialog
              title="Select model"
              placeholder="Search models"
              emptyMessage="No model results"
              key={(x) => `${x.provider.id}:${x.id}`}
              items={local.model.list()}
              current={local.model.current()}
              filterKeys={["provider.name", "name", "id"]}
              groupBy={(x) => (local.model.recent().includes(x) ? "Recent" : x.provider.name)}
              sortGroupsBy={(a, b) => {
                const order = ["opencode", "anthropic", "github-copilot", "openai", "google", "openrouter", "vercel"]
                if (a.category === "Recent" && b.category !== "Recent") return -1
                if (b.category === "Recent" && a.category !== "Recent") return 1
                const aProvider = a.items[0].provider.id
                const bProvider = b.items[0].provider.id
                if (order.includes(aProvider) && !order.includes(bProvider)) return -1
                if (!order.includes(aProvider) && order.includes(bProvider)) return 1
                return order.indexOf(aProvider) - order.indexOf(bProvider)
              }}
              onSelect={(x) =>
                local.model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, { recent: true })
              }
              trigger={
                <Button as="div" variant="ghost">
                  {local.model.current()?.name ?? "Select model"}
                  <span class="ml-0.5 text-text-weak text-12-regular">{local.model.current()?.provider.name}</span>
                  <Icon name="chevron-down" size="small" />
                </Button>
              }
            >
              {(i) => (
                <div class="w-full flex items-center justify-between gap-x-3">
                  <div class="flex items-center gap-x-2.5 text-text-muted grow min-w-0">
                    <img src={`https://models.dev/logos/${i.provider.id}.svg`} class="size-6 p-0.5 shrink-0" />
                    <div class="flex gap-x-3 items-baseline flex-[1_0_0]">
                      <span class="text-14-medium text-text-strong overflow-hidden text-ellipsis">{i.name}</span>
                      <Show when={i.release_date}>
                        <span class="text-12-medium text-text-weak overflow-hidden text-ellipsis truncate min-w-0">
                          {DateTime.fromFormat(i.release_date, "yyyy-MM-dd").toFormat("LLL yyyy")}
                        </span>
                      </Show>
                    </div>
                  </div>
                  <Show when={!i.cost || i.cost?.input === 0}>
                    <div class="overflow-hidden text-12-medium text-text-strong">Free</div>
                  </Show>
                </div>
              )}
            </SelectDialog>
          </div>
          <Tooltip
            placement="top"
            value={
              <Switch>
                <Match when={session.working()}>
                  <div class="flex items-center gap-2">
                    <span>Stop</span>
                    <span class="text-icon-base text-12-medium text-[10px]!">ESC</span>
                  </div>
                </Match>
                <Match when={true}>
                  <div class="flex items-center gap-2">
                    <span>Send</span>
                    <Icon name="enter" size="small" class="text-icon-base" />
                  </div>
                </Match>
              </Switch>
            }
          >
            <IconButton
              type="submit"
              disabled={!session.prompt.dirty() && !session.working()}
              icon={session.working() ? "stop" : "arrow-up"}
              variant="primary"
              class="h-10 w-8 absolute right-2 bottom-2"
            />
          </Tooltip>
        </div>
      </form>
    </div>
  )
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
  let remaining = position
  let node = parent.firstChild
  while (node) {
    const length = node.textContent ? node.textContent.length : 0
    const isText = node.nodeType === Node.TEXT_NODE
    const isFile = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type === "file"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    if (isFile && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStartAfter(node)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    remaining -= length
    node = node.nextSibling
  }

  const fallbackRange = document.createRange()
  const fallbackSelection = window.getSelection()
  const last = parent.lastChild
  if (last && last.nodeType === Node.TEXT_NODE) {
    const len = last.textContent ? last.textContent.length : 0
    fallbackRange.setStart(last, len)
  }
  if (!last || last.nodeType !== Node.TEXT_NODE) {
    fallbackRange.selectNodeContents(parent)
  }
  fallbackRange.collapse(false)
  fallbackSelection?.removeAllRanges()
  fallbackSelection?.addRange(fallbackRange)
}

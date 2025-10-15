import { For, Show, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Popover } from "@kobalte/core/popover"
import { Button, FileIcon, Icon, IconButton, Tooltip } from "@/ui"
import { Select } from "@/components/select"
import { useLocal } from "@/context"
import type { FileContext, LocalFile } from "@/context/local"
import { getDirectory, getFilename } from "@/utils"
import { composeDisplaySegments, createAttachmentDisplay, parsePrompt, registerCandidate } from "./prompt-form-helpers"
import type {
  AttachmentCandidate,
  PromptAttachmentPart,
  PromptAttachmentSegment,
  PromptDisplaySegment,
  PromptSubmitValue,
} from "./prompt-form-helpers"
import { useMentionController, usePromptScrollSync, usePromptSpeech, type PromptFormState } from "./prompt-form-hooks"

interface PromptFormProps {
  class?: string
  classList?: Record<string, boolean>
  onSubmit: (prompt: PromptSubmitValue) => Promise<void> | void
  onOpenModelSelect: () => void
  onInputRefChange?: (element: HTMLTextAreaElement | undefined) => void
}

export default function PromptForm(props: PromptFormProps) {
  const local = useLocal()

  const [state, setState] = createStore<PromptFormState>({
    promptInput: "",
    isDragOver: false,
    mentionOpen: false,
    mentionQuery: "",
    mentionRange: undefined,
    mentionIndex: 0,
    mentionAnchorOffset: { x: 0, y: 0 },
    inlineAliases: new Map<string, PromptAttachmentPart>(),
  })

  const placeholderText = "Start typing or speaking..."

  const {
    isSupported,
    isRecording,
    interim: interimTranscript,
    start: startSpeech,
    stop: stopSpeech,
  } = usePromptSpeech((updater) => setState("promptInput", updater))

  let inputRef: HTMLTextAreaElement | undefined = undefined
  let overlayContainerRef: HTMLDivElement | undefined = undefined
  let mentionMeasureRef: HTMLDivElement | undefined = undefined

  const attachmentLookup = createMemo(() => {
    const map = new Map<string, AttachmentCandidate>()
    const activeFile = local.context.active()
    if (activeFile) {
      registerCandidate(
        map,
        {
          origin: "active",
          path: activeFile.path,
          selection: activeFile.selection,
          display: createAttachmentDisplay(activeFile.path, activeFile.selection),
        },
        [activeFile.path, getFilename(activeFile.path)],
      )
    }
    for (const item of local.context.all()) {
      registerCandidate(
        map,
        {
          origin: "context",
          path: item.path,
          selection: item.selection,
          display: createAttachmentDisplay(item.path, item.selection),
        },
        [item.path, getFilename(item.path)],
      )
    }
    for (const [alias, part] of state.inlineAliases) {
      registerCandidate(
        map,
        {
          origin: part.origin,
          path: part.path,
          selection: part.selection,
          display: part.display ?? createAttachmentDisplay(part.path, part.selection),
        },
        [alias],
      )
    }
    return map
  })

  const parsedPrompt = createMemo(() => parsePrompt(state.promptInput, attachmentLookup()))
  const baseParts = createMemo(() => parsedPrompt().parts)
  const attachmentSegments = createMemo<PromptAttachmentSegment[]>(() =>
    parsedPrompt().segments.filter((segment): segment is PromptAttachmentSegment => segment.kind === "attachment"),
  )

  const {
    mentionResults,
    mentionItems,
    closeMention,
    syncMentionFromCaret,
    updateMentionPosition,
    handlePromptInput,
    handleMentionKeyDown,
    insertMention,
  } = useMentionController({
    state,
    setState,
    attachmentSegments,
    getInputRef: () => inputRef,
    getOverlayRef: () => overlayContainerRef,
    getMeasureRef: () => mentionMeasureRef,
    searchFiles: (query) => local.file.search(query),
    resolveFile: (path) => local.file.node(path) ?? undefined,
    addContextFile: (path, selection) =>
      local.context.add({
        type: "file",
        path,
        selection,
      }),
    getActiveContext: () => local.context.active() ?? undefined,
  })

  const { handlePromptScroll, resetScrollPosition } = usePromptScrollSync({
    state,
    getInputRef: () => inputRef,
    getOverlayRef: () => overlayContainerRef,
    interim: () => (isRecording() ? interimTranscript() : ""),
    updateMentionPosition,
  })

  const displaySegments = createMemo<PromptDisplaySegment[]>(() => {
    const value = state.promptInput
    const segments = parsedPrompt().segments
    const interim = isRecording() ? interimTranscript() : ""
    return composeDisplaySegments(segments, value, interim)
  })

  const hasDisplaySegments = createMemo(() => displaySegments().length > 0)

  function handleAttachmentNavigation(
    event: KeyboardEvent & { currentTarget: HTMLTextAreaElement },
    direction: "left" | "right",
  ) {
    const element = event.currentTarget
    const caret = element.selectionStart ?? 0
    const segments = attachmentSegments()
    if (direction === "left") {
      let match = segments.find((segment) => caret > segment.start && caret <= segment.end)
      if (!match && element.selectionStart !== element.selectionEnd) {
        match = segments.find(
          (segment) => element.selectionStart === segment.start && element.selectionEnd === segment.end,
        )
      }
      if (!match) return false
      event.preventDefault()
      if (element.selectionStart === match.start && element.selectionEnd === match.end) {
        const next = Math.max(0, match.start)
        element.setSelectionRange(next, next)
        syncMentionFromCaret(element)
        return true
      }
      element.setSelectionRange(match.start, match.end)
      syncMentionFromCaret(element)
      return true
    }
    if (direction === "right") {
      let match = segments.find((segment) => caret >= segment.start && caret < segment.end)
      if (!match && element.selectionStart !== element.selectionEnd) {
        match = segments.find(
          (segment) => element.selectionStart === segment.start && element.selectionEnd === segment.end,
        )
      }
      if (!match) return false
      event.preventDefault()
      if (element.selectionStart === match.start && element.selectionEnd === match.end) {
        const next = match.end
        element.setSelectionRange(next, next)
        syncMentionFromCaret(element)
        return true
      }
      element.setSelectionRange(match.start, match.end)
      syncMentionFromCaret(element)
      return true
    }
    return false
  }

  function renderAttachmentChip(part: PromptAttachmentPart, _placeholder: string) {
    const display = part.display ?? createAttachmentDisplay(part.path, part.selection)
    return <span class="truncate max-w-[16ch] text-primary">@{display}</span>
  }

  function renderTextSegment(value: string) {
    if (!value) return undefined
    return <span class="text-text">{value}</span>
  }

  function handlePromptKeyDown(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
    if (event.isComposing) return
    const target = event.currentTarget
    const key = event.key

    const handled = handleMentionKeyDown({
      event,
      mentionItems,
      insertMention,
    })
    if (handled) return

    if (!state.mentionOpen) {
      if (key === "ArrowLeft") {
        if (handleAttachmentNavigation(event, "left")) return
      }
      if (key === "ArrowRight") {
        if (handleAttachmentNavigation(event, "right")) return
      }
    }

    if (key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End") {
      queueMicrotask(() => {
        syncMentionFromCaret(target)
      })
    }

    if (key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      target.form?.requestSubmit()
    }
  }

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault()
    const parts = baseParts()
    const text = parts
      .map((part) => {
        if (part.kind === "text") return part.value
        return `@${part.path}`
      })
      .join("")

    const currentPrompt: PromptSubmitValue = {
      text,
      parts,
    }
    setState("promptInput", "")
    resetScrollPosition()
    if (inputRef) {
      inputRef.blur()
    }

    await props.onSubmit(currentPrompt)
  }

  onCleanup(() => {
    props.onInputRefChange?.(undefined)
  })

  return (
    <form onSubmit={handleSubmit} class={props.class} classList={props.classList}>
      <div
        class="w-full min-w-0 p-2 mx-auto rounded-lg isolate backdrop-blur-xs
               flex flex-col gap-1 bg-gradient-to-b from-background-panel/90 to-background/90
               ring-1 ring-border-active/50 border border-transparent
               focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary
               transition-all duration-200"
        classList={{
          "shadow-[0_0_33px_rgba(0,0,0,0.8)]": !!local.file.active(),
          "ring-2 ring-primary/60 bg-primary/5": state.isDragOver,
        }}
        onDragEnter={(event) => {
          const evt = event as unknown as globalThis.DragEvent
          if (evt.dataTransfer?.types.includes("text/plain")) {
            evt.preventDefault()
            setState("isDragOver", true)
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) {
            setState("isDragOver", false)
          }
        }}
        onDragOver={(event) => {
          const evt = event as unknown as globalThis.DragEvent
          if (evt.dataTransfer?.types.includes("text/plain")) {
            evt.preventDefault()
            evt.dataTransfer.dropEffect = "copy"
          }
        }}
        onDrop={(event) => {
          const evt = event as unknown as globalThis.DragEvent
          evt.preventDefault()
          setState("isDragOver", false)

          const data = evt.dataTransfer?.getData("text/plain")
          if (data && data.startsWith("file:")) {
            const filePath = data.slice(5)
            const fileNode = local.file.node(filePath)
            if (fileNode) {
              local.context.add({
                type: "file",
                path: filePath,
              })
            }
          }
        }}
      >
        <Show when={local.context.all().length > 0 || local.context.active()}>
          <div class="flex flex-wrap gap-1">
            <Show when={local.context.active()}>
              <ActiveTabContextTag file={local.context.active()!} onClose={() => local.context.removeActive()} />
            </Show>
            <For each={local.context.all()}>
              {(file) => <FileTag file={file} onClose={() => local.context.remove(file.key)} />}
            </For>
          </div>
        </Show>
        <div class="relative">
          <textarea
            ref={(element) => {
              inputRef = element ?? undefined
              props.onInputRefChange?.(inputRef)
            }}
            value={state.promptInput}
            onInput={handlePromptInput}
            onKeyDown={handlePromptKeyDown}
            onClick={(event) =>
              queueMicrotask(() => {
                syncMentionFromCaret(event.currentTarget)
              })
            }
            onSelect={(event) =>
              queueMicrotask(() => {
                syncMentionFromCaret(event.currentTarget)
              })
            }
            onBlur={(event) => {
              const next = event.relatedTarget as HTMLElement | null
              if (next && next.closest('[data-mention-popover="true"]')) return
              closeMention()
            }}
            onScroll={handlePromptScroll}
            placeholder={placeholderText}
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
            spellcheck={false}
            class="relative w-full h-20 rounded-md px-0.5 resize-none overflow-y-auto
                   bg-transparent text-transparent caret-text font-light text-base
                   leading-relaxed focus:outline-none selection:bg-primary/20"
          ></textarea>
          <div
            ref={(element) => {
              overlayContainerRef = element ?? undefined
            }}
            class="pointer-events-none absolute inset-0 overflow-hidden"
          >
            <PromptDisplayOverlay
              hasDisplaySegments={hasDisplaySegments()}
              displaySegments={displaySegments()}
              placeholder={placeholderText}
              renderAttachmentChip={renderAttachmentChip}
              renderTextSegment={renderTextSegment}
            />
          </div>
          <div
            ref={(element) => {
              mentionMeasureRef = element ?? undefined
            }}
            class="pointer-events-none invisible absolute inset-0 whitespace-pre-wrap text-base font-light leading-relaxed px-0.5"
            aria-hidden="true"
          ></div>
          <MentionSuggestions
            open={state.mentionOpen}
            anchor={state.mentionAnchorOffset}
            loading={mentionResults.loading}
            items={mentionItems()}
            activeIndex={state.mentionIndex}
            onHover={(index) => setState("mentionIndex", index)}
            onSelect={insertMention}
          />
        </div>
        <div class="flex justify-between items-center text-xs text-text-muted">
          <div class="flex gap-2 items-center">
            <Select
              options={local.agent.list().map((agent) => agent.name)}
              current={local.agent.current().name}
              onSelect={local.agent.set}
              class="uppercase"
            />
            <Button onClick={() => props.onOpenModelSelect()}>
              {local.model.current()?.name ?? "Select model"}
              <Icon name="chevron-down" size={24} class="text-text-muted" />
            </Button>
            <span class="text-text-muted/70 whitespace-nowrap">{local.model.current()?.provider.name}</span>
          </div>
          <div class="flex gap-1 items-center">
            <Show when={isSupported()}>
              <Tooltip value={isRecording() ? "Stop voice input" : "Start voice input"} placement="top">
                <IconButton
                  onClick={async (event: MouseEvent) => {
                    event.preventDefault()
                    if (isRecording()) {
                      stopSpeech()
                    } else {
                      startSpeech()
                    }
                    inputRef?.focus()
                  }}
                  classList={{
                    "text-text-muted": !isRecording(),
                    "text-error! animate-pulse": isRecording(),
                  }}
                  size="xs"
                  variant="ghost"
                >
                  <Icon name="mic" size={16} />
                </IconButton>
              </Tooltip>
            </Show>
            <IconButton class="text-text-muted" size="xs" variant="ghost">
              <Icon name="photo" size={16} />
            </IconButton>
            <IconButton
              class="text-background-panel! bg-primary rounded-full! hover:bg-primary/90 ml-0.5"
              size="xs"
              variant="ghost"
              type="submit"
            >
              <Icon name="arrow-up" size={14} />
            </IconButton>
          </div>
        </div>
      </div>
    </form>
  )
}

const ActiveTabContextTag = (props: { file: LocalFile; onClose: () => void }) => (
  <div
    class="flex items-center bg-background group/tag
           border border-border-subtle/60 border-dashed
           rounded-md text-xs text-text-muted"
  >
    <IconButton class="text-text-muted" size="xs" variant="ghost" onClick={props.onClose}>
      <Icon name="file" class="group-hover/tag:hidden" size={12} />
      <Icon name="close" class="hidden group-hover/tag:block" size={12} />
    </IconButton>
    <div class="pr-1 flex gap-1 items-center">
      <span>{getFilename(props.file.path)}</span>
    </div>
  </div>
)

const FileTag = (props: { file: FileContext; onClose: () => void }) => (
  <div
    class="flex items-center bg-background group/tag
           border border-border-subtle/60
           rounded-md text-xs text-text-muted"
  >
    <IconButton class="text-text-muted" size="xs" variant="ghost" onClick={props.onClose}>
      <FileIcon node={props.file} class="group-hover/tag:hidden size-3!" />
      <Icon name="close" class="hidden group-hover/tag:block" size={12} />
    </IconButton>
    <div class="pr-1 flex gap-1 items-center">
      <span>{getFilename(props.file.path)}</span>
      <Show when={props.file.selection}>
        <span>
          ({props.file.selection!.startLine}-{props.file.selection!.endLine})
        </span>
      </Show>
    </div>
  </div>
)

function PromptDisplayOverlay(props: {
  hasDisplaySegments: boolean
  displaySegments: PromptDisplaySegment[]
  placeholder: string
  renderAttachmentChip: (part: PromptAttachmentPart, placeholder: string) => JSX.Element
  renderTextSegment: (value: string) => JSX.Element | undefined
}) {
  return (
    <div class="px-0.5 text-base font-light leading-relaxed whitespace-pre-wrap text-left">
      <Show when={props.hasDisplaySegments} fallback={<span class="text-text-muted/70">{props.placeholder}</span>}>
        <For each={props.displaySegments}>
          {(segment) => {
            if (segment.kind === "text") {
              return props.renderTextSegment(segment.value)
            }
            if (segment.kind === "attachment") {
              return props.renderAttachmentChip(segment.part, segment.source)
            }
            return (
              <span class="text-text-muted/60 italic">
                {segment.leadingSpace ? ` ${segment.value}` : segment.value}
              </span>
            )
          }}
        </For>
      </Show>
    </div>
  )
}

function MentionSuggestions(props: {
  open: boolean
  anchor: { x: number; y: number }
  loading: boolean
  items: string[]
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (path: string) => void
}) {
  return (
    <Popover open={props.open} modal={false} gutter={8} placement="bottom-start">
      <Popover.Trigger class="hidden" />
      <Popover.Anchor
        class="pointer-events-none absolute top-0 left-0 w-0 h-0"
        style={{ transform: `translate(${props.anchor.x}px, ${props.anchor.y}px)` }}
      />
      <Popover.Portal>
        <Popover.Content
          data-mention-popover="true"
          class="z-50 w-72 max-h-60 overflow-y-auto rounded-md border border-border-subtle/40 bg-background-panel shadow-[0_10px_30px_rgba(0,0,0,0.35)] focus:outline-none"
        >
          <div class="py-1">
            <Show when={props.loading}>
              <div class="flex items-center gap-2 px-3 py-2 text-xs text-text-muted">
                <Icon name="refresh" size={12} class="animate-spin" />
                <span>Searching…</span>
              </div>
            </Show>
            <Show when={!props.loading && props.items.length === 0}>
              <div class="px-3 py-2 text-xs text-text-muted/80">No matching files</div>
            </Show>
            <For each={props.items}>
              {(path, indexAccessor) => {
                const index = indexAccessor()
                const dir = getDirectory(path)
                return (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => props.onHover(index)}
                    onClick={() => props.onSelect(path)}
                    class="w-full px-3 py-2 flex items-center gap-2 rounded-md text-left text-xs transition-colors"
                    classList={{
                      "bg-background-element text-text": index === props.activeIndex,
                      "text-text-muted": index !== props.activeIndex,
                    }}
                  >
                    <FileIcon node={{ path, type: "file" }} class="size-3 shrink-0" />
                    <div class="flex flex-col min-w-0">
                      <span class="truncate">{getFilename(path)}</span>
                      {dir && <span class="truncate text-text-muted/70">{dir}</span>}
                    </div>
                  </button>
                )
              }}
            </For>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

export type {
  PromptAttachmentPart,
  PromptAttachmentSegment,
  PromptContentPart,
  PromptDisplaySegment,
  PromptSubmitValue,
} from "./prompt-form-helpers"

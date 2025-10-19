import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, createResource } from "solid-js"
import { Button, FileIcon, Icon, IconButton, Tooltip } from "@/ui"
import { Select } from "@/components/select"
import { useLocal, useMobile } from "@/context"
import type { FileContext, LocalFile } from "@/context/local"
import { getFilename, getDirectory } from "@/utils"
import { createSpeechRecognition } from "@/utils/speech"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { AutocompleteDropdown, type AutocompleteItem } from "@/components/autocomplete-dropdown"

interface PromptFormProps {
  class?: string
  classList?: Record<string, boolean>
  onSubmit: (prompt: PromptSubmitValue) => Promise<void> | void
  onOpenModelSelect: () => void
  onOpenAgentSelect: () => void
  onInputRefChange?: (element: HTMLTextAreaElement | undefined) => void
  onDragProximity?: (proximity: { isDragging: boolean; nearDockZone: boolean; x: number; y: number }) => void
  onDrop?: () => void
  docked?: boolean
}

export default function PromptForm(props: PromptFormProps) {
  const local = useLocal()
  const mobile = useMobile()

  const [prompt, setPrompt] = createSignal("")
  const [isDragOver, setIsDragOver] = createSignal(false)
  const [uploadedFiles, setUploadedFiles] = createSignal<File[]>([])
  const [autocomplete, setAutocomplete] = createSignal<{
    type: "file" | "command"
    query: string
    position: { top: number; left: number }
    startPos: number
  } | null>(null)

  const [autocompleteItems] = createResource(autocomplete, async (ac) => {
    if (!ac) return []

    if (ac.type === "file") {
      const files = await local.file.search(ac.query)

      const sorted = files.sort((a: string, b: string) => {
        const aFilename = getFilename(a)
        const bFilename = getFilename(b)
        const aIsHidden = aFilename.startsWith(".")
        const bIsHidden = bFilename.startsWith(".")

        if (aIsHidden && !bIsHidden) return 1
        if (!aIsHidden && bIsHidden) return -1
        return 0
      })

      return sorted.slice(0, 10).map((path: string) => ({
        type: "file" as const,
        label: getFilename(path),
        value: path,
        description: getDirectory(path),
      }))
    }

    if (ac.type === "command") {
      const commands = [
        { label: "model", value: "model", description: "Change model" },
        { label: "agent", value: "agent", description: "Change agent" },
      ]
      return commands.filter((c) => c.label.startsWith(ac.query)).map((c) => ({ type: "command" as const, ...c }))
    }

    return []
  })

  let dragCounter = 0

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
  let containerRef!: HTMLDivElement
  let shouldAutoScroll = true
  let isDraggingForm = false
  let dragStartPos = { x: 0, y: 0 }
  let currentTranslate = { x: 0, y: 0 }
  let animationFrameId: number | undefined
  let wasNearDockZone = false

  const modeColors = createMemo(() => {
    const agentName = local.agent.current().name.toLowerCase()

    if (agentName === "build") {
      return {
        ring: "ring-primary/50",
        focusRing: "focus-within:ring-primary/40",
        focusBorder: "focus-within:border-primary",
        button: "bg-primary",
        buttonHover: "hover:bg-primary/90",
      }
    } else if (agentName === "plan") {
      return {
        ring: "ring-secondary/50",
        focusRing: "focus-within:ring-secondary/40",
        focusBorder: "focus-within:border-secondary",
        button: "bg-secondary",
        buttonHover: "hover:bg-secondary/90",
      }
    } else if (agentName === "docs") {
      return {
        ring: "ring-accent/50",
        focusRing: "focus-within:ring-accent/40",
        focusBorder: "focus-within:border-accent",
        button: "bg-accent",
        buttonHover: "hover:bg-accent/90",
      }
    }

    return {
      ring: "ring-border-active/50",
      focusRing: "focus-within:ring-primary/40",
      focusBorder: "focus-within:border-primary",
      button: "bg-primary",
      buttonHover: "hover:bg-primary/90",
    }
  })

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

  const getCaretCoordinates = (element: HTMLTextAreaElement): { top: number; left: number } => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    const lineHeight = parseInt(style.lineHeight || "20")

    return {
      top: rect.top + lineHeight + 5,
      left: rect.left + 10,
    }
  }

  const detectAutocomplete = (value: string, cursorPos: number) => {
    const beforeCursor = value.slice(0, cursorPos)

    const atMatch = beforeCursor.match(/@(\S*)$/)
    if (atMatch) {
      const query = atMatch[1]
      const startPos = cursorPos - atMatch[0].length
      const position = getCaretCoordinates(inputRef!)

      setAutocomplete({
        type: "file",
        query,
        position,
        startPos,
      })
      return
    }

    const slashMatch = value.match(/^\/(\w*)$/)
    if (slashMatch && cursorPos <= slashMatch[0].length) {
      const query = slashMatch[1]
      const position = getCaretCoordinates(inputRef!)

      setAutocomplete({
        type: "command",
        query,
        position,
        startPos: 0,
      })
      return
    }

    setAutocomplete(null)
  }

  const handleAutocompleteSelect = (item: AutocompleteItem) => {
    if (!autocomplete() || !inputRef) return

    const ac = autocomplete()!
    const currentPrompt = prompt()
    const before = currentPrompt.slice(0, ac.startPos)
    const after = currentPrompt.slice(inputRef.selectionStart)

    if (ac.type === "file") {
      const newPrompt = before + "@" + item.label + " " + after
      setPrompt(newPrompt)

      local.context.add({
        type: "file",
        path: item.value,
      })

      const newCursorPos = before.length + item.label.length + 2
      queueMicrotask(() => {
        if (inputRef) {
          inputRef.selectionStart = newCursorPos
          inputRef.selectionEnd = newCursorPos
        }
      })
    } else if (ac.type === "command") {
      const newPrompt = before + after
      setPrompt(newPrompt)

      if (item.value === "model") {
        props.onOpenModelSelect()
      } else if (item.value === "agent") {
        props.onOpenAgentSelect()
      }

      queueMicrotask(() => {
        if (inputRef) {
          inputRef.selectionStart = before.length
          inputRef.selectionEnd = before.length
        }
      })
    }

    setAutocomplete(null)
    inputRef?.focus()
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

  const handleDragStart = (event: MouseEvent) => {
    if (props.docked) return
    const target = event.target as HTMLElement
    if (
      target.closest("textarea") ||
      target.closest("button") ||
      target.closest("input") ||
      target.closest("[role='combobox']") ||
      target.closest("[role='listbox']")
    )
      return

    isDraggingForm = true
    dragStartPos = { x: event.clientX - currentTranslate.x, y: event.clientY - currentTranslate.y }
    containerRef.style.cursor = "grabbing"
    event.preventDefault()
  }

  const handleDragMove = (event: MouseEvent) => {
    if (!isDraggingForm) return
    event.preventDefault()

    if (animationFrameId) return

    animationFrameId = requestAnimationFrame(() => {
      currentTranslate = {
        x: event.clientX - dragStartPos.x,
        y: event.clientY - dragStartPos.y,
      }
      containerRef.style.transform = `translate3d(${currentTranslate.x}px, ${currentTranslate.y}px, 0)`

      const windowWidth = window.innerWidth
      const windowHeight = window.innerHeight
      const isNearRight = event.clientX > windowWidth * 0.75
      const isNearBottom = event.clientY > windowHeight * 0.6
      const nearDockZone = isNearRight && isNearBottom

      wasNearDockZone = nearDockZone

      props.onDragProximity?.({
        isDragging: true,
        nearDockZone,
        x: event.clientX,
        y: event.clientY,
      })

      props.onDragProximity?.({
        isDragging: true,
        nearDockZone,
        x: event.clientX,
        y: event.clientY,
      })

      animationFrameId = undefined
    })
  }

  const handleDragEnd = (event: MouseEvent) => {
    if (!isDraggingForm) return

    console.log("[PromptForm handleDragEnd]", {
      clientX: event.clientX,
      clientY: event.clientY,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      wasNearDockZone,
    })

    isDraggingForm = false
    containerRef.style.cursor = ""

    if (wasNearDockZone) {
      console.log("[PromptForm] Was near dock zone, calling onDrop")
      props.onDrop?.()
    }

    currentTranslate = { x: 0, y: 0 }
    containerRef.style.transform = `translate3d(0px, 0px, 0)`

    wasNearDockZone = false

    props.onDragProximity?.({
      isDragging: false,
      nearDockZone: false,
      x: 0,
      y: 0,
    })
  }

  onMount(async () => {
    document.addEventListener("mousemove", handleDragMove)
    document.addEventListener("mouseup", handleDragEnd)

    // Only set up Tauri drag/drop in desktop environment
    if (typeof window !== "undefined" && "__TAURI__" in window) {
      try {
        const tauriWindow = getCurrentWindow()
        if (tauriWindow) {
          const unlisten = await tauriWindow.onDragDropEvent((e) => {
            switch (e.payload.type) {
              case "enter":
                dragCounter++
                setIsDragOver(true)
                break
              case "over":
                break
              case "drop":
                dragCounter = 0
                setIsDragOver(false)
                if (e.payload.paths && e.payload.paths.length > 0) {
                  const current = uploadedFiles()
                  const available = 5 - current.length
                  if (available <= 0) return
                  Promise.all(
                    e.payload.paths.slice(0, available).map(async (path) => {
                      const response = await fetch(`asset://localhost${path}`)
                      const blob = await response.blob()
                      const fileName = path.split("/").pop() || "file"
                      return new File([blob], fileName, { type: blob.type })
                    }),
                  ).then((files) => {
                    setUploadedFiles([...current, ...files])
                  })
                }
                break
              case "leave":
                dragCounter--
                if (dragCounter === 0) {
                  setIsDragOver(false)
                }
                break
            }
          })

          onCleanup(() => {
            unlisten()
          })
        }
      } catch (error) {
        console.warn("[PromptForm] Tauri drag/drop not available:", error)
      }
    }
  })

  onCleanup(() => {
    document.removeEventListener("mousemove", handleDragMove)
    document.removeEventListener("mouseup", handleDragEnd)
    if (animationFrameId) cancelAnimationFrame(animationFrameId)
    props.onInputRefChange?.(undefined)
  })

  return (
    <form onSubmit={handleSubmit} class={props.class} classList={props.classList}>
      <div
        ref={containerRef}
        onMouseDown={handleDragStart}
        style={{ "touch-action": "none" }}
        class="w-full max-w-xl min-w-0 p-2 mx-auto rounded-2xl isolate backdrop-blur-xs
               flex flex-col gap-1
               bg-gradient-to-b from-background-panel/90 to-background/90
               ring-1 border border-transparent focus-within:ring-2
               will-change-transform z-50"
        classList={{
          "shadow-[0_0_33px_rgba(0,0,0,0.8)]": !props.docked,
          "!ring-4 !ring-primary !bg-primary/20 !border-primary": isDragOver(),
          "cursor-grab": !props.docked,
          "!max-w-none !mx-0": props.docked,
          [modeColors().ring]: true,
          [modeColors().focusRing]: true,
          [modeColors().focusBorder]: true,
        }}
        onDragEnter={(event) => {
          const evt = event as unknown as globalThis.DragEvent
          dragCounter++
          if (evt.dataTransfer?.types.includes("text/plain") || evt.dataTransfer?.types.includes("Files")) {
            evt.preventDefault()
            setState("isDragOver", true)
          }
        }}
        onDragLeave={() => {
          dragCounter--
          if (dragCounter === 0) {
            setIsDragOver(false)
          }
        }}
        onDragOver={(event) => {
          const evt = event as unknown as globalThis.DragEvent
          if (evt.dataTransfer?.types.includes("text/plain") || evt.dataTransfer?.types.includes("Files")) {
            evt.preventDefault()
            evt.dataTransfer.dropEffect = "copy"
          }
        }}
        onDrop={(event) => {
          const evt = event as unknown as globalThis.DragEvent
          evt.preventDefault()
          dragCounter = 0
          setIsDragOver(false)

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
            return
          }

          const files = evt.dataTransfer?.files
          if (files && files.length > 0) {
            const current = uploadedFiles()
            const available = 5 - current.length
            if (available <= 0) return
            const newFiles = Array.from(files).slice(0, available)
            setUploadedFiles([...current, ...newFiles])
          }
        }}
      >
        <Show when={local.context.all().length > 0 || local.context.active() || uploadedFiles().length > 0}>
          <div class="flex flex-wrap gap-1">
            <Show when={local.context.active()}>
              <ActiveTabContextTag file={local.context.active()!} onClose={() => local.context.removeActive()} />
            </Show>
            <For each={local.context.all()}>
              {(file) => <FileTag file={file} onClose={() => local.context.remove(file.key)} />}
            </For>
            <For each={uploadedFiles()}>
              {(file, idx) => (
                <UploadedFileTag
                  file={file}
                  onClose={() => setUploadedFiles((prev) => prev.filter((_, i) => i !== idx()))}
                />
              )}
            </For>
          </div>
        </Show>
        <div class="relative">
          <textarea
            ref={(element) => {
              inputRef = element ?? undefined
              props.onInputRefChange?.(inputRef)
            }}
            value={prompt()}
            onInput={(event) => {
              const value = event.currentTarget.value
              const cursorPos = event.currentTarget.selectionStart
              setPrompt(value)
              detectAutocomplete(value, cursorPos)
            }}
            onKeyDown={handlePromptKeyDown}
            onKeyUp={(event) => {
              const cursorPos = event.currentTarget.selectionStart
              detectAutocomplete(prompt(), cursorPos)
            }}
            onScroll={handlePromptScroll}
            placeholder={placeholderText}
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
            spellcheck={false}
            class="relative w-full h-20 rounded-lg px-0.5 resize-none overflow-y-auto
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
              classList={{
                "text-primary": local.agent.current().name.toLowerCase() === "build",
                "text-secondary": local.agent.current().name.toLowerCase() === "plan",
                "text-accent": local.agent.current().name.toLowerCase() === "docs",
              }}
            />
            <Button
              onClick={() => props.onOpenModelSelect()}
              classList={{
                "text-primary": local.agent.current().name.toLowerCase() === "build",
                "text-secondary": local.agent.current().name.toLowerCase() === "plan",
                "text-accent": local.agent.current().name.toLowerCase() === "docs",
              }}
            >
              {local.model.current()?.name ?? "Select model"}
              <Icon name="chevron-down" size={24} class="text-text-muted" />
            </Button>
            <span class="text-text-muted/70 whitespace-nowrap">{local.model.current()?.provider.name}</span>
          </div>
          <div class="flex gap-0.5 items-center">
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
                  size={mobile.isMobile ? "md" : "xs"}
                  variant="ghost"
                >
                  <Icon name="mic" size={mobile.isMobile ? 32 : 24} />
                </IconButton>
              </Tooltip>
            </Show>
            <Tooltip value="Attach files" placement="top">
              <IconButton
                class="text-text-muted relative"
                size="xs"
                variant="ghost"
                onClick={() => {
                  const input = document.createElement("input")
                  input.type = "file"
                  input.multiple = true
                  input.accept = "image/*,application/pdf,.txt,.md,.json,.xml,.csv"
                  input.onchange = (e) => {
                    const files = (e.target as HTMLInputElement).files
                    if (files && files.length > 0) {
                      const current = uploadedFiles()
                      const available = 5 - current.length
                      if (available <= 0) return
                      const newFiles = Array.from(files).slice(0, available)
                      setUploadedFiles([...current, ...newFiles])
                    }
                  }
                  input.click()
                }}
              >
                <Icon name="photo" size={24} />
                <Show when={uploadedFiles().length > 0}>
                  <span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-background-panel text-[10px] flex items-center justify-center font-medium">
                    {uploadedFiles().length}
                  </span>
                </Show>
              </IconButton>
            </Tooltip>
            <IconButton
              class="text-background-panel! rounded-full! ml-1.5"
              classList={{
                [modeColors().button]: true,
                [modeColors().buttonHover]: true,
              }}
              size={mobile.isMobile ? "md" : "xs"}
              variant="ghost"
              type="submit"
            >
              <Icon name="arrow-up" size={mobile.isMobile ? 28 : 21} />
            </IconButton>
          </div>
        </div>
      </div>
      <Show when={autocomplete() && autocompleteItems()}>
        <AutocompleteDropdown
          items={autocompleteItems() || []}
          position={autocomplete()!.position}
          onSelect={handleAutocompleteSelect}
          onClose={() => setAutocomplete(null)}
        />
      </Show>
    </form>
  )
}

const ActiveTabContextTag = (props: { file: LocalFile; onClose: () => void }) => (
  <div
    class="flex items-center bg-background group/tag
           border border-border-subtle/60 border-dashed
           rounded-lg text-xs text-text-muted"
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
           rounded-lg text-xs text-text-muted"
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

const UploadedFileTag = (props: { file: File; onClose: () => void }) => (
  <div
    class="flex items-center bg-background group/tag
           border border-border-subtle/60
           rounded-lg text-xs text-text-muted"
  >
    <IconButton class="text-text-muted" size="xs" variant="ghost" onClick={props.onClose}>
      <Icon name="file" class="group-hover/tag:hidden" size={12} />
      <Icon name="close" class="hidden group-hover/tag:block" size={12} />
    </IconButton>
    <div class="pr-1 flex gap-1 items-center">
      <span>{props.file.name}</span>
      <span class="text-text-muted/50">({(props.file.size / 1024).toFixed(1)}KB)</span>
    </div>
  </div>
)

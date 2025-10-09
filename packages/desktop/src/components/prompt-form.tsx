import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button, FileIcon, Icon, IconButton, Tooltip } from "@/ui"
import { Select } from "@/components/select"
import { useLocal } from "@/context"
import type { FileContext, LocalFile } from "@/context/local"
import { getFilename } from "@/utils"
import { createSpeechRecognition } from "@/utils/speech"
import { getCurrentWindow } from "@tauri-apps/api/window"

interface PromptFormProps {
  class?: string
  classList?: Record<string, boolean>
  onSubmit: (prompt: string) => Promise<void> | void
  onOpenModelSelect: () => void
  onInputRefChange?: (element: HTMLTextAreaElement | undefined) => void
  onDragProximity?: (proximity: { isDragging: boolean; nearDockZone: boolean; x: number; y: number }) => void
  onDrop?: () => void
  docked?: boolean
}

export default function PromptForm(props: PromptFormProps) {
  const local = useLocal()

  const [prompt, setPrompt] = createSignal("")
  const [isDragOver, setIsDragOver] = createSignal(false)
  const [uploadedFiles, setUploadedFiles] = createSignal<File[]>([])

  let dragCounter = 0

  const placeholderText = "Start typing or speaking..."

  const {
    isSupported,
    isRecording,
    interim: interimTranscript,
    start: startSpeech,
    stop: stopSpeech,
  } = createSpeechRecognition({
    onFinal: (text) => setPrompt((prev) => (prev && !prev.endsWith(" ") ? prev + " " : prev) + text),
  })

  let inputRef: HTMLTextAreaElement | undefined = undefined
  let overlayContainerRef: HTMLDivElement | undefined = undefined
  let containerRef!: HTMLDivElement
  let shouldAutoScroll = true
  let isDraggingForm = false
  let dragStartPos = { x: 0, y: 0 }
  let currentTranslate = { x: 0, y: 0 }
  let animationFrameId: number | undefined
  let wasNearDockZone = false

  const promptContent = createMemo(() => {
    const base = prompt() || ""
    const interim = isRecording() ? interimTranscript() : ""
    if (!base && !interim) {
      return <span class="text-text-muted/70">{placeholderText}</span>
    }
    const needsSpace = base && interim && !base.endsWith(" ") && !interim.startsWith(" ")
    return (
      <>
        <span class="text-text">{base}</span>
        {interim && (
          <span class="text-text-muted/60 italic">
            {needsSpace ? " " : ""}
            {interim}
          </span>
        )}
      </>
    )
  })

  createEffect(() => {
    prompt()
    interimTranscript()
    queueMicrotask(() => {
      if (!inputRef) return
      if (!overlayContainerRef) return
      if (!shouldAutoScroll) {
        overlayContainerRef.scrollTop = inputRef.scrollTop
        return
      }
      scrollPromptToEnd()
    })
  })

  const handlePromptKeyDown = (event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    if (event.isComposing) return
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      inputRef?.form?.requestSubmit()
    }
  }

  const handlePromptScroll = (event: Event & { currentTarget: HTMLTextAreaElement }) => {
    const target = event.currentTarget
    shouldAutoScroll = target.scrollTop + target.clientHeight >= target.scrollHeight - 4
    if (overlayContainerRef) overlayContainerRef.scrollTop = target.scrollTop
  }

  const scrollPromptToEnd = () => {
    if (!inputRef) return
    const maxInputScroll = inputRef.scrollHeight - inputRef.clientHeight
    const next = maxInputScroll > 0 ? maxInputScroll : 0
    inputRef.scrollTop = next
    if (overlayContainerRef) overlayContainerRef.scrollTop = next
    shouldAutoScroll = true
  }

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault()
    const currentPrompt = prompt()
    setPrompt("")
    shouldAutoScroll = true
    if (overlayContainerRef) overlayContainerRef.scrollTop = 0
    if (inputRef) {
      inputRef.scrollTop = 0
      inputRef.blur()
    }

    await props.onSubmit(currentPrompt)
  }

  const handleDragStart = (event: MouseEvent) => {
    if (props.docked) return
    const target = event.target as HTMLElement
    if (target.closest("textarea") || target.closest("button") || target.closest("input")) return

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

    const unlisten = await getCurrentWindow().onDragDropEvent((e) => {
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
        class="w-full max-w-xl min-w-0 p-2 mx-auto rounded-xl isolate backdrop-blur-xs
               flex flex-col gap-1
               bg-gradient-to-b from-background-panel/90 to-background/90
               ring-1 ring-border-active/50 border border-transparent
               focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary
               will-change-transform"
        classList={{
          "shadow-[0_0_33px_rgba(0,0,0,0.8)]": !props.docked,
          "!ring-4 !ring-primary !bg-primary/20 !border-primary": isDragOver(),
          "cursor-grab": !props.docked,
          "!max-w-none !mx-0": props.docked,
        }}
        onDragEnter={(event) => {
          const evt = event as unknown as globalThis.DragEvent
          dragCounter++
          if (evt.dataTransfer?.types.includes("text/plain") || evt.dataTransfer?.types.includes("Files")) {
            evt.preventDefault()
            setIsDragOver(true)
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
            onInput={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={handlePromptKeyDown}
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
            <div class="px-0.5 text-base font-light leading-relaxed whitespace-pre-wrap text-left text-text">
              {promptContent()}
            </div>
          </div>
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
                  size="xs"
                  variant="ghost"
                >
                  <Icon name="mic" size={24} />
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
              class="text-background-panel! bg-primary rounded-full! hover:bg-primary/90 ml-1.5"
              size="xs"
              variant="ghost"
              type="submit"
            >
              <Icon name="arrow-up" size={21} />
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

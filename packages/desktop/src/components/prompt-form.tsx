import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Button, FileIcon, Icon, IconButton, Tooltip } from "@/ui"
import { Select } from "@/components/select"
import { useLocal } from "@/context"
import type { FileContext, LocalFile } from "@/context/local"
import { getFilename } from "@/utils"
import { createSpeechRecognition } from "@/utils/speech"

interface PromptFormProps {
  class?: string
  classList?: Record<string, boolean>
  onSubmit: (prompt: string) => Promise<void> | void
  onOpenModelSelect: () => void
  onInputRefChange?: (element: HTMLTextAreaElement | undefined) => void
}

export default function PromptForm(props: PromptFormProps) {
  const local = useLocal()

  const [prompt, setPrompt] = createSignal("")
  const [isDragOver, setIsDragOver] = createSignal(false)

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
  let shouldAutoScroll = true

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

  onCleanup(() => {
    props.onInputRefChange?.(undefined)
  })

  return (
    <form onSubmit={handleSubmit} class={props.class} classList={props.classList}>
      <div
        class="w-full max-w-xl min-w-0 p-2 mx-auto rounded-lg isolate backdrop-blur-xs
               flex flex-col gap-1
               bg-gradient-to-b from-background-panel/90 to-background/90
               ring-1 ring-border-active/50 border border-transparent
               focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary
               transition-all duration-200"
        classList={{
          "shadow-[0_0_33px_rgba(0,0,0,0.8)]": !!local.file.active(),
          "ring-2 ring-primary/60 bg-primary/5": isDragOver(),
        }}
        onDragEnter={(event) => {
          const evt = event as unknown as globalThis.DragEvent
          if (evt.dataTransfer?.types.includes("text/plain")) {
            evt.preventDefault()
            setIsDragOver(true)
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) {
            setIsDragOver(false)
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
            value={prompt()}
            onInput={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={handlePromptKeyDown}
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

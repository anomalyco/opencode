import { createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlayground } from "@/context/playground"

export function PlaygroundPrompt(props: {
  onSubmit: (text: string) => void
  onStop?: () => void
}) {
  const playground = usePlayground()
  const [text, setText] = createSignal("")
  let input: HTMLTextAreaElement | undefined

  function submit() {
    const value = text().trim()
    if (!value) return
    props.onSubmit(value)
    setText("")
    if (input) input.style.height = "auto"
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function autoResize() {
    if (!input) return
    input.style.height = "auto"
    input.style.height = Math.min(input.scrollHeight, 120) + "px"
  }

  const placeholder = () => {
    const sel = playground.selected
    if (sel) return `Modify ${sel.title || "this app"}...`
    return "What do you want to build?"
  }

  return (
    <div
      class="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-[640px] z-50 px-4"
      data-component="playground-prompt"
    >
      <div class="flex items-end gap-2 bg-background-base border border-border-base rounded-xl shadow-xl px-4 py-3">
        <textarea
          ref={input}
          value={text()}
          onInput={(e) => {
            setText(e.currentTarget.value)
            autoResize()
          }}
          onKeyDown={keydown}
          placeholder={placeholder()}
          rows={1}
          class="flex-1 bg-transparent text-text-base text-14-regular resize-none outline-none placeholder:text-text-dimmed-base min-h-[24px] max-h-[120px] leading-6"
        />
        <Show
          when={!playground.generating}
          fallback={
            <Button variant="ghost" class="shrink-0 w-8 h-8 p-0" onClick={props.onStop}>
              <Icon name="close" size="small" />
            </Button>
          }
        >
          <Button
            variant="ghost"
            class="shrink-0 w-8 h-8 p-0"
            disabled={!text().trim()}
            onClick={submit}
          >
            <Icon name="arrow-up" size="small" />
          </Button>
        </Show>
      </div>
    </div>
  )
}

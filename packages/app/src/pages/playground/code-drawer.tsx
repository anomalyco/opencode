import { createEffect, createSignal, on, Show } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { usePlayground } from "@/context/playground"

export function CodeDrawer() {
  const playground = usePlayground()
  const [code, setCode] = createSignal("")
  let debounce: ReturnType<typeof setTimeout> | undefined

  const sel = () => playground.selected

  createEffect(
    on(
      () => sel()?.code,
      (c) => {
        if (c !== undefined) setCode(c)
      },
    ),
  )

  function onInput(value: string) {
    setCode(value)
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      const s = sel()
      if (!s) return
      playground.updateWindow(s.id, { code: value })
    }, 500)
  }

  function copyCode() {
    void navigator.clipboard.writeText(code())
  }

  function exportHTML() {
    const s = sel()
    if (!s) return
    const blob = new Blob([code()], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${s.title || "app"}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      data-component="playground-code-drawer"
      class="w-[400px] shrink-0 border-l border-border-base bg-background-base flex flex-col overflow-hidden"
    >
      <div class="h-9 shrink-0 flex items-center justify-between px-3 border-b border-border-base">
        <span class="text-12-medium text-text-base truncate">{sel()?.title ?? "Code"}</span>
        <div class="flex items-center gap-0.5">
          <IconButton icon="copy" variant="ghost" class="w-5 h-5" onClick={copyCode} />
          <IconButton icon="download" variant="ghost" class="w-5 h-5" onClick={exportHTML} />
          <IconButton icon="close" variant="ghost" class="w-5 h-5" onClick={() => playground.setPanel("none")} />
        </div>
      </div>
      <Show
        when={sel()}
        fallback={
          <div class="flex items-center justify-center flex-1">
            <p class="text-text-dimmed-base text-12-regular">Select a window to view its code</p>
          </div>
        }
      >
        <textarea
          class="flex-1 bg-background-stronger text-text-base text-12-regular font-mono p-3 resize-none outline-none overflow-auto"
          spellcheck={false}
          value={code()}
          onInput={(e) => onInput(e.currentTarget.value)}
        />
      </Show>
    </div>
  )
}

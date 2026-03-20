import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { monoFontFamily, useSettings } from "@/context/settings"
import { usePlatform } from "@/context/platform"
import { paint } from "@/components/prompt-input/expand"

type DialogPromptEditorProps = {
  text: string
  placeholder: string
  save: (value: string) => void
}

export function DialogPromptEditor(props: DialogPromptEditorProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const settings = useSettings()
  const platform = usePlatform()
  const [state, setState] = createStore({
    text: props.text,
    h: 280,
  })
  const html = createMemo(() => paint(state.text))
  const font = createMemo(() => monoFontFamily(settings.appearance.font()))
  const mod = createMemo(() => (platform.os === "macos" ? "⌘" : language.t("common.key.ctrl")))
  const ref = {
    box: undefined as HTMLTextAreaElement | undefined,
    back: undefined as HTMLDivElement | undefined,
  }

  const fit = () => {
    if (!ref.box) return
    const min = 280
    const max = Math.max(min, Math.min(620, window.innerHeight - 230))
    ref.box.style.height = "0px"
    const next = Math.min(max, Math.max(min, ref.box.scrollHeight))
    ref.box.style.height = ""
    if (state.h !== next) setState("h", next)
  }

  const sync = () => {
    if (!ref.box || !ref.back) return
    ref.back.scrollTop = ref.box.scrollTop
    ref.back.scrollLeft = ref.box.scrollLeft
  }

  const save = () => {
    props.save(state.text)
    dialog.close()
  }

  createEffect(() => {
    state.text
    requestAnimationFrame(() => {
      fit()
      sync()
    })
  })

  createEffect(() => {
    const onResize = () => fit()
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })

  return (
    <Dialog title={<div class="pl-3">{language.t("prompt.editor.title")}</div>} size="x-large" transition>
      <div class="flex min-h-0 flex-1 flex-col gap-4 px-1 pb-1">
        <div
          class="relative overflow-hidden rounded-xl border border-border-weak-base bg-surface-raised-base shadow-xs-border-base"
          style={{
            height: `${state.h}px`,
            "max-height": "min(620px, calc(100dvh - 230px))",
          }}
        >
          <div
            ref={(el) => {
              ref.back = el
            }}
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 overflow-auto px-4 py-3 text-14-mono whitespace-pre-wrap break-words"
            style={{ "font-family": font() }}
          >
            <div class="min-h-full w-full" innerHTML={html()} />
          </div>
          <textarea
            ref={(el) => {
              ref.box = el
            }}
            autofocus
            rows={14}
            spellcheck={false}
            value={state.text}
            placeholder=""
            onInput={(event) => setState("text", event.currentTarget.value)}
            onScroll={sync}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === "Enter") {
                event.preventDefault()
                save()
              }
            }}
            class="absolute inset-0 resize-none overflow-auto px-4 py-3 text-14-mono whitespace-pre-wrap bg-transparent focus:outline-none"
            style={{
              color: "transparent",
              "-webkit-text-fill-color": "transparent",
              "caret-color": "var(--text-strong)",
              "font-family": font(),
            }}
          />
          <div
            class="pointer-events-none absolute inset-x-0 top-0 px-4 py-3 text-14-mono text-text-weak whitespace-pre-wrap"
            classList={{ hidden: state.text.length > 0 }}
            style={{ "font-family": font() }}
          >
            {props.placeholder}
          </div>
        </div>
        <div class="flex items-center justify-between gap-3 rounded-xl border border-border-weak-base bg-surface-raised-base px-3 py-2.5 shadow-xs-border-base">
          <div class="flex items-center gap-2 text-12-medium text-text-weak">
            <span class="rounded-md border border-border-weak-base bg-background-base px-2 py-0.5">{mod()}</span>
            <span class="text-text-subtle">+</span>
            <span class="rounded-md border border-border-weak-base bg-background-base px-2 py-0.5">
              {language.t("common.key.enter")}
            </span>
            <span>{language.t("common.save")}</span>
          </div>
          <div class="flex items-center gap-2">
            <Button size="large" variant="ghost" class="min-w-20" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button size="large" variant="primary" class="min-w-20 shadow-xs-border-base" onClick={save}>
              {language.t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

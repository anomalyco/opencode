import { useFilteredList } from "@opencode-ai/ui/hooks"
import { createEffect, createMemo, createSignal, For, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/ui/markdown"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { monoFontFamily, useSettings } from "@/context/settings"
import { usePlatform } from "@/context/platform"
import { useFile } from "@/context/file"
import { paint } from "@/components/prompt-input/expand"
import { type AtOption } from "@/components/prompt-input/slash-popover"
import { at, mention, pair } from "@/components/dialog-prompt-editor-input"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"

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
  const files = useFile()
  const [state, setState] = createStore({
    text: props.text,
    h: 280,
    preview: false,
  })
  const html = createMemo(() => paint(state.text))
  const font = createMemo(() => monoFontFamily(settings.appearance.font()))
  const mod = createMemo(() => (platform.os === "macos" ? "⌘" : language.t("common.key.ctrl")))
  const [popover, setPopover] = createSignal<"at" | null>(null)
  const [menu, setMenu] = createStore({
    top: 12,
    left: 12,
    max: 320,
  })
  const ref = {
    box: undefined as HTMLTextAreaElement | undefined,
    back: undefined as HTMLDivElement | undefined,
    menu: undefined as HTMLDivElement | undefined,
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

  const togglePreview = () => {
    setState("preview", (value) => !value)
    requestAnimationFrame(() => {
      fit()
      sync()
      refreshAt()
    })
  }

  const place = () => {
    if (!ref.box) return
    const box = ref.box
    const style = window.getComputedStyle(box)
    const mirror = document.createElement("div")
    const before = state.text.slice(0, box.selectionStart ?? 0)
    const value = before.length > 0 ? before : " "

    mirror.style.position = "absolute"
    mirror.style.visibility = "hidden"
    mirror.style.pointerEvents = "none"
    mirror.style.whiteSpace = "pre-wrap"
    mirror.style.wordBreak = "break-word"
    mirror.style.overflowWrap = "break-word"
    mirror.style.font = style.font
    mirror.style.fontFamily = style.fontFamily
    mirror.style.fontSize = style.fontSize
    mirror.style.fontWeight = style.fontWeight
    mirror.style.lineHeight = style.lineHeight
    mirror.style.letterSpacing = style.letterSpacing
    mirror.style.padding = style.padding
    mirror.style.border = style.border
    mirror.style.boxSizing = style.boxSizing
    mirror.style.width = `${box.clientWidth}px`
    mirror.style.maxWidth = `${box.clientWidth}px`
    mirror.textContent = value

    const mark = document.createElement("span")
    mark.textContent = "\u200b"
    mirror.append(mark)
    box.parentElement?.append(mirror)

    const top = mark.offsetTop - box.scrollTop
    const left = mark.offsetLeft - box.scrollLeft
    mirror.remove()

    const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 20
    const padX = Number.parseFloat(style.paddingLeft) || 0
    const padY = Number.parseFloat(style.paddingTop) || 0
    const menuH = ref.menu?.offsetHeight ?? Math.min(320, Math.max(40, atFlat().length * 34 + 16))
    const below = box.clientHeight - (top + padY + line)
    const nextTop = below >= Math.min(menuH, 180) ? top + padY + line + 6 : Math.max(8, top + padY - menuH - 6)
    const nextLeft = Math.max(8, Math.min(left + padX, box.clientWidth - 280))
    const nextMax = Math.max(120, Math.min(320, box.clientHeight - nextTop - 8))

    setMenu({
      top: nextTop,
      left: nextLeft,
      max: nextMax,
    })
  }

  const handleAtSelect = (item: AtOption | undefined) => {
    if (!item || item.type !== "file" || !ref.box) return
    const pos = ref.box.selectionStart ?? state.text.length
    const match = at(state.text, pos)
    if (!match) return
    const next = mention(state.text, match.start, match.end, item.path)
    setState("text", next.text)
    setPopover(null)
    requestAnimationFrame(() => {
      if (!ref.box) return
      ref.box.focus()
      ref.box.setSelectionRange(next.start, next.end)
      sync()
    })
  }

  const atKey = (item: AtOption | undefined) => {
    if (!item) return ""
    return item.type === "agent" ? `agent:${item.name}` : `file:${item.path}`
  }

  const {
    flat: atFlat,
    active: atActive,
    setActive: setAtActive,
    onInput: atOnInput,
    onKeyDown: atOnKeyDown,
  } = useFilteredList<AtOption>({
    items: async (query) =>
      (await files.searchFilesAndDirectories(query)).map((path) => ({ type: "file", path, display: path })),
    key: atKey,
    filterKeys: ["display"],
    onSelect: handleAtSelect,
  })
  const shown = createMemo(() => atFlat().slice(0, 6))

  const refreshAt = () => {
    if (!ref.box) return
    const match = at(state.text, ref.box.selectionStart ?? 0)
    if (!match) {
      setPopover(null)
      return
    }
    atOnInput(match.query)
    setPopover("at")
    requestAnimationFrame(place)
  }

  const reveal = () => {
    const root = ref.menu
    if (!root) return
    const key = atActive()
    if (!key) return
    const node = root.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)
    node?.scrollIntoView({ block: "nearest" })
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

  createEffect(() => {
    if (popover() !== "at") return
    atFlat()
    requestAnimationFrame(place)
  })

  createEffect(() => {
    if (popover() !== "at") return
    atActive()
    requestAnimationFrame(reveal)
  })

  return (
    <Dialog
      title={<div class="pl-3">{language.t("prompt.editor.title")}</div>}
      size="x-large"
      transition
      containerStyle={{
        width: state.preview ? "min(calc(100vw - 32px), 1240px)" : "min(calc(100vw - 32px), 960px)",
        transition: "width 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div class="flex min-h-0 flex-1 flex-col gap-4 px-1 pb-1">
        <div
          class="relative overflow-hidden rounded-xl border border-border-weak-base bg-surface-raised-base shadow-xs-border-base"
          classList={{
            "grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-none":
              state.preview,
          }}
          style={{
            height: `${state.h}px`,
            "max-height": "min(620px, calc(100dvh - 230px))",
          }}
        >
          <div class="relative h-full min-h-0 min-w-0 overflow-hidden">
            <div
              ref={(el) => {
                ref.menu = el
              }}
              class="absolute z-20 min-h-10 w-[min(560px,calc(100%-16px))] overflow-auto no-scrollbar rounded-[12px] border border-white/10 p-2 shadow-[var(--shadow-lg-border-base)]"
              classList={{ hidden: popover() !== "at" }}
              style={{
                top: `${menu.top}px`,
                left: `${menu.left}px`,
                "max-height": `${menu.max}px`,
                "background-color":
                  platform.platform === "desktop" && platform.os === "windows"
                    ? "var(--surface-raised-stronger-non-alpha)"
                    : "rgb(12 12 14 / 0.34)",
                "backdrop-filter":
                  platform.platform === "desktop" && platform.os === "windows" ? "none" : "blur(40px) saturate(150%)",
                "-webkit-backdrop-filter":
                  platform.platform === "desktop" && platform.os === "windows" ? "none" : "blur(40px) saturate(150%)",
              }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <div classList={{ hidden: atFlat().length > 0 }} class="px-2 py-1 text-text-weak">
                {language.t("prompt.popover.emptyResults")}
              </div>
              <For each={shown()}>
                {(item) => {
                  if (item.type !== "file") return null
                  const key = atKey(item)
                  const dir = item.path.endsWith("/") ? item.path : getDirectory(item.path)
                  const file = item.path.endsWith("/") ? "" : getFilename(item.path)
                  return (
                    <button
                      data-key={key}
                      class="flex w-full items-center gap-x-2 rounded-md px-2 py-0.5"
                      classList={{ "bg-surface-raised-base-active": atActive() === key }}
                      onClick={() => handleAtSelect(item)}
                      onMouseEnter={() => setAtActive(key)}
                    >
                      <FileIcon
                        node={{ path: item.path, type: item.path.endsWith("/") ? "directory" : "file" }}
                        class="size-4 shrink-0"
                      />
                      <div class="min-w-0 flex items-center text-14-regular">
                        <span class="min-w-0 truncate whitespace-nowrap text-text-weak">{dir}</span>
                        <span class="whitespace-nowrap text-text-strong">{file}</span>
                      </div>
                    </button>
                  )
                }}
              </For>
            </div>
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
              onInput={(event) => {
                setState("text", event.currentTarget.value)
                refreshAt()
              }}
              onScroll={() => {
                sync()
                if (popover() === "at") requestAnimationFrame(place)
              }}
              onClick={refreshAt}
              onKeyUp={refreshAt}
              onKeyDown={(event) => {
                if (popover()) {
                  if (event.key === "Tab") {
                    const item = atFlat().find((entry) => atKey(entry) === atActive()) ?? atFlat()[0]
                    if (item) handleAtSelect(item)
                    event.preventDefault()
                    return
                  }

                  const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
                  const ctrl =
                    event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === "n" || event.key === "p")
                  if (nav || ctrl) {
                    atOnKeyDown(event)
                    event.preventDefault()
                    return
                  }

                  if (event.key === "Escape") {
                    setPopover(null)
                    event.preventDefault()
                    return
                  }
                }

                if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === "Enter") {
                  event.preventDefault()
                  save()
                  return
                }

                const next = pair({
                  text: state.text,
                  start: event.currentTarget.selectionStart ?? 0,
                  end: event.currentTarget.selectionEnd ?? 0,
                  key: event.key,
                })
                if (!next) return
                event.preventDefault()
                setState("text", next.text)
                setPopover(null)
                requestAnimationFrame(() => {
                  if (!ref.box) return
                  ref.box.setSelectionRange(next.start, next.end)
                  sync()
                  refreshAt()
                })
              }}
              onBlur={() => {
                window.setTimeout(() => setPopover(null), 120)
              }}
              onFocus={() => {
                refreshAt()
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
          <div
            class="min-h-0 min-w-0 overflow-auto border-t border-border-weak-base bg-background-base/35 px-5 py-4 md:border-l md:border-t-0"
            classList={{ hidden: !state.preview }}
          >
            <div class="mb-3 flex items-center gap-2 text-11-medium uppercase tracking-[0.08em] text-text-weak">
              <Icon name="eye" size="small" class="text-icon-weak" />
              <span>{language.t("prompt.editor.preview")}</span>
            </div>
            <Markdown text={state.text} math="full" highlight="defer" class="text-14-regular" />
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
            <Button
              size="large"
              variant={state.preview ? "secondary" : "ghost"}
              class="min-w-20"
              icon={state.preview ? "layout-right-full" : "layout-right-partial"}
              onClick={togglePreview}
            >
              {language.t(state.preview ? "prompt.editor.hidePreview" : "prompt.editor.showPreview")}
            </Button>
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

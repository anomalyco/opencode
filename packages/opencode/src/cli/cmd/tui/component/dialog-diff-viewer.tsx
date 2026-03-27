import { TextAttributes, type ParsedKey, ScrollBoxRenderable } from "@opentui/core"
import { $ } from "bun"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useKV } from "@tui/context/kv"
import { useKeybind } from "@tui/context/keybind"
import { filetype } from "@tui/util/filetype"
import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js"

type Mode = "unified" | "side-by-side"
type Item = {
  path: string
  added: number
  removed: number
  status: "added" | "deleted" | "modified"
}

const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null"

async function source(item: Item, cwd: string) {
  if (item.status === "added") {
    return $`git -c core.quotepath=false diff --no-index -- ${nullDevice} ${item.path}`
      .cwd(cwd)
      .quiet()
      .nothrow()
      .text()
  }
  return $`git -c core.quotepath=false diff HEAD -- ${item.path}`.cwd(cwd).quiet().nothrow().text()
}

function style(item: Item) {
  if (item.status === "added") return "A"
  if (item.status === "deleted") return "D"
  return "M"
}

export function DialogDiffViewer() {
  const { theme, syntax } = useTheme()
  const dialog = useDialog()
  const renderer = useRenderer()
  const sdk = useSDK()
  const sync = useSync()
  const kv = useKV()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()

  const [files, setFiles] = createSignal<Item[]>([])
  const [selected, setSelected] = createSignal(0)
  const [loading, setLoading] = createSignal(true)
  const [output, setOutput] = createSignal("")
  const [rendering, setRendering] = createSignal(false)
  const [mode, setMode] = kv.signal<Mode>("diff_viewer_mode", "unified")
  const cache = new Map<string, string>()

  const cwd = createMemo(() => sync.data.path.directory)
  const current = createMemo(() => files()[selected()])
  const ft = createMemo(() => filetype(current()?.path ?? ""))
  const view = createMemo(() => {
    if (mode() !== "side-by-side") return "unified"
    return current()?.status === "modified" ? "split" : "unified"
  })
  const summary = createMemo(() => {
    return files().reduce(
      (acc, item) => {
        if (item.status === "added") acc.added += 1
        if (item.status === "deleted") acc.deleted += 1
        if (item.status === "modified") acc.modified += 1
        return acc
      },
      { added: 0, deleted: 0, modified: 0 },
    )
  })

  let list: ScrollBoxRenderable | undefined
  let preview: ScrollBoxRenderable | undefined

  function move(step: number) {
    const total = files().length
    if (!total) return
    let next = selected() + step
    if (next < 0) next = total - 1
    if (next >= total) next = 0
    setSelected(next)
  }

  function toggleMode() {
    setMode((prev) => (prev === "unified" ? "side-by-side" : "unified"))
  }

  function scrollPreview(evt: ParsedKey) {
    if (!preview) return
    if (evt.name === "home") {
      preview.scrollTo(0)
      return
    }
    if (evt.name === "end") {
      preview.scrollBy(100000)
      return
    }
    if (evt.name === "pageup") {
      preview.scrollBy(-Math.max(1, Math.floor(preview.height / 2)))
      return
    }
    if (evt.name === "pagedown") {
      preview.scrollBy(Math.max(1, Math.floor(preview.height / 2)))
    }
  }

  function scrollLine(step: number) {
    if (!preview) return
    preview.scrollBy(step)
  }

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return

    if (evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      renderer.clearSelection()
      dialog.clear()
      return
    }

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      move(-1)
      return
    }

    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      move(1)
      return
    }

    if (evt.name === "tab" && !evt.shift) {
      evt.preventDefault()
      move(1)
      return
    }

    if (evt.name === "tab" && evt.shift) {
      evt.preventDefault()
      move(-1)
      return
    }

    if (keybind.match("variant_cycle", evt)) {
      evt.preventDefault()
      toggleMode()
      return
    }

    if (keybind.match("diff_viewer_scroll_up", evt)) {
      evt.preventDefault()
      scrollLine(-1)
      return
    }

    if (keybind.match("diff_viewer_scroll_down", evt)) {
      evt.preventDefault()
      scrollLine(1)
      return
    }

    if (evt.name === "pageup" || evt.name === "pagedown" || evt.name === "home" || evt.name === "end") {
      evt.preventDefault()
      scrollPreview(evt)
    }
  })

  createEffect(() => {
    const selectedIndex = selected()
    const target = list?.getChildren().find((x) => x.id === `diff-file-${selectedIndex}`)
    if (!target || !list) return

    const y = target.y - list.y
    if (y < 0) list.scrollBy(y)
    if (y >= list.height) list.scrollBy(y - list.height + 1)
  })

  onMount(async () => {
    dialog.setSize("fullscreen")
    const result = await sdk.client.file.status()
    const changed = (result.data ?? []).toSorted((a, b) => a.path.localeCompare(b.path))
    setFiles(changed)
    setLoading(false)
  })

  let token = 0
  createEffect(async () => {
    const item = current()
    const directory = cwd()

    if (!directory) return
    if (!item) {
      setOutput("")
      return
    }

    const key = `${directory}:${item.path}`
    const cached = cache.get(key)
    if (cached !== undefined) {
      setOutput(cached)
      preview?.scrollTo(0)
      return
    }

    const id = ++token
    setRendering(true)

    const raw = await source(item, directory)
    if (id !== token) return

    const text = raw.trim() ? raw : ""
    if (id !== token) return
    cache.set(key, text)
    setOutput(text)
    setRendering(false)
    preview?.scrollTo(0)
  })

  return (
    <box gap={1} paddingBottom={1} height="100%">
      <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Diff Viewer ({mode()})
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={loading()}>
        <box paddingLeft={2}>
          <text fg={theme.textMuted}>Loading changed files...</text>
        </box>
      </Show>

      <Show when={!loading()}>
        <box flexDirection="row" gap={1} flexGrow={1}>
          <box width={34} height="100%" border={true} borderColor={theme.border} paddingLeft={1} paddingRight={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.text}>Files</text>
              <text fg={theme.textMuted}>{files().length}</text>
            </box>
            <Show when={files().length === 0}>
              <text fg={theme.textMuted}>No changes</text>
            </Show>
            <Show when={files().length > 0}>
              <scrollbox
                height="100%"
                scrollbarOptions={{ visible: false }}
                ref={(r) => {
                  list = r
                }}
                flexGrow={1}
              >
                <For each={files()}>
                  {(item, i) => (
                    <box
                      id={`diff-file-${i()}`}
                      flexDirection="row"
                      justifyContent="space-between"
                      backgroundColor={i() === selected() ? theme.backgroundMenu : undefined}
                    >
                      <text fg={theme.text} wrapMode="none">
                        [{style(item)}] {item.path}
                      </text>
                      <box flexDirection="row" gap={1}>
                        <text fg={theme.diffHighlightAdded}>+{item.added}</text>
                        <text fg={theme.diffHighlightRemoved}>-{item.removed}</text>
                      </box>
                    </box>
                  )}
                </For>
              </scrollbox>
            </Show>
          </box>

          <box flexGrow={1} height="100%" border={true} borderColor={theme.border} paddingLeft={1} paddingRight={1}>
            <scrollbox
              height="100%"
              verticalScrollbarOptions={{
                visible: true,
                trackOptions: {
                  backgroundColor: theme.background,
                  foregroundColor: theme.borderActive,
                },
              }}
              horizontalScrollbarOptions={{ visible: false }}
              ref={(r) => {
                preview = r
              }}
              flexGrow={1}
            >
              <Show
                when={output()}
                fallback={
                  <box paddingLeft={1} paddingTop={1}>
                    <text fg={theme.text}>{current()?.path}</text>
                    <text fg={theme.textMuted}>No text diff available for this file.</text>
                  </box>
                }
              >
                <diff
                  diff={output()}
                  view={view()}
                  filetype={ft()}
                  syntaxStyle={syntax()}
                  showLineNumbers={true}
                  width="100%"
                  wrapMode="word"
                  fg={theme.text}
                  addedBg={theme.diffAddedBg}
                  removedBg={theme.diffRemovedBg}
                  contextBg={theme.diffContextBg}
                  addedSignColor={theme.diffHighlightAdded}
                  removedSignColor={theme.diffHighlightRemoved}
                  lineNumberFg={theme.diffLineNumber}
                  lineNumberBg={theme.diffContextBg}
                  addedLineNumberBg={theme.diffAddedLineNumberBg}
                  removedLineNumberBg={theme.diffRemovedLineNumberBg}
                />
              </Show>
            </scrollbox>
          </box>
        </box>
      </Show>

      <box paddingLeft={2} paddingRight={2} flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>
          [M] modified [A] added [D] deleted | M:{summary().modified} A:{summary().added} D:{summary().deleted}
        </text>
        <text fg={theme.textMuted}>
          files: up/down ctrl+p/n tab | diff: {keybind.print("diff_viewer_scroll_up")}/
          {keybind.print("diff_viewer_scroll_down")} pgup/pgdn home/end | {keybind.print("variant_cycle")} view
          <Show when={rendering()}> rendering...</Show>
        </text>
      </box>
    </box>
  )
}

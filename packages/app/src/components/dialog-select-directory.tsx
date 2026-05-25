import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { getFilename } from "@opencode-ai/core/util/path"
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { DomainId } from "@/pages/layout/extra-agents"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  domain?: DomainId
  onSelect: (result: string | string[] | null) => void
}

type BrowseEntry = {
  name: string
  path: string
}

type BrowseRow =
  | { type: "up"; key: string; name: string; path: string | null }
  | { type: "directory"; key: string; name: string; path: string }

export function findDirectoryCompletionRow(rows: BrowseRow[], highlightedIndex: number) {
  const highlighted = rows[highlightedIndex]
  if (highlighted?.type === "directory") return highlighted
  return rows.find((row) => row.type === "directory")
}

function cleanInput(value: string) {
  const first = (value ?? "").split(/\r?\n/)[0] ?? ""
  return first.replace(/[\u0000-\u001F\u007F]/g, "").trim()
}

function normalizePath(input: string) {
  const v = input.replaceAll("\\", "/")
  if (v.startsWith("//") && !v.startsWith("///")) return "//" + v.slice(2).replace(/\/+/g, "/")
  return v.replace(/\/+/g, "/")
}

function normalizeDriveRoot(input: string) {
  const v = normalizePath(input)
  if (/^[A-Za-z]:$/.test(v)) return v + "/"
  return v
}

function trimTrailing(input: string) {
  const v = normalizeDriveRoot(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v
  return v.replace(/\/+$/, "")
}

function hasTrailingSeparator(value: string) {
  return value.endsWith("/")
}

function rootOf(input: string) {
  const v = normalizeDriveRoot(input)
  if (v.startsWith("//")) return "//"
  if (v.startsWith("/")) return "/"
  if (/^[A-Za-z]:\//.test(v)) return v.slice(0, 3)
  return ""
}

function parentOf(input: string) {
  const v = trimTrailing(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v

  const i = v.lastIndexOf("/")
  if (i <= 0) return "/"
  if (i === 2 && /^[A-Za-z]:/.test(v)) return v.slice(0, 3)
  return v.slice(0, i)
}

function childOf(base: string, child: string) {
  const b = trimTrailing(base)
  const c = child.replace(/^\/+|\/+$/g, "")
  if (!b) return c
  if (!c) return b
  if (b === "//") return "//" + c
  if (b.endsWith("/")) return b + c
  return b + "/" + c
}

function tildeOf(absolute: string, home: string) {
  const full = trimTrailing(absolute)
  if (!home) return ""

  const hn = trimTrailing(home)
  const lc = full.toLowerCase()
  const hc = hn.toLowerCase()
  if (lc === hc) return "~"
  if (lc.startsWith(hc + "/")) return "~" + full.slice(hn.length)
  return ""
}

function withTrailing(value: string) {
  if (!value) return value
  if (value.endsWith("/")) return value
  return value + "/"
}

function browseDirectoryPath(value: string) {
  const input = normalizeDriveRoot(value)
  if (!input || hasTrailingSeparator(input)) return input
  const i = input.lastIndexOf("/")
  if (i < 0) return ""
  return input.slice(0, i + 1)
}

function browseLeaf(value: string) {
  const input = normalizeDriveRoot(value)
  if (!input || hasTrailingSeparator(input)) return ""
  const i = input.lastIndexOf("/")
  if (i < 0) return input
  return input.slice(i + 1)
}

function browseParentPath(value: string) {
  const trimmed = trimTrailing(cleanInput(value))
  if (!trimmed || trimmed === "~" || trimmed === "~/" || trimmed === "/") return null
  const i = trimmed.lastIndexOf("/")
  if (i < 0) return null
  if (trimmed.startsWith("~/") && i <= 1) return "~/"
  if (i === 0) return "/"
  return withTrailing(trimmed.slice(0, i))
}

function resolveBrowsePath(base: string, relative: string) {
  let current = trimTrailing(base)
  const parts = relative.split("/").filter((x) => x && x !== ".")
  for (const part of parts) {
    current = part === ".." ? parentOf(current) : childOf(current, part)
  }
  return current
}

function displayToAbsolute(value: string, home: string, base: string) {
  const input = cleanInput(value)
  if (!input || input === "~") return trimTrailing(home || base)
  if (input.startsWith("~/")) return trimTrailing(childOf(home || base, input.slice(2)))
  if (rootOf(input)) return trimTrailing(input)
  return trimTrailing(resolveBrowsePath(base || home, input))
}

function absoluteToDisplay(path: string, home: string) {
  const full = trimTrailing(path)
  return tildeOf(full, home) || full
}

function isPrimaryModifier(event: KeyboardEvent) {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  props.domain
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()

  let inputRef: HTMLInputElement | undefined
  const rowRefs = new Map<string, HTMLButtonElement>()
  const [showHidden, setShowHidden] = createSignal(true)
  const [highlightedIndex, setHighlightedIndex] = createSignal(0)
  const [error, setError] = createSignal("")
  const [selecting, setSelecting] = createSignal(false)
  const [resolvedHome, setResolvedHome] = createSignal("")
  const home = createMemo(() => resolvedHome())
  const [query, setQuery] = createSignal("~/")

  createEffect(() => {
    query()
    const input = inputRef
    if (!input) return
    queueMicrotask(() => {
      input.scrollLeft = input.scrollWidth
    })
  })

  const browseDisplayPath = createMemo(() => browseDirectoryPath(query()))
  const browseFilter = createMemo(() => browseLeaf(query()))
  const localPath = (value: string) => {
    const h = home()
    const input = cleanInput(value)
    if (!h && (input === "~" || input.startsWith("~/"))) return input
    return displayToAbsolute(input, h, h)
  }
  const browseAbsolutePath = createMemo(() => localPath(browseDisplayPath()))
  const targetPath = createMemo(() => localPath(query()))

  const [entries] = createResource(
    browseAbsolutePath,
    async (directory) => {
      if (!directory || !platform.listLocalDirectory) return [] as BrowseEntry[]
      const list = await platform.listLocalDirectory(directory).catch(() => [])
      const directories = list
        .filter((item) => item.kind === "directory")
        .map((item) => ({
          name: getFilename(item.path),
          path: trimTrailing(normalizeDriveRoot(item.path)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      if (!resolvedHome() && browseDisplayPath().startsWith("~/") && directories[0]) {
        setResolvedHome(parentOf(directories[0].path))
      }
      return directories
    },
    { initialValue: [] as BrowseEntry[] },
  )

  const filteredEntries = createMemo(() => {
    const needle = browseFilter().toLowerCase()
    const includeHidden = showHidden() || needle.startsWith(".")
    return (entries.latest ?? []).filter((entry) => {
      if (!includeHidden && entry.name.startsWith(".")) return false
      return entry.name.toLowerCase().startsWith(needle)
    })
  })

  const rows = createMemo<BrowseRow[]>(() => {
    const next: BrowseRow[] = []
    const parent = browseParentPath(query())
    if (parent) next.push({ type: "up", key: "up", name: "..", path: parent })
    for (const entry of filteredEntries()) {
      next.push({ type: "directory", key: entry.path, name: entry.name, path: entry.path })
    }
    return next
  })

  createEffect(() => {
    query()
    rows().length
    setHighlightedIndex(0)
    setError("")
  })

  createEffect(() => {
    const row = rows()[highlightedIndex()]
    if (!row) return
    rowRefs.get(row.key)?.scrollIntoView({ block: "nearest" })
  })

  function browseToDisplayPath(path: string) {
    setQuery(withTrailing(path))
    inputRef?.focus()
  }

  function browseToEntry(entry: BrowseEntry) {
    setQuery(withTrailing(`${browseDisplayPath()}${entry.name}`))
    inputRef?.focus()
  }

  function executeRow(row: BrowseRow | undefined) {
    if (!row) return
    if (row.type === "up") {
      if (row.path) browseToDisplayPath(row.path)
      return
    }
    browseToEntry(row)
  }

  function completeDirectoryFromRows() {
    const row = findDirectoryCompletionRow(rows(), highlightedIndex())
    if (!row) return false
    browseToEntry(row)
    return true
  }

  async function resolve(absolute: string) {
    if (!absolute || selecting()) return
    setSelecting(true)
    setError("")
    try {
      if (platform.filterDirectories) {
        const [valid] = await platform.filterDirectories([absolute])
        if (!valid) {
          setError(language.t("dialog.directory.empty"))
          return
        }
        props.onSelect(props.multiple ? [valid] : valid)
        dialog.close()
        return
      }
      props.onSelect(props.multiple ? [absolute] : absolute)
      dialog.close()
    } finally {
      setSelecting(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab" && !event.shiftKey) {
      if (completeDirectoryFromRows()) event.preventDefault()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.min(rows().length - 1, index + 1))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault()
      if (isPrimaryModifier(event)) {
        void resolve(targetPath())
        return
      }
      executeRow(rows()[highlightedIndex()])
      return
    }
    if (event.key === "Backspace" && query() === "") {
      event.preventDefault()
      dialog.close()
    }
  }

  const selectedLabel = createMemo(() => absoluteToDisplay(targetPath(), home()))
  const submitModifier = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"

  return (
    <Dialog
      title={props.title ?? language.t("command.project.open")}
      description={language.t("dialog.directory.search.placeholder")}
      class="w-full max-w-[720px]"
    >
      <div class="flex min-h-[520px] flex-col gap-3">
        <div class="relative">
          <div class="pointer-events-none absolute left-3 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center text-icon-weak">
            <Icon name="folder-add-left" size="small" />
          </div>
          <input
            ref={(node) => {
              inputRef = node
            }}
            autofocus
            value={query()}
            onInput={(event) => setQuery(normalizePath(event.currentTarget.value))}
            onKeyDown={handleKeyDown}
            spellcheck={false}
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            class="h-10 w-full rounded-lg border border-border-weak-base bg-transparent pl-10 pr-36 font-mono text-14-regular text-text-strong outline-none focus:border-border-base"
          />
          <Button
            size="small"
            variant="secondary"
            class="absolute right-1.5 top-1/2 h-7 -translate-y-1/2"
            disabled={selecting() || !targetPath()}
            onMouseDown={(event: MouseEvent) => event.preventDefault()}
            onClick={() => void resolve(targetPath())}
          >
            {language.t("session.new.genericagent.cwd.choose")}
          </Button>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden rounded-xl border border-border-weak-base bg-surface-raised-base">
          <div class="flex items-center justify-between gap-4 border-b border-border-weak-base px-4 py-2 text-11-regular text-text-weak">
            <span class="uppercase tracking-wide">{language.t("session.new.meta.directory")}</span>
            <label class="flex items-center gap-2 normal-case tracking-normal">
              <input
                type="checkbox"
                checked={showHidden()}
                onChange={(event) => setShowHidden(event.currentTarget.checked)}
              />
              <span>{language.t("dialog.directory.showHidden")}</span>
            </label>
          </div>
          <div class="max-h-[420px] overflow-y-auto p-2">
            <Show
              when={!entries.loading}
              fallback={<div class="py-10 text-center text-13-regular text-text-weak">{language.t("common.loading")}</div>}
            >
              <Show
                when={rows().length > 0}
                fallback={<div class="py-10 text-center text-13-regular text-text-weak">{language.t("dialog.directory.empty")}</div>}
              >
                <div class="space-y-0.5">
                  <For each={rows()}>
                    {(row, index) => (
                      <button
                        ref={(node) => {
                          if (node) rowRefs.set(row.key, node)
                          else rowRefs.delete(row.key)
                        }}
                        type="button"
                        onMouseEnter={() => setHighlightedIndex(index())}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => executeRow(row)}
                        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-14-regular transition-colors focus:outline-none"
                        classList={{
                          "bg-surface-active-base text-text-strong": highlightedIndex() === index(),
                          "text-text-base hover:bg-surface-hover-base": highlightedIndex() !== index(),
                        }}
                      >
                        <Show
                          when={row.type === "directory"}
                          fallback={<Icon name="chevron-left" size="small" class="shrink-0 text-icon-weak" />}
                        >
                          <FileIcon node={{ path: row.path ?? "", type: "directory" }} class="shrink-0 size-4" />
                        </Show>
                        <span class="min-w-0 flex-1 truncate">{row.name}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>

        <Show when={error()}>
          <div class="text-12-regular text-danger-base">{error()}</div>
        </Show>

        <div class="flex items-center justify-between gap-3 text-12-regular text-text-weak">
          <div class="flex min-w-0 items-center gap-2">
            <span>{selectedLabel()}</span>
          </div>
          <div class="flex shrink-0 items-center gap-4">
            <span>↑↓ {language.t("dialog.directory.footer.navigate")}</span>
            <span>Enter {language.t("common.open")}</span>
            <span>{submitModifier}+Enter {language.t("dialog.directory.footer.select")}</span>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

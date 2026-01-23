import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import fuzzysort from "fuzzysort"
import { createMemo } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sync = useGlobalSync()
  const sdk = useGlobalSDK()
  const dialog = useDialog()
  const language = useLanguage()

  const home = createMemo(() => sync.data.path.home)

  const start = createMemo(() => sync.data.path.home || sync.data.path.directory)

  function normalize(input: string) {
    const v = input.replaceAll("\\", "/")
    if (v.startsWith("//") && !v.startsWith("///")) return "//" + v.slice(2).replace(/\/+/g, "/")
    return v.replace(/\/+/g, "/")
  }

  function normalizeDriveRoot(input: string) {
    const v = normalize(input)
    if (/^[A-Za-z]:$/.test(v)) return v + "/"
    return v
  }

  function trimTrailing(input: string) {
    const v = normalizeDriveRoot(input)
    if (v === "/") return v
    if (/^[A-Za-z]:\/$/.test(v)) return v
    return v.replace(/\/+$/, "")
  }

  function join(base: string | undefined, rel: string) {
    const b = trimTrailing(base ?? "")
    const r = trimTrailing(rel).replace(/^\/+/, "")
    if (!b) return r
    if (!r) return b
    if (b.endsWith("/")) return b + r
    return b + "/" + r
  }

  function rootOf(input: string) {
    const v = normalizeDriveRoot(input)
    if (v.startsWith("//")) return "//"
    if (v.startsWith("/")) return "/"
    if (/^[A-Za-z]:\//.test(v)) return v.slice(0, 3)
    return ""
  }

  function isRoot(input: string) {
    const v = trimTrailing(input)
    if (v === "/") return true
    return /^[A-Za-z]:\/$/.test(v)
  }

  function display(path: string) {
    const full = trimTrailing(path)
    const h = home()
    if (!h) return full

    const hn = trimTrailing(h)
    const lc = full.toLowerCase()
    const hc = hn.toLowerCase()
    if (lc === hc) return "~"
    if (lc.startsWith(hc + "/")) return "~" + full.slice(hn.length)
    return full
  }

  function parse(filter: string) {
    const base = start()
    if (!base) return

    const raw = normalizeDriveRoot(filter.trim())
    if (!raw) return { directory: trimTrailing(base), query: "" }

    const h = home()
    const expanded = raw === "~" ? h : raw.startsWith("~/") ? (h ? join(h, raw.slice(2)) : raw.slice(2)) : raw
    const absolute = rootOf(expanded) ? expanded : join(base, expanded)
    const abs = normalizeDriveRoot(absolute)

    if (abs.endsWith("/")) return { directory: trimTrailing(abs), query: "" }
    const i = abs.lastIndexOf("/")
    if (i === -1) return { directory: trimTrailing(base), query: abs }

    const dir = i === 0 ? "/" : /^[A-Za-z]:$/.test(abs.slice(0, i)) ? abs.slice(0, i) + "/" : abs.slice(0, i)
    return { directory: trimTrailing(dir), query: abs.slice(i + 1) }
  }

  async function fetchDirs(input: { directory: string; query: string }) {
    if (isRoot(input.directory)) {
      const nodes = await sdk.client.file
        .list({ directory: input.directory, path: "" })
        .then((x) => x.data ?? [])
        .catch(() => [])

      const dirs = nodes.filter((n) => n.type === "directory").map((n) => n.name)
      const sorted = input.query
        ? fuzzysort.go(input.query, dirs, { limit: 50 }).map((x) => x.target)
        : dirs.slice().sort((a, b) => a.localeCompare(b))

      return sorted.slice(0, 50).map((name) => join(input.directory, name))
    }

    const results = await sdk.client.find
      .files({ directory: input.directory, query: input.query, type: "directory", limit: 50 })
      .then((x) => x.data ?? [])
      .catch(() => [])

    return results.map((rel) => join(input.directory, rel))
  }

  const directories = async (filter: string) => {
    const input = parse(filter)
    if (!input) return [] as string[]
    return fetchDirs(input)
  }

  function resolve(absolute: string) {
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? language.t("command.project.open")}>
      <List
        search={{ placeholder: language.t("dialog.directory.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.directory.empty")}
        loadingMessage={language.t("common.loading")}
        items={directories}
        key={(x) => x}
        onSelect={(path) => {
          if (!path) return
          resolve(path)
        }}
      >
        {(absolute) => {
          const path = display(absolute)
          return (
            <div class="w-full flex items-center justify-between rounded-md">
              <div class="flex items-center gap-x-3 grow min-w-0">
                <FileIcon node={{ path: absolute, type: "directory" }} class="shrink-0 size-4" />
                <div class="flex items-center text-14-regular min-w-0">
                  <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                    {getDirectory(path)}
                  </span>
                  <span class="text-text-strong whitespace-nowrap">{getFilename(path)}</span>
                </div>
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}

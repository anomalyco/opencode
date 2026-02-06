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

  const cache = new Map<string, Promise<Array<{ name: string; absolute: string }>>>()

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
    if (v === "//") return v
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

  function scoped(filter: string) {
    const base = start()
    if (!base) return

    const raw = normalizeDriveRoot(filter.trim())
    if (!raw) return { directory: trimTrailing(base), path: "" }

    const h = home()
    if (raw === "~") return { directory: trimTrailing(h ?? base), path: "" }
    if (raw.startsWith("~/")) return { directory: trimTrailing(h ?? base), path: raw.slice(2) }

    const root = rootOf(raw)
    if (root) return { directory: trimTrailing(root), path: raw.slice(root.length) }
    return { directory: trimTrailing(base), path: raw }
  }

  async function dirs(dir: string) {
    const key = trimTrailing(dir)
    const existing = cache.get(key)
    if (existing) return existing

    const request = sdk.client.file
      .list({ directory: key, path: "" })
      .then((x) => x.data ?? [])
      .catch(() => [])
      .then((nodes) =>
        nodes
          .filter((n) => n.type === "directory")
          .map((n) => ({
            name: n.name,
            absolute: trimTrailing(normalizeDriveRoot(n.absolute)),
          })),
      )

    cache.set(key, request)
    return request
  }

  async function match(dir: string, query: string, limit: number) {
    const items = await dirs(dir)
    if (!query) return items.slice(0, limit).map((x) => x.absolute)
    return fuzzysort.go(query, items, { key: "name", limit }).map((x) => x.obj.absolute)
  }

  const directories = async (filter: string) => {
    const input = scoped(filter)
    if (!input) return [] as string[]

    const raw = normalizeDriveRoot(filter.trim())
    const isPath = raw.startsWith("~") || !!rootOf(raw) || raw.includes("/")

    const query = normalizeDriveRoot(input.path)

    if (!isPath) {
      const results = await sdk.client.find
        .files({ directory: input.directory, query, type: "directory", limit: 50 })
        .then((x) => x.data ?? [])
        .catch(() => [])

      return results.map((rel) => join(input.directory, rel)).slice(0, 50)
    }

    const segments = query.replace(/^\/+/, "").split("/")
    const head = segments.slice(0, segments.length - 1).filter((x) => x && x !== ".")
    const tail = segments[segments.length - 1] ?? ""

    const cap = 12
    const branch = 4
    let paths = [input.directory]
    for (const part of head) {
      if (part === "..") {
        paths = paths.map((p) => {
          const v = trimTrailing(p)
          if (v === "/") return v
          if (/^[A-Za-z]:\/$/.test(v)) return v
          const i = v.lastIndexOf("/")
          if (i <= 0) return "/"
          return v.slice(0, i)
        })
        continue
      }

      const next = (await Promise.all(paths.map((p) => match(p, part, branch)))).flat()
      paths = Array.from(new Set(next)).slice(0, cap)
      if (paths.length === 0) return [] as string[]
    }

    const out = (await Promise.all(paths.map((p) => match(p, tail, 50)))).flat()
    return Array.from(new Set(out)).slice(0, 50)
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

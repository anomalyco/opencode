import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import type { ListRef } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import fuzzysort from "fuzzysort"
import { createMemo, createResource, createSignal } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

type Row = {
  absolute: string
  search: string
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

function joinPath(base: string | undefined, rel: string) {
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

function modeOf(input: string) {
  const raw = normalizeDriveRoot(input.trim())
  if (!raw) return "relative" as const
  if (raw.startsWith("~")) return "tilde" as const
  if (rootOf(raw)) return "absolute" as const
  return "relative" as const
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

function displayPath(path: string, input: string, home: string) {
  const full = trimTrailing(path)
  if (modeOf(input) === "absolute") return full
  return tildeOf(full, home) || full
}

function toRow(absolute: string, home: string): Row {
  const full = trimTrailing(absolute)
  const tilde = tildeOf(full, home)
  const withSlash = (value: string) => {
    if (!value) return ""
    if (value.endsWith("/")) return value
    return value + "/"
  }

  const search = Array.from(
    new Set([full, withSlash(full), tilde, withSlash(tilde), getFilename(full)].filter(Boolean)),
  ).join("\n")
  return { absolute: full, search }
}

function useDirectorySearch(args: {
  sdk: ReturnType<typeof useGlobalSDK>
  start: () => string | undefined
  home: () => string
}) {
  const cache = new Map<string, Promise<Array<{ name: string; absolute: string }>>>()
  let current = 0

  const scoped = (value: string) => {
    const base = args.start()
    if (!base) return

    const raw = normalizeDriveRoot(value)
    if (!raw) return { directory: trimTrailing(base), path: "" }

    const h = args.home()
    if (raw === "~") return { directory: trimTrailing(h || base), path: "" }
    if (raw.startsWith("~/")) return { directory: trimTrailing(h || base), path: raw.slice(2) }

    const root = rootOf(raw)
    if (root) return { directory: trimTrailing(root), path: raw.slice(root.length) }
    return { directory: trimTrailing(base), path: raw }
  }

  const dirs = async (dir: string) => {
    const key = trimTrailing(dir)
    const existing = cache.get(key)
    if (existing) return existing

    const request = args.sdk.client.file
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

  const match = async (dir: string, query: string, limit: number) => {
    const items = await dirs(dir)
    if (!query) return items.slice(0, limit).map((x) => x.absolute)
    return fuzzysort.go(query, items, { key: "name", limit }).map((x) => x.obj.absolute)
  }

  return async (filter: string) => {
    const token = ++current
    const active = () => token === current

    const value = cleanInput(filter)
    const scopedInput = scoped(value)
    if (!scopedInput) return [] as string[]

    const raw = normalizeDriveRoot(value)
    const isPath = raw.startsWith("~") || !!rootOf(raw) || raw.includes("/")
    const query = normalizeDriveRoot(scopedInput.path)

    const find = () =>
      args.sdk.client.find
        .files({ directory: scopedInput.directory, query, type: "directory", limit: 50 })
        .then((x) => x.data ?? [])
        .catch(() => [])

    if (!isPath) {
      const results = await find()
      if (!active()) return []
      return results.map((rel) => joinPath(scopedInput.directory, rel)).slice(0, 50)
    }

    const segments = query.replace(/^\/+/, "").split("/")
    const head = segments.slice(0, segments.length - 1).filter((x) => x && x !== ".")
    const tail = segments[segments.length - 1] ?? ""

    const cap = 12
    const branch = 4
    let paths = [scopedInput.directory]
    for (const part of head) {
      if (!active()) return []
      if (part === "..") {
        paths = paths.map(parentOf)
        continue
      }

      const next = (await Promise.all(paths.map((p) => match(p, part, branch)))).flat()
      if (!active()) return []
      paths = Array.from(new Set(next)).slice(0, cap)
      if (paths.length === 0) return [] as string[]
    }

    const out = (await Promise.all(paths.map((p) => match(p, tail, 50)))).flat()
    if (!active()) return []
    const deduped = Array.from(new Set(out))
    const base = raw.startsWith("~") ? trimTrailing(scopedInput.directory) : ""
    const expand = !raw.endsWith("/")
    if (!expand || !tail) {
      const items = base ? Array.from(new Set([base, ...deduped])) : deduped
      return items.slice(0, 50)
    }

    const needle = tail.toLowerCase()
    const exact = deduped.filter((p) => getFilename(p).toLowerCase() === needle)
    const target = exact[0]
    if (!target) return deduped.slice(0, 50)

    const children = await match(target, "", 30)
    if (!active()) return []
    const items = Array.from(new Set([...deduped, ...children]))
    return (base ? Array.from(new Set([base, ...items])) : items).slice(0, 50)
  }
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sync = useGlobalSync()
  const sdk = useGlobalSDK()
  const dialog = useDialog()
  const language = useLanguage()

  const [filter, setFilter] = createSignal("")
  let list: ListRef | undefined

  const missingBase = createMemo(() => !(sync.data.path.home || sync.data.path.directory))
  const [fallbackPath] = createResource(
    () => (missingBase() ? true : undefined),
    async () => {
      return sdk.client.path
        .get()
        .then((x) => x.data)
        .catch(() => undefined)
    },
    { initialValue: undefined },
  )

  const home = createMemo(() => sync.data.path.home || fallbackPath()?.home || "")
  const start = createMemo(
    () => sync.data.path.home || sync.data.path.directory || fallbackPath()?.home || fallbackPath()?.directory,
  )

  const directories = useDirectorySearch({
    sdk,
    home,
    start,
  })

  const items = async (value: string) => {
    const results = await directories(value)
    return results.map((absolute) => toRow(absolute, home()))
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
        items={items}
        key={(x) => x.absolute}
        filterKeys={["search"]}
        ref={(r) => (list = r)}
        onFilter={(value) => setFilter(cleanInput(value))}
        onKeyEvent={(e, item) => {
          if (e.key !== "Tab") return
          if (e.shiftKey) return
          if (!item) return

          e.preventDefault()
          e.stopPropagation()

          const value = displayPath(item.absolute, filter(), home())
          list?.setFilter(value.endsWith("/") ? value : value + "/")
        }}
        onSelect={(path) => {
          if (!path) return
          resolve(path.absolute)
        }}
      >
        {(item) => {
          const path = displayPath(item.absolute, filter(), home())
          if (path === "~") {
            return (
              <div class="w-full flex items-center justify-between rounded-md">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
                  <div class="flex items-center text-14-regular min-w-0">
                    <span class="text-text-strong whitespace-nowrap">~</span>
                    <span class="text-text-weak whitespace-nowrap">/</span>
                  </div>
                </div>
              </div>
            )
          }
          return (
            <div class="w-full flex items-center justify-between rounded-md">
              <div class="flex items-center gap-x-3 grow min-w-0">
                <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
                <div class="flex items-center text-14-regular min-w-0">
                  <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                    {getDirectory(path)}
                  </span>
                  <span class="text-text-strong whitespace-nowrap">{getFilename(path)}</span>
                  <span class="text-text-weak whitespace-nowrap">/</span>
                </div>
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}

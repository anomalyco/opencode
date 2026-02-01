import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createEffect, createMemo, createResource, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sync = useGlobalSync()
  const sdk = useGlobalSDK()
  const dialog = useDialog()
  const [state, setState] = createStore({ error: "" })
  const [filter, setFilter] = createSignal("")

  const isSingleSelect = createMemo(() => !props.multiple)
  const home = createMemo(() => sync.data.path.home)
  const root = createMemo(() => {
    if (isSingleSelect()) return home() ?? sync.data.path.directory
    return sync.data.path.directory
  })

  type DirectoryEntry =
    | { kind: "parent"; name: string; path: string }
    | { kind: "directory"; name: string; path: string }

  function join(base: string | undefined, rel: string) {
    const b = (base ?? "").replace(/[\\/]+$/, "")
    const r = rel.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")
    if (!b) return r
    if (!r) return b
    return b + "/" + r
  }

  function display(value: string) {
    const isAbsolute = value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)
    const full = isAbsolute ? value : join(root(), value)
    const h = home()
    if (!h) return full
    if (full === h) return "~"
    if (full.startsWith(h + "/") || full.startsWith(h + "\\")) {
      return "~" + full.slice(h.length)
    }
    return full
  }

  function normalizePath(value: string | undefined) {
    return (value ?? "").replace(/[\\/]+$/, "")
  }

  function parentAbsolute(value: string) {
    const normalized = normalizePath(value)
    if (!normalized) return ""
    const parent = normalizePath(getDirectory(normalized))
    if (!parent || parent === normalized) return ""
    return parent
  }

  function normalizeQuery(query: string) {
    const h = home()

    if (!query) return query
    if (query.startsWith("~/")) return query.slice(2)

    if (h) {
      const lc = query.toLowerCase()
      const hc = h.toLowerCase()
      if (lc === hc || lc.startsWith(hc + "/") || lc.startsWith(hc + "\\")) {
        return query.slice(h.length).replace(/^[\\/]+/, "")
      }
    }

    return query
  }

  function normalizeFindFilesResponse(input: unknown): { results: string[]; error: string } {
    if (Array.isArray(input)) return { results: input, error: "" }
    if (!input || typeof input !== "object")
      return { results: [], error: "Unable to load folders. Check the server connection." }

    const maybeData = (input as { data?: unknown }).data
    if (Array.isArray(maybeData)) return { results: maybeData, error: "" }
    if (maybeData && typeof maybeData === "object") {
      const nested = (maybeData as { data?: unknown }).data
      if (Array.isArray(nested)) return { results: nested, error: "" }
    }
    console.error("Unexpected find.files response shape", { input })
    return { results: [], error: "Unable to load folders. Check the dev proxy configuration." }
  }

  function normalizeFileListResponse(input: unknown): {
    results: { name: string; path: string; absolute: string; ignored: boolean; type: string }[]
    error: string
  } {
    if (Array.isArray(input)) return { results: input, error: "" }
    if (!input || typeof input !== "object") {
      return { results: [], error: "Unable to load folders. Check the server connection." }
    }
    const maybeData = (input as { data?: unknown }).data
    if (Array.isArray(maybeData)) {
      return {
        results: maybeData as { name: string; path: string; absolute: string; ignored: boolean; type: string }[],
        error: "",
      }
    }
    console.error("Unexpected file.list response shape", { input })
    return { results: [], error: "Unable to load folders. Check the server connection." }
  }

  function errorMessage(err: unknown) {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string; error?: { message?: string } } }).data
      if (data?.message) return data.message
      if (data?.error?.message) return data.error.message
    }
    if (err instanceof Error) return err.message
    return "Unable to load folders. Check the server connection or dev proxy."
  }

  async function fetchDirs(query: string) {
    const directory = root()
    if (!directory) return [] as string[]

    setState({ error: "" })
    try {
      const response = await sdk.client.find.files({ directory, query, type: "directory", limit: 50 })
      const { results, error } = normalizeFindFilesResponse(response)
      if (error) setState({ error })
      return results.map((x) => x.replace(/[\\/]+$/, ""))
    } catch {
      setState({ error: "Unable to load folders. Check the server connection or dev proxy." })
      return []
    }
  }

  const directories = async (filter: string) => {
    const query = normalizeQuery(filter.trim())
    return fetchDirs(query)
  }

  const [currentPath, setCurrentPath] = createSignal("")
  const [lastRoot, setLastRoot] = createSignal("")

  createEffect(() => {
    const base = normalizePath(root())
    if (!base) return
    const current = normalizePath(currentPath())
    const previous = lastRoot()
    if (!current || current === previous) {
      setCurrentPath(base)
    }
    if (previous !== base) {
      setLastRoot(base)
    }
  })

  const [directoryNodes] = createResource(
    () => (isSingleSelect() ? currentPath() : ""),
    async (path) => {
      if (!path) return [] as { name: string; path: string; absolute: string; ignored: boolean; type: string }[]
      setState({ error: "" })
      try {
        const response = await sdk.client.file.list({ path })
        const { results, error } = normalizeFileListResponse(response)
        if (error) setState({ error })
        return results
      } catch (err) {
        setState({ error: errorMessage(err) })
        return []
      }
    },
  )

  const directoryItems = createMemo(() => {
    const items: DirectoryEntry[] = []
    const base = normalizePath(root())
    const current = normalizePath(currentPath())
    const parent = parentAbsolute(current)
    if (parent && current !== base && parent.startsWith(base)) {
      items.push({
        kind: "parent",
        name: "..",
        path: parent,
      })
    }
    const nodes = directoryNodes() ?? []
    for (const node of nodes) {
      if (node.type !== "directory") continue
      if (node.ignored) continue
      items.push({
        kind: "directory",
        name: node.name,
        path: node.absolute,
      })
    }
    return items
  })

  const parentPath = createMemo(() => {
    const base = normalizePath(root())
    const current = normalizePath(currentPath())
    const parent = parentAbsolute(current)
    if (!parent || !base || current === base) return ""
    if (!parent.startsWith(base)) return ""
    return parent
  })

  function resolve(rel: string) {
    const absolute = join(root(), rel)
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? "Open project"} class="dialog-no-body-scroll">
      <Show
        when={isSingleSelect()}
        fallback={
          <List
            search={{ placeholder: "Search folders", autofocus: true }}
            emptyMessage={state.error || "No folders found"}
            items={directories}
            key={(x) => x}
            onSelect={(path) => {
              if (!path) return
              resolve(path)
            }}
          >
            {(rel) => {
              const path = display(rel)
              return (
                <div class="w-full flex items-center justify-between rounded-md">
                  <div class="flex items-center gap-x-3 grow min-w-0">
                    <FileIcon node={{ path: rel, type: "directory" }} class="shrink-0 size-4" />
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
        }
      >
        <div class="directory-picker flex flex-col gap-3 max-h-[70vh]">
          <div class="sticky top-0 z-20 bg-surface-base/95 backdrop-blur px-3 pt-3">
            <div class="flex items-center justify-between gap-3">
              <div class="text-12-regular text-text-weak pl-1">
                Current folder: <span class="text-text-strong">{display(currentPath())}</span>
              </div>
              <Button
                size="large"
                variant="ghost"
                disabled={!parentPath()}
                onClick={() => {
                  const next = parentPath()
                  if (!next && next !== "") return
                  setCurrentPath(next)
                }}
              >
                Up one level
              </Button>
            </div>
            <div class="pt-2 pb-2">
              <TextField value={filter()} onChange={setFilter} placeholder="Filter folders" variant="ghost" />
            </div>
          </div>
          <List
            emptyMessage={state.error || "No folders found"}
            items={directoryItems()}
            key={(item) => item.path}
            filterKeys={["name"]}
            filter={filter()}
            onSelect={(item) => {
              if (!item) return
              setCurrentPath(item.path)
            }}
            class="flex-1 min-h-0"
          >
            {(item) => {
              const path = display(item.path)
              return (
                <div class="w-full flex items-center justify-between rounded-md">
                  <div class="flex items-center gap-x-3 grow min-w-0">
                    <FileIcon node={{ path: item.path, type: "directory" }} class="shrink-0 size-4" />
                    <div class="flex items-center text-14-regular min-w-0">
                      <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                        {getDirectory(path)}
                      </span>
                      <span class="text-text-strong whitespace-nowrap">
                        {item.kind === "parent" ? ".." : getFilename(path)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            }}
          </List>
          <div class="sticky bottom-0 z-20 bg-surface-base/95 backdrop-blur px-3 pb-3 pt-2 flex justify-end gap-3">
            <Button size="large" variant="ghost" onClick={() => dialog.close()}>
              Cancel
            </Button>
            <Button
              size="large"
              onClick={() => {
                const selected = currentPath()
                if (!selected) return
                props.onSelect(props.multiple ? [selected] : selected)
                dialog.close()
              }}
            >
              Select this folder
            </Button>
          </div>
        </div>
      </Show>
    </Dialog>
  )
}

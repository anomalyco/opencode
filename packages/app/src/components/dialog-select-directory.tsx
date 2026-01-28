import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createMemo } from "solid-js"
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

  const home = createMemo(() => sync.data.path.home)
  const root = createMemo(() => sync.data.path.home || sync.data.path.directory)

  function join(base: string | undefined, rel: string) {
    const b = (base ?? "").replace(/[\\/]+$/, "")
    const r = rel.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")
    if (!b) return r
    if (!r) return b
    return b + "/" + r
  }

  function display(rel: string) {
    const full = join(root(), rel)
    const h = home()
    if (!h) return full
    if (full === h) return "~"
    if (full.startsWith(h + "/") || full.startsWith(h + "\\")) {
      return "~" + full.slice(h.length)
    }
    return full
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
    if (!input || typeof input !== "object") return { results: [], error: "Unable to load folders. Check the server connection." }

    const maybeData = (input as { data?: unknown }).data
    if (Array.isArray(maybeData)) return { results: maybeData, error: "" }
    if (maybeData && typeof maybeData === "object") {
      const nested = (maybeData as { data?: unknown }).data
      if (Array.isArray(nested)) return { results: nested, error: "" }
    }
    console.error("Unexpected find.files response shape", { input })
    return { results: [], error: "Unable to load folders. Check the dev proxy configuration." }
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

  function resolve(rel: string) {
    const absolute = join(root(), rel)
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? "Open project"}>
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
    </Dialog>
  )
}

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createMemo } from "solid-js"
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
    // If already in display format (~/...), return as-is
    if (rel.startsWith("~/")) return rel
    // If absolute path, convert to ~/ format if under home
    const h = home()
    if (rel.startsWith("/")) {
      if (h && (rel === h || rel.startsWith(h + "/") || rel.startsWith(h + "\\"))) {
        return "~" + rel.slice(h.length)
      }
      return rel
    }
    // Relative path - convert to display format
    const full = join(root(), rel)
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

  async function fetchDirs(query: string) {
    const directory = root()
    if (!directory) return [] as string[]

    const results = await sdk.client.find
      .files({ directory, query, type: "directory", limit: 50 })
      .then((x) => x.data ?? [])
      .catch(() => [])

    return results.map((x) => x.replace(/[\\/]+$/, ""))
  }

  const directories = async (filter: string) => {
    const trimmed = filter.trim()
    const query = normalizeQuery(trimmed)
    const results = await fetchDirs(query)

    // Transform results to match user's input format
    const h = home()
    if (trimmed.startsWith("~/")) {
      // User typed ~/... so prefix results with ~/
      return results.map((r) => "~/" + r)
    }
    if (h && trimmed.toLowerCase().startsWith(h.toLowerCase())) {
      // User typed absolute path like /Users/huy/... so prefix with home
      return results.map((r) => h + "/" + r)
    }
    return results
  }

  function resolve(rel: string) {
    // Handle paths that are already absolute or start with ~/
    const h = home()
    let absolute: string
    if (rel.startsWith("~/") && h) {
      absolute = h + rel.slice(1) // Replace ~ with home path
    } else if (rel.startsWith("/")) {
      absolute = rel // Already absolute
    } else {
      absolute = join(root(), rel)
    }
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? "Open project"}>
      <List
        search={{ placeholder: "Search folders", autofocus: true }}
        emptyMessage="No folders found"
        items={directories}
        key={(x) => x}
        skipClientFilter
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

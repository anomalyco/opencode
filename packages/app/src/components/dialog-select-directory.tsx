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

/**
 * Check if a path is absolute (Windows drive letter or Unix root)
 * Handles: C:\, D:\, /home, /c/, etc.
 */
function isAbsolutePath(path: string): boolean {
  if (!path) return false
  // Windows drive letter (C:\, D:/, etc.)
  if (/^[a-zA-Z]:[\/]/.test(path)) return true
  // Unix absolute path or Git Bash style (/c/, /d/, /home, etc.)
  if (path.startsWith("/")) return true
  return false
}

/**
 * Extract the search directory from an absolute path query
 * Returns the directory portion to search within
 */
function getSearchRoot(query: string): string | null {
  if (!isAbsolutePath(query)) return null
  
  // For Windows paths like "C:\Users" or "D:\Projects\foo"
  // Return the path up to the last separator for searching
  const normalized = query.replace(/\/g, "/")
  const lastSlash = normalized.lastIndexOf("/")
  
  if (lastSlash <= 0) {
    // Root of drive: "C:\" -> "C:/"
    if (/^[a-zA-Z]:/.test(query)) {
      return query.slice(0, 2) + "/"
    }
    return "/"
  }
  
  return normalized.slice(0, lastSlash) || "/"
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sync = useGlobalSync()
  const sdk = useGlobalSDK()
  const dialog = useDialog()

  const home = createMemo(() => sync.data.path.home)
  const root = createMemo(() => sync.data.path.home || sync.data.path.directory)

  function join(base: string | undefined, rel: string) {
    const b = (base ?? "").replace(/[\/]+$/, "")
    const r = rel.replace(/^[\/]+/, "").replace(/[\/]+$/, "")
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

    // If it's an absolute path, don't normalize - return as-is for absolute search
    if (isAbsolutePath(query)) return query

    if (h) {
      const lc = query.toLowerCase()
      const hc = h.toLowerCase()
      if (lc === hc || lc.startsWith(hc + "/") || lc.startsWith(hc + "\\")) {
        return query.slice(h.length).replace(/^[\/]+/, "")
      }
    }

    return query
  }

  async function fetchDirs(query: string) {
    // Check if query is an absolute path (Windows or Unix)
    let directory: string
    let searchQuery: string

    if (isAbsolutePath(query)) {
      // For absolute paths, search from the path's parent directory
      const searchRoot = getSearchRoot(query)
      if (searchRoot) {
        directory = searchRoot
        // Extract just the filename/folder portion for the query
        const normalized = query.replace(/\/g, "/")
        const lastSlash = normalized.lastIndexOf("/")
        searchQuery = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : query
      } else {
        directory = root() || ""
        searchQuery = query
      }
    } else {
      directory = root() || ""
      searchQuery = query
    }

    if (!directory) return [] as string[]

    const results = await sdk.client.find
      .files({ directory, query: searchQuery, type: "directory", limit: 50 })
      .then((x) => x.data ?? [])
      .catch(() => [])

    return results.map((x) => x.replace(/[\/]+$/, ""))
  }

  const directories = async (filter: string) => {
    const query = normalizeQuery(filter.trim())
    return fetchDirs(query)
  }

  function resolve(rel: string) {
    // If the result is already an absolute path, use it directly
    const absolute = isAbsolutePath(rel) ? rel : join(root(), rel)
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? "Open project"}>
      <List
        search={{ placeholder: "Search folders (or type absolute path like D:\)", autofocus: true }}
        emptyMessage="No folders found"
        items={directories}
        key={(x) => x}
        onSelect={(path) => {
          if (!path) return
          resolve(path)
        }}
      >
        {(rel) => {
          const path = isAbsolutePath(rel) ? rel : display(rel)
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

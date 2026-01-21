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

  function isAbsolutePath(p: string) {
    return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p)
  }

  function getParentPath(p: string) {
    const normalized = p.replace(/[\\/]+$/, "")
    const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
    if (lastSlash <= 0) return "/"
    return normalized.slice(0, lastSlash)
  }

  function join(base: string | undefined, rel: string) {
    const b = (base ?? "").replace(/[\\/]+$/, "")
    const r = rel.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")
    if (!b) return r
    if (!r) return b
    return b + "/" + r
  }

  function display(fullPath: string) {
    const h = home()
    if (!h) return fullPath
    if (fullPath === h) return "~"
    if (fullPath.startsWith(h + "/") || fullPath.startsWith(h + "\\")) {
      return "~" + fullPath.slice(h.length)
    }
    return fullPath
  }

  async function fetchDirs(filter: string) {
    const trimmed = filter.trim()
    const h = home()

    // Determine search directory and query based on input
    let directory: string
    let query: string

    if (isAbsolutePath(trimmed)) {
      // Check if path ends with / - user wants to see directory contents
      if (trimmed.endsWith("/") || trimmed.endsWith("\\")) {
        directory = trimmed.replace(/[\\/]+$/, "")
        query = ""
      } else {
        // Absolute path without trailing slash: use parent directory, search for basename
        directory = getParentPath(trimmed)
        const basename = trimmed.slice(directory.length).replace(/^[\\/]+/, "")
        query = basename
      }
    } else if (trimmed.startsWith("~/")) {
      // Home-relative path
      directory = h || "/"
      query = trimmed.slice(2)
    } else {
      // Relative query: search in home
      directory = h || "/"
      query = trimmed
    }

    if (!directory) return [] as string[]

    const results = await sdk.client.find
      .files({ directory, query, type: "directory", limit: 50 })
      .then((x) => x.data ?? [])
      .catch(() => [])

    // Results are relative to directory - convert to absolute paths
    return results.map((x) => {
      const rel = x.replace(/[\\/]+$/, "")
      return join(directory, rel)
    })
  }

  const directories = async (filter: string) => {
    return fetchDirs(filter)
  }

  function resolve(absolutePath: string) {
    props.onSelect(props.multiple ? [absolutePath] : absolutePath)
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? "Open project"}>
      <List
        search={{ placeholder: "Search folders (use / for absolute paths)", autofocus: true }}
        emptyMessage="No folders found"
        items={directories}
        key={(x) => x}
        onSelect={(path) => {
          if (!path) return
          resolve(path)
        }}
      >
        {(absolutePath) => {
          const displayPath = display(absolutePath)
          return (
            <div class="w-full flex items-center justify-between rounded-md">
              <div class="flex items-center gap-x-3 grow min-w-0">
                <FileIcon node={{ path: absolutePath, type: "directory" }} class="shrink-0 size-4" />
                <div class="flex items-center text-14-regular min-w-0">
                  <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                    {getDirectory(displayPath)}
                  </span>
                  <span class="text-text-strong whitespace-nowrap">{getFilename(displayPath)}</span>
                </div>
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}

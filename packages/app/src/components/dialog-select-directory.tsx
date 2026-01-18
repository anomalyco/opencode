import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createMemo } from "solid-js"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import {
  joinPath,
  displayPath,
  normalizeQuery,
  projectsToRelative,
  filterProjects,
  combineResults,
} from "@/utils/directory-search"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sync = useGlobalSync()
  const globalSdk = useGlobalSDK()
  const platform = usePlatform()
  const dialog = useDialog()

  const home = createMemo(() => sync.data.path.home)
  const root = createMemo(() => sync.data.path.home || sync.data.path.directory)

  // Create SDK client with home directory for file search
  const sdk = createMemo(() =>
    createOpencodeClient({
      baseUrl: globalSdk.url,
      fetch: platform.fetch,
      directory: root(),
      throwOnError: true,
    }),
  )

  function display(rel: string) {
    return displayPath(joinPath(root(), rel), home())
  }

  // Get known projects from the server
  const knownProjects = createMemo(() => projectsToRelative(sync.data.project, home()))

  async function fetchDirs(query: string) {
    const directory = root()
    if (!directory) return [] as string[]

    const results = await sdk()
      .find.files({ directory, query, type: "directory", limit: 50 })
      .then((x) => (Array.isArray(x.data) ? x.data : []))
      .catch(() => [])

    return results.map((x: string) => x.replace(/[\\/]+$/, ""))
  }

  const directories = async (filter: string) => {
    const query = normalizeQuery(filter.trim(), home()).toLowerCase()
    const matchingProjects = filterProjects(knownProjects(), query)
    const searchResults = await fetchDirs(query)
    return combineResults(matchingProjects, searchResults, 50)
  }

  function resolve(rel: string) {
    const absolute = joinPath(root(), rel)
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

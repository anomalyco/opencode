import { createMemo, createSignal, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import { useGlobalSDK } from "@/context/global-sdk"
import { useTerminal } from "@/context/terminal"
import { useLayout } from "@/context/layout"
import { processProjectEntries, resolveSelection, validateProjectName, type Row } from "./dialog-select-directory-helpers"

export const PROJECTS_DIR = "/home/ubuntu/projects"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sdk = useGlobalSDK()
  const dialog = useDialog()
  const terminal = useTerminal()
  const layout = useLayout()
  const params = useParams()

  const [showCreate, setShowCreate] = createSignal(false)
  const [newName, setNewName] = createSignal("")

  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)

  const items = async (_filter: string): Promise<Row[]> => {
    const nodes = await sdk.client.file
      .list({ directory: PROJECTS_DIR, path: "" })
      .then((x) => x.data ?? [])
      .catch(() => [])

    return processProjectEntries(nodes)
  }

  function resolve(absolute: string) {
    props.onSelect(resolveSelection(absolute, props.multiple))
    dialog.close()
  }

  const runCreate = () => {
    const error = validateProjectName(newName())
    if (error) {
      showToast({
        variant: "error",
        title: "Create failed",
        description: error,
      })
      return
    }

    const value = newName().trim()

    try {
      if (params.dir) {
        layout.view(sessionKey)().terminal.open()
      }
    } catch {}

    terminal.run({
      command: "latervibe",
      args: ["create", value],
      title: "New Project",
      cwd: PROJECTS_DIR,
    })

    setNewName("")
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? "Projects"}>
      <List<Row>
        search={{ placeholder: "Search projects...", autofocus: true }}
        emptyMessage="No projects found"
        loadingMessage="Loading..."
        items={items}
        key={(x) => x.absolute}
        filterKeys={["search"]}
        onSelect={(item) => {
          if (!item) return
          resolve(item.absolute)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-x-3 rounded-md">
            <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
            <span class="text-14-regular text-text-strong">{getFilename(item.absolute)}</span>
          </div>
        )}
      </List>

      <div class="border-t border-border-base px-4 py-3">
        <Show
          when={showCreate()}
          fallback={
            <button
              class="flex items-center gap-2 text-14-regular text-text-weak hover:text-text-strong w-full cursor-pointer"
              onClick={() => setShowCreate(true)}
            >
              <span>+</span>
              <span>New Project</span>
            </button>
          }
        >
          <div class="flex items-center gap-2">
            <TextField
              autofocus
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runCreate()
                if (e.key === "Escape") {
                  e.stopPropagation()
                  setShowCreate(false)
                }
              }}
              placeholder="Project name"
              class="flex-1"
            />
            <Button variant="primary" class="h-[32px] shrink-0" onClick={runCreate}>
              Create
            </Button>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

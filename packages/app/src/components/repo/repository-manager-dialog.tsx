import { createResource, createSignal, For, Show } from "solid-js"
import { DateTime } from "luxon"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import type { Repo } from "@opencode-ai/sdk/v2/client"
import { CloneDialog } from "./clone-dialog"
import { RepoSettingsDialog } from "./repo-settings-dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { formatRepoError } from "./repo-errors"

interface RepositoryManagerDialogProps {
  onOpenRepo?: (repo: Repo) => void
}

export function RepositoryManagerDialog(props: RepositoryManagerDialogProps) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const navigate = useNavigate()
  const [localPath, setLocalPath] = createSignal("")

  const [repos, { refetch }] = createResource(async () => {
    try {
      return (await globalSDK.client.repo.list()).data ?? []
    } catch {
      return []
    }
  })

  const openRepo = (repo: Repo) => {
    if (props.onOpenRepo) {
      props.onOpenRepo(repo)
      return
    }
    layout.projects.open(repo.path)
    navigate(`/${base64Encode(repo.path)}/session`)
  }

  const openDirectoryPicker = (onPick: (path: string) => void) => {
    dialog.show(() => (
      <DialogSelectDirectory
        title="Add local repository"
        multiple={false}
        onSelect={(result) => {
          const path = Array.isArray(result) ? result[0] : result
          if (!path) return
          onPick(path)
        }}
      />
    ))
  }

  const addLocalRepo = async (maybePath?: string) => {
    const path = (maybePath ?? localPath()).trim()
    if (!path) {
      openDirectoryPicker((selected) => {
        setLocalPath(selected)
        void addLocalRepo(selected)
      })
      return
    }
    try {
      const repo = await globalSDK.client.repo.add({ path }).then((x) => x.data)
      if (repo) {
        setLocalPath("")
        await refetch()
        showToast({ title: "Repository added", description: repo.name })
      }
    } catch (err) {
      showToast({
        title: "Failed to add repository",
        description: formatRepoError(err),
      })
    }
  }

  const handleClone = () => {
    dialog.show(() => (
      <CloneDialog
        onCloneSuccess={async (repo) => {
          await refetch()
          showToast({ title: "Repository cloned", description: repo.name })
          openRepo(repo)
        }}
      />
    ))
  }

  const handleSelectDirectory = () => {
    openDirectoryPicker((path) => setLocalPath(path))
  }

  const handleSettings = (repo: Repo) => {
    dialog.show(() => <RepoSettingsDialog repo={repo} />)
  }

  return (
    <Dialog
      title="Manage repositories"
      description="Clone repositories or add existing local paths."
      class="max-w-[640px]"
    >
      <div class="flex flex-col gap-4 px-2 pb-3">
        <div class="flex flex-col gap-3 rounded-md border border-border-weak-base p-3">
          <TextField
            label="Local repository path"
            placeholder="~/Projects/my-repo"
            value={localPath()}
            onChange={setLocalPath}
          />
          <div class="text-12-regular text-text-weak">Path must exist on the host machine running opencode.</div>
          <div class="flex justify-end">
            <Button size="normal" variant="ghost" onClick={handleSelectDirectory}>
              <Icon name="folder" size="small" />
              Choose folder
            </Button>
          </div>
          <div class="flex justify-end gap-2">
            <Button size="normal" variant="ghost" onClick={handleClone}>
              <Icon name="download" size="small" />
              Clone from URL
            </Button>
            <Button size="normal" onClick={() => addLocalRepo()}>
              <Icon name="plus-small" size="small" />
              Add local repo
            </Button>
          </div>
        </div>

        <Show when={repos()?.length} fallback={<div class="text-12-regular text-text-weak">No repositories yet.</div>}>
          <div class="flex flex-col gap-2">
            <For each={repos()}>
              {(repo) => (
                <div class="flex items-center justify-between gap-4 rounded-md border border-border-weak-base px-3 py-2">
                  <div class="min-w-0">
                    <div class="text-14-medium text-text-strong">{repo.name}</div>
                    <div class="text-12-regular text-text-weak truncate">{repo.path}</div>
                    <div class="text-12-regular text-text-weak">
                      Added {DateTime.fromMillis(repo.time.created).toRelative()}
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <Button size="normal" variant="ghost" onClick={() => handleSettings(repo)}>
                      <Icon name="settings-gear" size="small" />
                      Settings
                    </Button>
                    <Button size="normal" onClick={() => openRepo(repo)}>
                      Open
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="flex justify-end gap-2 pt-2">
          <Button size="large" variant="ghost" onClick={() => dialog.close()}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

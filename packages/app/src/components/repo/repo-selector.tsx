import { createEffect, createMemo, createResource, createSignal, Show, For } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { Repo, RepoBranchList } from "@opencode-ai/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { CloneDialog } from "./clone-dialog"

interface RepoSelectorProps {
  currentPath?: string
  onOpenRepo?: (repo: Repo) => void
  onBranchChange?: (repo: Repo, branch: string) => void
}

export function RepoSelector(props: RepoSelectorProps) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()

  const [selectedRepoId, setSelectedRepoId] = createSignal<string | undefined>(undefined)
  const [switching, setSwitching] = createSignal(false)
  const [maybeDirtyWarning, setMaybeDirtyWarning] = createSignal<{ branch: string; files: string[] } | null>(null)
  const [selectedBranch, setSelectedBranch] = createSignal<string | undefined>(undefined)

  const [repos, { refetch }] = createResource(async () => {
    try {
      return (await globalSDK.client.repo.list()).data ?? []
    } catch {
      return []
    }
  })

  createEffect(() => {
    const path = props.currentPath
    if (!path) return
    if (selectedRepoId()) return
    const match = repos()?.find((repo) => repo.path === path)
    if (match) setSelectedRepoId(match.id)
  })

  const selectedRepo = createMemo(() => repos()?.find((repo) => repo.id === selectedRepoId()))

  const [branches, { refetch: refetchBranches }] = createResource(
    () => selectedRepo()?.id,
    async (repoId) => {
      if (!repoId) return undefined
      try {
        return (await globalSDK.client.repo.branches({ repoID: repoId })).data as RepoBranchList
      } catch {
        return undefined
      }
    },
  )

  createEffect(() => {
    const current = branches()?.current
    if (current) setSelectedBranch(current)
  })

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { error?: { message?: string } } }).data
      if (data?.error?.message) return data.error.message
    }
    if (err instanceof Error) return err.message
    return "Request failed"
  }

  const switchBranch = async (branch: string, force?: boolean) => {
    const repo = selectedRepo()
    if (!repo || !branch) return
    if (switching()) return
    setSwitching(true)
    setMaybeDirtyWarning(null)

    try {
      await globalSDK.client.repo.checkout({ repoID: repo.id, branch, force })
      setSelectedBranch(branch)
      await refetchBranches()
      props.onBranchChange?.(repo, branch)
      showToast({ title: "Branch switched", description: branch })
    } catch (err) {
      const info = (err as { data?: { error?: { code?: string; files?: string[]; message?: string } } })?.data?.error
      if (info?.code === "repo_dirty") {
        setMaybeDirtyWarning({ branch, files: info.files ?? [] })
      } else {
        showToast({ title: "Failed to switch branch", description: errorMessage(err) })
      }
    } finally {
      setSwitching(false)
    }
  }

  const handleAddLocal = () => {
    dialog.show(() => (
      <DialogSelectDirectory
        title="Add local repository"
        multiple={false}
        onSelect={async (result) => {
          const path = Array.isArray(result) ? result[0] : result
          if (!path) return
          try {
            const repo = await globalSDK.client.repo.add({ path }).then((x) => x.data)
            if (repo) {
              await refetch()
              setSelectedRepoId(repo.id)
              props.onOpenRepo?.(repo)
              showToast({ title: "Repository added", description: repo.name })
            }
          } catch (err) {
            showToast({ title: "Failed to add repository", description: errorMessage(err) })
          }
        }}
      />
    ))
  }

  const handleClone = () => {
    dialog.show(() => (
      <CloneDialog
        onCloneSuccess={async (repo) => {
          await refetch()
          setSelectedRepoId(repo.id)
          props.onOpenRepo?.(repo)
        }}
      />
    ))
  }

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <Icon name="folder" size="small" />
        <Select
          options={repos() ?? []}
          current={selectedRepo()}
          value={(repo) => repo.id}
          label={(repo) => repo.name}
          placeholder="Select repository"
          onSelect={(repo) => {
            if (!repo) return
            setSelectedRepoId(repo.id)
            props.onOpenRepo?.(repo)
          }}
          size="normal"
          variant="ghost"
          class="text-12-medium"
        />
        <Button size="normal" variant="ghost" onClick={handleAddLocal}>
          <Icon name="plus-small" size="small" />
          Add local
        </Button>
        <Button size="normal" variant="ghost" onClick={handleClone}>
          <Icon name="download" size="small" />
          Clone
        </Button>
      </div>

      <Show when={selectedRepo()}>
        <div class="flex items-center gap-2">
          <Icon name="branch" size="small" />
          <Select
            options={branches()?.branches ?? []}
            current={(branches()?.branches ?? []).find((b) => b.name === selectedBranch())}
            value={(branch) => branch.name}
            label={(branch) => branch.name}
            placeholder="Select branch"
            onSelect={(branch) => {
              if (!branch) return
              if (branch.name === selectedBranch()) return
              void switchBranch(branch.name)
            }}
            size="normal"
            variant="ghost"
            class="text-12-medium"
          />
        </div>
      </Show>

      <Show when={maybeDirtyWarning()}>
        {(warning) => (
          <div class="rounded-md border border-border-weak-base bg-surface-warning-base/30 p-3">
            <div class="text-12-medium text-text-strong">Working tree has uncommitted changes.</div>
            <Show when={warning().files.length > 0}>
              <ul class="mt-2 list-disc pl-5 text-12-regular text-text-weak">
                <For each={warning().files}>{(file) => <li>{file}</li>}</For>
              </ul>
            </Show>
            <div class="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="normal" onClick={() => setMaybeDirtyWarning(null)} disabled={switching()}>
                Cancel
              </Button>
              <Button size="normal" onClick={() => switchBranch(warning().branch, true)} disabled={switching()}>
                Force switch
              </Button>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

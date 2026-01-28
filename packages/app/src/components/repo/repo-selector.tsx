import { createEffect, createMemo, createResource, createSignal, Show, For } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import type { Repo, RepoBranchList } from "@opencode-ai/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { CloneDialog } from "./clone-dialog"
import { formatRepoError, formatRepoErrorWithContext } from "./repo-errors"

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
  const [repoListState, setRepoListState] = createStore({ error: "" })
  const [branchListState, setBranchListState] = createStore({ error: "" })

  const errorMessage = (err: unknown) => formatRepoError(err)

  const branchErrorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { error?: { code?: string; message?: string } } }).data
      const code = data?.error?.code
      if (code && ["repo_missing_path", "repo_invalid", "repo_malformed"].includes(code)) {
        const fallback = "Repository record is invalid or missing a path. Remove and re-add it."
        const message = data?.error?.message ?? fallback
        return formatRepoErrorWithContext(err, message)
      }
      if (data && typeof data === "object" && "name" in data) {
        const name = (data as { name?: string }).name
        if (name === "NotFoundError") {
          const message = "Repository record not found. Remove and re-add the repository."
          return formatRepoErrorWithContext(err, message)
        }
      }
    }
    return errorMessage(err)
  }

  const showErrorDialog = (title: string, err: unknown) => {
    const message = formatRepoError(err)
    const details = formatRepoErrorWithContext(err, message)
    dialog.show(() => (
      <Dialog title={title} description="Details from the server response." class="max-w-[640px]">
        <div class="flex flex-col gap-3 px-2 pb-3">
          <pre class="whitespace-pre-wrap rounded-md border border-border-weak-base bg-surface-raised-base p-3 text-12-regular text-text-weak">
            {details}
          </pre>
          <div class="flex justify-end">
            <Button size="large" variant="ghost" onClick={() => dialog.close()}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const normalizePath = (value: string) => value.replace(/[\\/]+$/, "")

  const matchesPath = (repoPath: string, currentPath: string) => {
    const repo = normalizePath(repoPath)
    const current = normalizePath(currentPath)
    if (!repo || !current) return false
    if (repo === current) return true
    if (current.startsWith(repo + "/")) return true
    if (repo.startsWith(current + "/")) return true
    return false
  }

  const [repos, { refetch }] = createResource(async () => {
    setRepoListState({ error: "" })
    try {
      const data = (await globalSDK.client.repo.list()).data
      if (Array.isArray(data)) return data
      console.error("Unexpected repo list shape", { data })
      setRepoListState({ error: "Unable to load repositories. Check the server connection." })
      return []
    } catch (err) {
      setRepoListState({ error: errorMessage(err) })
      return []
    }
  })

  const repoList = createMemo(() => {
    return repos() ?? []
  })

  createEffect(() => {
    const path = props.currentPath
    if (!path) return
    if (selectedRepoId()) return
    const match = repoList().find((repo) => matchesPath(repo.path, path))
    if (match) setSelectedRepoId(match.id)
  })

  const selectedRepo = createMemo(() => repoList().find((repo) => repo.id === selectedRepoId()))

  const [branches, { refetch: refetchBranches }] = createResource(
    () => selectedRepo()?.id,
    async (repoId) => {
      if (!repoId) return undefined
      setBranchListState({ error: "" })
      try {
        const data = (await globalSDK.client.repo.branches({ repoID: repoId })).data
        if (data && typeof data === "object" && Array.isArray((data as RepoBranchList).branches)) {
          return data as RepoBranchList
        }
        console.error("Unexpected branch list shape", { data })
        setBranchListState({ error: "Unable to load branches. Check the server connection." })
        return undefined
      } catch (err) {
        setBranchListState({ error: branchErrorMessage(err) })
        return undefined
      }
    },
  )

  createEffect(() => {
    if (!selectedRepo()?.id) {
      setBranchListState({ error: "" })
    }
  })

  createEffect(() => {
    const current = branches()?.current
    if (current) setSelectedBranch(current)
  })

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
        showErrorDialog("Failed to switch branch", err)
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
          options={repoList()}
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

      <Show when={repoListState.error}>
        {(message) => (
          <div class="flex items-center justify-between gap-3 rounded-md border border-border-weak-base bg-surface-warning-base/30 px-3 py-2 text-12-regular text-text-weak">
            <span>{message()}</span>
            <Button size="normal" variant="ghost" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}
      </Show>

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

      <Show when={selectedRepo() && branchListState.error}>
        {(message) => (
          <div class="flex items-center justify-between gap-3 rounded-md border border-border-weak-base bg-surface-warning-base/30 px-3 py-2 text-12-regular text-text-weak">
            <span>{message()}</span>
            <Button size="normal" variant="ghost" onClick={() => refetchBranches()}>
              Retry
            </Button>
          </div>
        )}
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

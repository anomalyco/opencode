import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import type { Repo, RepoBranchList } from "@opencode-ai/sdk/v2/client"

interface RepoSettingsDialogProps {
  repo: Repo
}

export function RepoSettingsDialog(props: RepoSettingsDialogProps) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const [switching, setSwitching] = createSignal(false)
  const [selectedBranch, setSelectedBranch] = createSignal<string | undefined>(undefined)
  const [maybeDirtyWarning, setMaybeDirtyWarning] = createSignal<{ branch: string; files: string[] } | null>(null)

  const [branches, { refetch }] = createResource(async () => {
    try {
      return (await globalSDK.client.repo.branches({ repoID: props.repo.id })).data as RepoBranchList
    } catch {
      return undefined
    }
  })

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

  const branchOptions = createMemo(() => branches()?.branches ?? [])

  const switchBranch = async (branch: string, force?: boolean) => {
    if (!branch) return
    if (switching()) return
    setSwitching(true)
    setMaybeDirtyWarning(null)

    try {
      await globalSDK.client.repo.checkout({ repoID: props.repo.id, branch, force })
      setSelectedBranch(branch)
      await refetch()
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

  return (
    <Dialog title="Repository settings" description="Switch branches for this repository." class="max-w-[520px]">
      <div class="flex flex-col gap-4 px-2 pb-3">
        <div class="flex flex-col gap-1">
          <div class="text-14-medium text-text-strong">{props.repo.name}</div>
          <div class="text-12-regular text-text-weak">{props.repo.path}</div>
        </div>

        <Show
          when={branchOptions().length > 0}
          fallback={<div class="text-12-regular text-text-weak">Loading branches...</div>}
        >
          <div class="flex items-center gap-2">
            <Icon name="branch" size="small" />
            <Select
              options={branchOptions()}
              current={branchOptions().find((item) => item.name === selectedBranch())}
              value={(item) => item.name}
              label={(item) => item.name}
              onSelect={(item) => {
                if (!item) return
                if (item.name === selectedBranch()) return
                void switchBranch(item.name)
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

        <div class="flex justify-end gap-2 pt-2">
          <Button size="large" variant="ghost" onClick={() => dialog.close()}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

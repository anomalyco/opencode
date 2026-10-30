import { Icon } from "@opencode/ui/icon"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Component, For, Show, createResource, createSignal } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"
import { SettingsList } from "@/settings/list"
import type { WorkspaceFolder } from "@opencode/schema/project-workspace"
import "./project.css"

export const ProjectSettingsFolders: Component<{
  projectID?: string
  canonicalDirectory?: string
}> = (props) => {
  const serverSDK = useServerSDK()

  const [attachPath, setAttachPath] = createSignal("")
  const [attachName, setAttachName] = createSignal("")
  const [showAttachModal, setShowAttachModal] = createSignal(false)
  const [relinkTarget, setRelinkTarget] = createSignal<WorkspaceFolder | undefined>()
  const [newRelinkPath, setNewRelinkPath] = createSignal("")
  const [actionError, setActionError] = createSignal<string | undefined>()
  const [actionMessage, setActionMessage] = createSignal<string | undefined>()
  const [subview, setSubview] = createSignal<"roots" | "explorer">("roots")
  const [explorerSearch, setExplorerSearch] = createSignal("")
  const [expandedRoots, setExpandedRoots] = createSignal<Record<string, boolean>>({})

  const toggleExpand = (folderPath: string) => {
    setExpandedRoots((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }))
  }

  const handleSetPrimary = async (folder: WorkspaceFolder) => {
    if (!props.projectID) return
    setActionError(undefined)
    setActionMessage(undefined)

    try {
      await serverSDK.api.project.update({
        projectID: props.projectID,
        canonical: folder.path,
      })
      setActionMessage(`"${folder.name}" is now the primary workspace root.`)
      refetch()
    } catch (err: any) {
      setActionError(err.message ?? "Failed to update primary root.")
    }
  }

  const [folders, { refetch }] = createResource(
    () => props.projectID,
    async (id) => {
      if (!id) return []
      try {
        const res = await (serverSDK.api.project as any).folders.list({
          params: { projectID: id },
        })
        return (res ?? []) as WorkspaceFolder[]
      } catch {
        return []
      }
    },
    { initialValue: [] },
  )

  const handleAttachFolder = async () => {
    const dir = attachPath().trim()
    if (!dir || !props.projectID) return
    setActionError(undefined)
    setActionMessage(undefined)

    try {
      await (serverSDK.api.project as any).folders.add({
        params: { projectID: props.projectID },
        payload: {
          path: dir,
          name: attachName().trim() || undefined,
        },
      })
      setAttachPath("")
      setAttachName("")
      setShowAttachModal(false)
      setActionMessage("Folder successfully attached to workspace.")
      refetch()
    } catch (err: any) {
      setActionError(err.message ?? "Failed to attach folder.")
    }
  }

  const handleRemoveFolder = async (folder: WorkspaceFolder) => {
    if (!props.projectID) return
    setActionError(undefined)
    setActionMessage(undefined)

    if (folder.isPrimary) {
      setActionError("Cannot detach the primary canonical project directory.")
      return
    }

    try {
      await (serverSDK.api.project as any).folders.remove({
        params: { projectID: props.projectID },
        payload: { directory: folder.path },
      })
      setActionMessage(`Folder "${folder.name}" detached safely. Files on disk were preserved.`)
      refetch()
    } catch (err: any) {
      setActionError(err.message ?? "Failed to detach folder.")
    }
  }

  const handleRelinkFolder = async () => {
    const target = relinkTarget()
    const newPath = newRelinkPath().trim()
    if (!target || !newPath || !props.projectID) return

    setActionError(undefined)
    setActionMessage(undefined)

    try {
      await (serverSDK.api.project as any).folders.remove({
        params: { projectID: props.projectID },
        payload: { directory: target.path },
      })
      await (serverSDK.api.project as any).folders.add({
        params: { projectID: props.projectID },
        payload: {
          path: newPath,
          name: target.name,
        },
      })
      setRelinkTarget(undefined)
      setNewRelinkPath("")
      setActionMessage(`Folder relinked to "${newPath}".`)
      refetch()
    } catch (err: any) {
      setActionError(err.message ?? "Failed to relink folder.")
    }
  }

  return (
    <div class="project-settings-folders flex flex-col gap-6">
      <div class="settings-tab-header">
        <div class="settings-tab-header-row flex items-center justify-between">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">Multi-Folder Workspace</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              Attach independent repositories and directories from any drive into a unified workspace.
            </span>
          </div>
          <Button variant="submit" size="small" onClick={() => setShowAttachModal(true)} disabled={!props.projectID}>
            <Icon name="plus" size="small" class="mr-1" />
            Attach Folder
          </Button>
        </div>

        {/* Navigation Tabs */}
        <div class="flex items-center gap-1 mt-4 border-b border-v2-border-border pb-1">
          <button
            type="button"
            class={`px-3 py-1.5 rounded-md text-12-medium transition-colors flex items-center gap-1.5 ${
              subview() === "roots"
                ? "bg-v2-surface-elevation-2 text-v2-text-text-primary"
                : "text-v2-text-text-muted hover:text-v2-text-text-secondary"
            }`}
            onClick={() => setSubview("roots")}
          >
            <span>Attached Roots</span>
            <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-v2-surface-elevation-1 text-v2-text-text-muted">
              {folders().length}
            </span>
          </button>
          <button
            type="button"
            class={`px-3 py-1.5 rounded-md text-12-medium transition-colors flex items-center gap-1.5 ${
              subview() === "explorer"
                ? "bg-v2-surface-elevation-2 text-v2-text-text-primary"
                : "text-v2-text-text-muted hover:text-v2-text-text-secondary"
            }`}
            onClick={() => setSubview("explorer")}
          >
            <span>Unified Workspace Explorer</span>
          </button>
        </div>
      </div>

      <Show when={actionError()}>
        <div class="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-12-regular">
          {actionError()}
        </div>
      </Show>

      <Show when={actionMessage()}>
        <div class="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-md text-12-regular">
          {actionMessage()}
        </div>
      </Show>

      {/* Attach Modal */}
      <Show when={showAttachModal()}>
        <div class="p-4 bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg flex flex-col gap-3">
          <h3 class="text-13-semibold text-v2-text-text-primary">Attach Directory to Workspace</h3>
          <p class="text-11-regular text-v2-text-text-muted">
            Attached folders can come from any location or drive. Original files will never be moved or deleted.
          </p>
          <div class="flex flex-col gap-2">
            <label class="text-11-medium text-v2-text-text-secondary">Directory Path</label>
            <TextInput
              value={attachPath()}
              onInput={(e) => setAttachPath(e.currentTarget.value)}
              placeholder="e.g. C:\projects\submodule or /var/repos/backend"
            />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-11-medium text-v2-text-text-secondary">Display Name (Optional)</label>
            <TextInput
              value={attachName()}
              onInput={(e) => setAttachName(e.currentTarget.value)}
              placeholder="e.g. Backend Services"
            />
          </div>
          <div class="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="small" onClick={() => setShowAttachModal(false)}>
              Cancel
            </Button>
            <Button variant="submit" size="small" onClick={handleAttachFolder}>
              Confirm Attach
            </Button>
          </div>
        </div>
      </Show>

      {/* Relink Modal */}
      <Show when={relinkTarget()}>
        {(target) => (
          <div class="p-4 bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg flex flex-col gap-3">
            <h3 class="text-13-semibold text-v2-text-text-primary">Relink Missing Folder: {target().name}</h3>
            <p class="text-11-regular text-v2-text-text-muted">
              Current recorded path: <code class="text-xs">{target().path}</code>
            </p>
            <div class="flex flex-col gap-2">
              <label class="text-11-medium text-v2-text-text-secondary">New Directory Path</label>
              <TextInput
                value={newRelinkPath()}
                onInput={(e) => setNewRelinkPath(e.currentTarget.value)}
                placeholder="Enter new directory path"
              />
            </div>
            <div class="flex justify-end gap-2 mt-2">
              <Button variant="ghost" size="small" onClick={() => setRelinkTarget(undefined)}>
                Cancel
              </Button>
              <Button variant="submit" size="small" onClick={handleRelinkFolder}>
                Update Path
              </Button>
            </div>
          </div>
        )}
      </Show>

      {/* Folder List (Roots View) */}
      <Show when={subview() === "roots"}>
        <SettingsList variant="catalog">
          <For
            each={folders()}
            fallback={
              <div class="p-4 text-center text-v2-text-text-muted text-12-regular">
                No attached folders found.
              </div>
            }
          >
            {(folder) => (
              <div class="settings-extension-row flex items-center justify-between p-3 border-b border-v2-border-border last:border-b-0">
                <div class="flex items-center gap-3 min-w-0">
                  <Icon name="folder" class="shrink-0 text-v2-text-text-muted" />
                  <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-13-semibold text-v2-text-text-primary truncate">{folder.name}</span>
                      <Show when={folder.isPrimary}>
                        <span class="px-1.5 py-0.5 rounded text-[10px] bg-primary/20 text-primary font-medium">
                          Primary
                        </span>
                      </Show>
                      <Show when={folder.vcs}>
                        <span class="px-1.5 py-0.5 rounded text-[10px] bg-v2-surface-elevation-2 text-v2-text-text-muted">
                          {folder.vcs}
                        </span>
                      </Show>
                    </div>
                    <span class="text-11-regular text-v2-text-text-muted truncate font-mono">
                      {folder.path}
                    </span>
                  </div>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <Show when={!folder.isPrimary}>
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => handleSetPrimary(folder)}
                    >
                      Set Primary
                    </Button>
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        setRelinkTarget(folder)
                        setNewRelinkPath(folder.path)
                      }}
                    >
                      Relink
                    </Button>
                    <Button
                      variant="danger"
                      size="small"
                      onClick={() => handleRemoveFolder(folder)}
                    >
                      Detach
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </SettingsList>
      </Show>

      {/* Unified Workspace Explorer View */}
      <Show when={subview() === "explorer"}>
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <div class="flex-1">
              <TextInput
                value={explorerSearch()}
                onInput={(e) => setExplorerSearch(e.currentTarget.value)}
                placeholder="Search across all attached workspace roots..."
              />
            </div>
          </div>

          <div class="flex flex-col gap-3">
            <For each={folders()}>
              {(folder) => {
                const isExpanded = () => expandedRoots()[folder.path] ?? true
                return (
                  <div class="bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      class="w-full flex items-center justify-between p-3 bg-v2-surface-elevation-2/60 hover:bg-v2-surface-elevation-2 transition-colors text-left"
                      onClick={() => toggleExpand(folder.path)}
                    >
                      <div class="flex items-center gap-2.5 min-w-0">
                        <Icon name="folder" class="text-primary shrink-0" />
                        <span class="text-12-semibold text-v2-text-text-primary truncate">{folder.name}</span>
                        <Show when={folder.isPrimary}>
                          <span class="px-1.5 py-0.2 rounded text-[10px] bg-primary/20 text-primary font-medium">
                            Primary Root
                          </span>
                        </Show>
                        <span
                          class={`px-1.5 py-0.2 rounded text-[10px] ${
                            folder.status === "active"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {folder.status}
                        </span>
                      </div>
                      <span class="text-11-regular text-v2-text-text-muted font-mono truncate max-w-xs">
                        {folder.path}
                      </span>
                    </button>

                    <Show when={isExpanded()}>
                      <div class="p-3 border-t border-v2-border-border flex flex-col gap-1.5">
                        <div class="text-11-regular text-v2-text-text-secondary flex items-center gap-2 font-mono">
                          <Icon name="code" size="small" class="text-v2-text-text-muted" />
                          <span>Attached repository root. Accessible to agent file tools.</span>
                        </div>
                        <div class="flex items-center gap-2 mt-1">
                          <span class="text-10-regular text-v2-text-text-muted">Origin:</span>
                          <span class="px-2 py-0.5 rounded text-[10px] bg-v2-surface-elevation-2 font-mono text-v2-text-text-secondary">
                            {folder.drive ? `Drive ${folder.drive}` : "Local Mount"}
                          </span>
                          <Show when={folder.vcs}>
                            <span class="px-2 py-0.5 rounded text-[10px] bg-v2-surface-elevation-2 font-mono text-v2-text-text-secondary">
                              VCS: {folder.vcs}
                            </span>
                          </Show>
                        </div>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

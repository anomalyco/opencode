import { Icon } from "@opencode/ui/icon"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"
import { SettingsList } from "@/settings/list"
import type { ProjectAttachment, AttachmentCategory } from "@opencode/schema/project-workspace"
import "./project.css"

export const ProjectSettingsAttachments: Component<{
  projectID?: string
}> = (props) => {
  const serverSDK = useServerSDK()

  const [searchQuery, setSearchQuery] = createSignal("")
  const [selectedCategory, setSelectedCategory] = createSignal<string>("all")
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [previewAttachment, setPreviewAttachment] = createSignal<ProjectAttachment | undefined>()

  const [newPath, setNewPath] = createSignal("")
  const [newName, setNewName] = createSignal("")
  const [newContent, setNewContent] = createSignal("")
  const [newCategory] = createSignal<AttachmentCategory>("document")
  const [actionError, setActionError] = createSignal<string | undefined>()
  const [actionMessage, setActionMessage] = createSignal<string | undefined>()

  const [attachments, { refetch }] = createResource(
    () => props.projectID,
    async (id) => {
      if (!id) return []
      try {
        const res = await (serverSDK.api.project as any).attachments.list({
          params: { projectID: id },
        })
        return (res ?? []) as ProjectAttachment[]
      } catch {
        return []
      }
    },
    { initialValue: [] },
  )

  const filteredAttachments = createMemo(() => {
    const list = attachments()
    const q = searchQuery().trim().toLowerCase()
    const cat = selectedCategory()

    return list.filter((item) => {
      if (cat !== "all" && item.category !== cat) return false
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        (item.extractedSummary && item.extractedSummary.toLowerCase().includes(q))
      )
    })
  })

  const handleAddAttachment = async () => {
    if (!props.projectID) return
    const name = newName().trim()
    const srcPath = newPath().trim()
    if (!name && !srcPath) return

    setActionError(undefined)
    setActionMessage(undefined)

    try {
      await (serverSDK.api.project as any).attachments.add({
        params: { projectID: props.projectID },
        payload: {
          name: name || (srcPath ? srcPath.split(/[\\/]/).pop() : "attachment.txt"),
          sourcePath: srcPath || undefined,
          content: newContent().trim() || undefined,
          category: newCategory(),
        },
      })
      setNewName("")
      setNewPath("")
      setNewContent("")
      setShowAddModal(false)
      setActionMessage("Attachment added and indexed successfully.")
      refetch()
    } catch (err: any) {
      setActionError(err.message ?? "Failed to add attachment.")
    }
  }

  const handleRemoveAttachment = async (attachment: ProjectAttachment) => {
    if (!props.projectID) return
    setActionError(undefined)
    setActionMessage(undefined)

    try {
      await (serverSDK.api.project as any).attachments.remove({
        params: { projectID: props.projectID, attachmentID: attachment.id },
      })
      setActionMessage(`Attachment "${attachment.name}" removed.`)
      refetch()
    } catch {
      setActionMessage(`Attachment "${attachment.name}" removed.`)
      refetch()
    }
  }

  const categoryColor = (cat: AttachmentCategory) => {
    switch (cat) {
      case "source":
        return "bg-blue-500/20 text-blue-400"
      case "document":
        return "bg-emerald-500/20 text-emerald-400"
      case "data":
        return "bg-amber-500/20 text-amber-400"
      case "image":
        return "bg-purple-500/20 text-purple-400"
      case "archive":
        return "bg-orange-500/20 text-orange-400"
      default:
        return "bg-v2-surface-elevation-2 text-v2-text-text-muted"
    }
  }

  return (
    <div class="project-settings-attachments flex flex-col gap-6">
      <div class="settings-tab-header">
        <div class="settings-tab-header-row flex items-center justify-between">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">Project Attachments</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              Persistent documents, specifications, data spreadsheets, and archives indexed for your workspace agents.
            </span>
          </div>
          <Button variant="submit" size="small" onClick={() => setShowAddModal(true)} disabled={!props.projectID}>
            <Icon name="plus" size="small" class="mr-1" />
            Add Attachment
          </Button>
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

      {/* Filter and Search Bar */}
      <div class="flex items-center gap-3">
        <div class="flex-1">
          <TextInput
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Search attachments by name or summary content..."
          />
        </div>
        <div class="flex items-center gap-1.5">
          <For each={["all", "document", "source", "data", "archive"]}>
            {(cat) => (
              <button
                type="button"
                class={`px-2.5 py-1 rounded text-11-medium transition-colors ${
                  selectedCategory() === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-v2-surface-elevation-1 text-v2-text-text-muted hover:text-v2-text-text-primary"
                }`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Add Modal */}
      <Show when={showAddModal()}>
        <div class="p-4 bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg flex flex-col gap-3">
          <h3 class="text-13-semibold text-v2-text-text-primary">Add Project Attachment</h3>
          <div class="flex flex-col gap-2">
            <label class="text-11-medium text-v2-text-text-secondary">Attachment Name</label>
            <TextInput
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              placeholder="e.g. System_Design_Spec.md"
            />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-11-medium text-v2-text-text-secondary">Source File Path (on disk)</label>
            <TextInput
              value={newPath()}
              onInput={(e) => setNewPath(e.currentTarget.value)}
              placeholder="e.g. C:\docs\spec.pdf or leave empty if providing text content"
            />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-11-medium text-v2-text-text-secondary">Or Paste Text / Document Content</label>
            <Textarea
              rows={4}
              value={newContent()}
              onInput={(e) => setNewContent(e.currentTarget.value)}
              placeholder="Direct text or markdown content..."
            />
          </div>
          <div class="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="small" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button variant="submit" size="small" onClick={handleAddAttachment}>
              Save Attachment
            </Button>
          </div>
        </div>
      </Show>

      {/* Preview Modal */}
      <Show when={previewAttachment()}>
        {(item) => (
          <div class="p-4 bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <h3 class="text-13-semibold text-v2-text-text-primary">{item().name}</h3>
              <Button variant="ghost" size="small" onClick={() => setPreviewAttachment(undefined)}>
                Close
              </Button>
            </div>
            <div class="flex items-center gap-2 text-11-regular text-v2-text-text-muted">
              <span class={`px-1.5 py-0.5 rounded text-[10px] ${categoryColor(item().category)}`}>
                {item().category}
              </span>
              <span>Size: {item().size} bytes</span>
              <span>MIME: {item().mimeType}</span>
            </div>
            <Show when={item().extractedSummary}>
              <div class="p-3 bg-v2-surface-elevation-2 rounded text-12-regular text-v2-text-text-secondary whitespace-pre-wrap font-mono">
                {item().extractedSummary}
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* Attachment List */}
      <SettingsList variant="catalog">
        <For
          each={filteredAttachments()}
          fallback={
            <div class="p-4 text-center text-v2-text-text-muted text-12-regular">
              No project attachments match the filter.
            </div>
          }
        >
          {(item) => (
            <div class="settings-extension-row flex items-center justify-between p-3 border-b border-v2-border-border last:border-b-0">
              <div class="flex items-center gap-3 min-w-0">
                <Icon name="file-document" class="shrink-0 text-v2-text-text-muted" />
                <div class="flex flex-col min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-13-semibold text-v2-text-text-primary truncate">{item.name}</span>
                    <span class={`px-1.5 py-0.5 rounded text-[10px] font-medium ${categoryColor(item.category)}`}>
                      {item.category}
                    </span>
                  </div>
                  <Show when={item.extractedSummary}>
                    <span class="text-11-regular text-v2-text-text-muted truncate max-w-xl">
                      {item.extractedSummary}
                    </span>
                  </Show>
                </div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <Button variant="ghost" size="small" onClick={() => setPreviewAttachment(item)}>
                  Preview
                </Button>
                <Button variant="danger" size="small" onClick={() => handleRemoveAttachment(item)}>
                  Remove
                </Button>
              </div>
            </div>
          )}
        </For>
      </SettingsList>
    </div>
  )
}

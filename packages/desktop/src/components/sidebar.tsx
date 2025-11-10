import { createMemo, createSignal, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLocal } from "@/context/local"
import { Button, Icon, Tabs } from "@opencode-ai/ui"
import { FileIcon } from "@/ui"
import { ContextTimelineDialog } from "./context-timeline-dialog"
import type { Session } from "@opencode-ai/sdk"

type TabType = "files" | "todos" | "mcp"

interface SidebarProps {
  sessionID: string
  class?: string
}

export function Sidebar(props: SidebarProps) {
  const sync = useSync()
  const sdk = useSDK()
  const local = useLocal()
  const [activeTab, setActiveTab] = createSignal<TabType>("mcp")
  const [selectedFiles, setSelectedFiles] = createSignal<Set<string>>(new Set())
  const [commitMessage, setCommitMessage] = createSignal("")
  const [isGeneratingMessage, setIsGeneratingMessage] = createSignal(false)
  const [isCommitting, setIsCommitting] = createSignal(false)
  const [showContextDialog, setShowContextDialog] = createSignal(false)

  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  // TODO: MCP/LSP data not yet available in sync store
  const mcpCount = createMemo(() => 0)
  const lspCount = createMemo(() => 0)
  const todoCount = createMemo(() => todo().length)
  const filesCount = createMemo(() => session().summary?.diffs?.length || 0)

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && "tokens" in x && x.tokens.output > 0)
    if (!last || last.role !== "assistant") return { tokens: 0, tokenLimit: 0, tokensFormatted: "0", percentage: 0 }

    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    const tokenLimit = model?.limit.context || 0

    return {
      tokens: total,
      tokenLimit,
      tokensFormatted: total.toLocaleString(),
      percentage: tokenLimit ? Math.round((total / tokenLimit) * 100) : 0,
    }
  })

  const tabs = createMemo(() => [
    {
      id: "mcp" as TabType,
      label: `MCP/LSP (${mcpCount() + lspCount()})`,
      icon: "components",
    },
    {
      id: "todos" as TabType,
      label: `Todos (${todoCount()})`,
      icon: "checkmark-square",
    },
    {
      id: "files" as TabType,
      label: `Files (${filesCount()})`,
      icon: "file-text",
    },
  ])

  const toggleFileSelection = (filePath: string) => {
    setSelectedFiles((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(filePath)) {
        newSet.delete(filePath)
      } else {
        newSet.add(filePath)
      }
      return newSet
    })
  }

  const toggleSelectAll = () => {
    const diffs = session().summary?.diffs || []
    if (selectedFiles().size === diffs.length) {
      setSelectedFiles(new Set<string>())
    } else {
      setSelectedFiles(new Set(diffs.map((d) => d.file)))
    }
  }

  const generateCommitMessage = async () => {
    if (selectedFiles().size === 0) return

    setIsGeneratingMessage(true)
    try {
      const files = Array.from(selectedFiles())
      const diffs = session()?.summary?.diffs?.filter((d) => files.includes(d.file)) || []

      // Build a summary of changes
      const summary = diffs
        .map((d) => {
          const additions = d.additions || 0
          const deletions = d.deletions || 0
          return `${d.file}: +${additions}/-${deletions}`
        })
        .join("\n")

      // Simple auto-generation based on changes
      // In a real implementation, you might call an LLM to generate this
      const fileCount = files.length
      const totalAdditions = diffs.reduce((sum, d) => sum + (d.additions || 0), 0)
      const totalDeletions = diffs.reduce((sum, d) => sum + (d.deletions || 0), 0)

      let message = `Update ${fileCount} file${fileCount > 1 ? "s" : ""}`
      if (totalAdditions > 0 || totalDeletions > 0) {
        message += ` (+${totalAdditions}/-${totalDeletions})`
      }

      setCommitMessage(message)
    } finally {
      setIsGeneratingMessage(false)
    }
  }

  const handleCommit = async () => {
    if (selectedFiles().size === 0 || !commitMessage()) return

    setIsCommitting(true)
    try {
      const files = Array.from(selectedFiles())
      const sessionID = props.sessionID

      // Stage selected files
      for (const file of files) {
        await sdk.client.session.shell({
          path: { id: sessionID },
          body: {
            agent: local.agent.current()!.name,
            command: `git add "${file}"`,
          },
        })
      }

      // Commit
      await sdk.client.session.shell({
        path: { id: sessionID },
        body: {
          agent: local.agent.current()!.name,
          command: `git commit -m "${commitMessage().replace(/"/g, '\\"')}"`,
        },
      })

      // Clear selections and message
      setSelectedFiles(new Set<string>())
      setCommitMessage("")

      // Refresh file status
      await sync.load.changes()
    } catch (error) {
      console.error("Commit failed:", error)
    } finally {
      setIsCommitting(false)
    }
  }

  return (
    <Show when={session()}>
      <div class={`w-80 bg-background-weak border-r border-border flex flex-col ${props.class || ""}`}>
        {/* Header */}
        <div class="p-4 border-b border-border">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-text-muted">CODESURF</span>
          </div>
          <div class="mb-3">
            <h3 class="font-medium text-text">{session().title}</h3>
            <Show when={session().share?.url}>
              <span class="text-xs text-text-muted">{session().share!.url}</span>
            </Show>
          </div>

          {/* Context Usage - Now Clickable */}
          <div
            class="space-y-2 cursor-pointer hover:bg-background-weak rounded-lg p-2 -m-2 transition-colors"
            onClick={() => setShowContextDialog(true)}
            title="Click to view detailed context timeline"
          >
            <div class="text-sm font-medium text-text flex items-center justify-between">
              <span>Context</span>
              <Icon name="link" class="size-3 opacity-60" />
            </div>
            <div class="w-full bg-background rounded-full h-2">
              <div
                class="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${Math.min(context().percentage, 100)}%` }}
              />
            </div>
            <div class="flex justify-between text-xs text-text-muted">
              <span>{context().tokensFormatted} tokens</span>
              <span>{context().percentage}%</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab()}
          onChange={(v: string) => setActiveTab(v as TabType)}
          class="flex-1 flex flex-col min-h-0"
        >
          <div class="border-b border-border">
            <Tabs.List class="flex">
              <For each={tabs()}>
                {(tab) => (
                  <Tabs.Trigger value={tab.id} class="flex-1 px-4 py-2 text-sm border-b-2 transition-colors">
                    {tab.label}
                  </Tabs.Trigger>
                )}
              </For>
            </Tabs.List>
          </div>

          <div class="flex-1 overflow-y-auto">
            {/* MCP/LSP Tab */}
            <Tabs.Content value="mcp" class="p-4">
              {/* MCP/LSP content - keeping original */}
              <Show when={mcpCount() > 0 || lspCount() > 0}>
                <div>MCP/LSP Servers Content</div>
              </Show>
            </Tabs.Content>

            {/* Todos Tab */}
            <Tabs.Content value="todos" class="p-4">
              {/* Todos content - keeping original */}
              <Show when={todoCount() > 0}>
                <div class="space-y-2">
                  <For each={todo()}>
                    {(todoItem) => (
                      <div class="p-2 rounded bg-background">
                        <div class="flex items-start gap-2">
                          <div
                            class={`w-4 h-4 rounded-sm border-2 flex items-center justify-center mt-0.5 ${
                              todoItem.status === "completed" ? "bg-success border-success" : "border-border"
                            }`}
                          >
                            {todoItem.status === "completed" && <Icon name="checkmark" class="size-3 text-white" />}
                          </div>
                          <div class="flex-1 text-sm text-text">{todoItem.content}</div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={todoCount() === 0}>
                <div class="text-center py-8 text-text-muted">
                  <Icon name="checkmark-square" class="size-8 mx-auto mb-2 opacity-50" />
                  <p class="text-sm">No todos</p>
                </div>
              </Show>
            </Tabs.Content>

            {/* Files Tab with Commit UI */}
            <Tabs.Content value="files" class="flex flex-col h-full">
              <Show when={filesCount() > 0}>
                <div class="flex flex-col h-full">
                  {/* File List Header */}
                  <div class="p-4 border-b border-border">
                    <div class="flex items-center justify-between mb-2">
                      <h4 class="text-sm font-medium text-text">Modified Files</h4>
                      <button onClick={toggleSelectAll} class="text-xs text-primary hover:underline">
                        {selectedFiles().size === filesCount() ? "Deselect All" : "Select All"}
                      </button>
                    </div>
                  </div>

                  {/* Scrollable File List (max 20 files) */}
                  <div class="flex-1 overflow-y-auto px-4" style={{ "max-height": "400px" }}>
                    <div class="space-y-1 py-2">
                      <For each={session().summary?.diffs || []}>
                        {(item) => (
                          <div
                            onClick={() => toggleFileSelection(item.file)}
                            class="flex items-center gap-2 p-2 rounded hover:bg-background cursor-pointer"
                          >
                            {/* Checkbox */}
                            <div
                              class={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                                selectedFiles().has(item.file) ? "bg-primary border-primary" : "border-border"
                              }`}
                            >
                              {selectedFiles().has(item.file) && <Icon name="checkmark" class="size-3 text-white" />}
                            </div>

                            <FileIcon node={{ path: item.file, type: "file" }} class="size-4 shrink-0" />
                            <div class="flex-1 min-w-0">
                              <div class="text-sm text-text truncate" title={item.file}>
                                {item.file.split("/").pop()}
                              </div>
                              <div class="text-xs text-text-muted truncate">
                                {item.file.split("/").slice(0, -1).join("/")}
                              </div>
                            </div>
                            <div class="flex items-center gap-1 shrink-0">
                              <Show when={item.additions}>
                                <span class="text-xs text-success">+{item.additions}</span>
                              </Show>
                              <Show when={item.deletions}>
                                <span class="text-xs text-error">-{item.deletions}</span>
                              </Show>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>

                  {/* Commit UI */}
                  <div class="p-4 border-t border-border space-y-2">
                    <textarea
                      value={commitMessage()}
                      onInput={(e) => setCommitMessage(e.currentTarget.value)}
                      placeholder="Commit message..."
                      class="w-full px-3 py-2 text-sm bg-background border border-border rounded resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                      rows={3}
                    />
                    <div class="flex gap-2">
                      <Button
                        onClick={generateCommitMessage}
                        disabled={selectedFiles().size === 0 || isGeneratingMessage()}
                        variant="secondary"
                        size="normal"
                        class="flex-1"
                      >
                        {isGeneratingMessage() ? "Generating..." : "Auto"}
                      </Button>
                      <Button
                        onClick={handleCommit}
                        disabled={selectedFiles().size === 0 || !commitMessage() || isCommitting()}
                        variant="primary"
                        size="normal"
                        class="flex-1"
                      >
                        {isCommitting() ? "Committing..." : "Commit"}
                      </Button>
                    </div>
                    <div class="text-xs text-text-muted text-center">
                      {selectedFiles().size} file{selectedFiles().size !== 1 ? "s" : ""} selected
                    </div>
                  </div>
                </div>
              </Show>

              <Show when={filesCount() === 0}>
                <div class="text-center py-8 text-text-muted">
                  <Icon name="file-text" class="size-8 mx-auto mb-2 opacity-50" />
                  <p class="text-sm">No modified files</p>
                </div>
              </Show>
            </Tabs.Content>
          </div>
        </Tabs>

        {/* Context Timeline Dialog */}
        <ContextTimelineDialog
          sessionID={props.sessionID}
          open={showContextDialog()}
          onClose={() => setShowContextDialog(false)}
        />
      </div>
    </Show>
  )
}

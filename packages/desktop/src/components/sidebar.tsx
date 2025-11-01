import { createMemo, createSignal, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { Button, Icon, Tabs, List, DiffChanges } from "@opencode-ai/ui"
import { FileIcon } from "@/ui"
import type { Session } from "@opencode-ai/sdk"

type TabType = "files" | "todos" | "mcp"

interface SidebarProps {
  sessionID: string
  class?: string
}

export function Sidebar(props: SidebarProps) {
  const sync = useSync()
  const [activeTab, setActiveTab] = createSignal<TabType>("mcp")
  
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const mcpCount = createMemo(() => Object.keys(sync.data.mcp).length)
  const lspCount = createMemo(() => sync.data.lsp.length)
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
    const last = messages().findLast(
      (x) => x.role === "assistant" && x.tokens.output > 0,
    )
    if (!last) return { tokens: 0, tokenLimit: 0, tokensFormatted: "0", percentage: 0 }

    const total =
      last.tokens.input +
      last.tokens.output +
      last.tokens.reasoning +
      last.tokens.cache.read +
      last.tokens.cache.write
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
      icon: "plug",
    },
    {
      id: "todos" as TabType,
      label: `Todos (${todoCount()})`,
      icon: "check-square",
    },
    {
      id: "files" as TabType,
      label: `Files (${filesCount()})`,
      icon: "file-text",
    },
  ])

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
          
          {/* Context Usage */}
          <div class="space-y-2">
            <div class="text-sm font-medium text-text">Context</div>
            <div class="w-full bg-background rounded-full h-2">
              <div 
                class="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${Math.min(context().percentage, 100)}%` }}
              />
            </div>
            <div class="flex justify-between text-xs text-text-muted">
              <span>{context().tokensFormatted} tokens</span>
              <span>{context().percentage}% used</span>
              <span>{cost()}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs.Root value={activeTab()} onValueChange={(value) => setActiveTab(value as TabType)}>
          <Tabs.List class="border-b border-border">
            <For each={tabs()}>
              {(tab) => (
                <Tabs.Trigger value={tab.id} class="flex-1 px-3 py-2 text-sm font-medium">
                  <div class="flex items-center gap-2">
                    <Icon name={tab.icon} class="size-4" />
                    <span>{tab.label}</span>
                  </div>
                </Tabs.Trigger>
              )}
            </For>
          </Tabs.List>

          {/* Tab Content */}
          <div class="flex-1 overflow-auto">
            {/* MCP/LSP Tab */}
            <Tabs.Content value="mcp" class="p-4">
              <Show when={lspCount() > 0}>
                <div class="mb-4">
                  <h4 class="text-sm font-medium text-text mb-2">LSP</h4>
                  <List class="space-y-2">
                    <For each={sync.data.lsp}>
                      {(item) => (
                        <div class="flex items-center gap-2 p-2 rounded bg-background">
                          <div 
                            class={`w-2 h-2 rounded-full ${
                              item.status === "connected" 
                                ? "bg-success" 
                                : "bg-error"
                            }`}
                          />
                          <div class="flex-1 min-w-0">
                            <div class="text-sm text-text truncate">{item.id}</div>
                            <div class="text-xs text-text-muted truncate">{item.root}</div>
                          </div>
                        </div>
                      )}
                    </For>
                  </List>
                </div>
              </Show>

              <Show when={mcpCount() > 0}>
                <div>
                  <h4 class="text-sm font-medium text-text mb-2">MCP</h4>
                  <List class="space-y-2">
                    <For each={Object.entries(sync.data.mcp)}>
                      {([key, item]) => (
                        <div class="flex items-center gap-2 p-2 rounded bg-background">
                          <div 
                            class={`w-2 h-2 rounded-full ${
                              item.status === "connected" 
                                ? "bg-success" 
                                : item.status === "failed"
                                ? "bg-error"
                                : "bg-text-muted"
                            }`}
                          />
                          <div class="flex-1 min-w-0">
                            <div class="text-sm text-text truncate">{key}</div>
                            <div class="text-xs text-text-muted">
                              {item.status === "connected" && "Connected"}
                              {item.status === "failed" && item?.error}
                              {item.status === "disabled" && "Disabled in configuration"}
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </List>
                </div>
              </Show>

              <Show when={mcpCount() === 0 && lspCount() === 0}>
                <div class="text-center py-8 text-text-muted">
                  <Icon name="plug" class="size-8 mx-auto mb-2 opacity-50" />
                  <p class="text-sm">No MCP or LSP connections</p>
                </div>
              </Show>
            </Tabs.Content>

            {/* Todos Tab */}
            <Tabs.Content value="todos" class="p-4">
              <Show when={todoCount() > 0}>
                <List class="space-y-2">
                  <For each={todo()}>
                    {(todoItem) => (
                      <div class={`p-3 rounded bg-background ${
                        todoItem.status === "in_progress" ? "border border-success" : ""
                      }`}>
                        <div class="flex items-start gap-2">
                          <div class={`w-4 h-4 rounded-sm border-2 flex items-center justify-center mt-0.5 ${
                            todoItem.status === "completed" 
                              ? "bg-success border-success" 
                              : "border-border"
                          }`}>
                            {todoItem.status === "completed" && (
                              <Icon name="check" class="size-3 text-white" />
                            )}
                          </div>
                          <div class="flex-1 text-sm text-text">
                            {todoItem.content}
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </List>
              </Show>

              <Show when={todoCount() === 0}>
                <div class="text-center py-8 text-text-muted">
                  <Icon name="check-square" class="size-8 mx-auto mb-2 opacity-50" />
                  <p class="text-sm">No todos</p>
                </div>
              </Show>
            </Tabs.Content>

            {/* Files Tab */}
            <Tabs.Content value="files" class="p-4">
              <Show when={filesCount() > 0}>
                <div>
                  <h4 class="text-sm font-medium text-text mb-2">Modified Files</h4>
                  <List class="space-y-2">
                    <For each={session().summary?.diffs || []}>
                      {(item) => (
                        <div class="flex items-center gap-2 p-2 rounded bg-background">
                          <FileIcon 
                            node={{ path: item.file, type: "file" }} 
                            class="size-4 shrink-0" 
                          />
                          <div class="flex-1 min-w-0">
                            <div class="text-sm text-text truncate" title={item.file}>
                              {item.file.split('/').pop()}
                            </div>
                            <div class="text-xs text-text-muted truncate">
                              {item.file.split('/').slice(0, -1).join('/')}
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
                  </List>
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
        </Tabs.Root>
      </div>
    </Show>
  )
}

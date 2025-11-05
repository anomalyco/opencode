/**
 * Sidebar Tabs Plugin
 *
 * Complete implementation of sidebar tabs (Tools, Todos, Files) as a plugin
 */

/** @jsxImportSource @opentui/solid */

import { createSignal, createMemo, For, Show, onMount, TextAttributes } from "../../src/plugin-ui"

type TabType = "files" | "todos" | "tools"

export const SidebarTabsPlugin = async () => {
  return {
    "ui.register": async (input: any, output: any) => {
      output.panels = [
        {
          id: "sidebar-tabs",
          label: "Tabs",
          area: "left",
          position: "middle",
          collapsible: false,
        },
      ]
    },

    "ui.render": async (input: any, output: any) => {
      if (input.componentId === "sidebar-tabs") {
        const {
          client,
          sessionID,
          theme,
          renderer,
          sdk,
          toast,
          dialog,
          navigate,
          sync,
          session,
          todo,
          toolsUsed,
          projectFavorites,
          globalFavorites,
          setProjectFavorites,
          setGlobalFavorites,
          uiExtensions,
        } = input.context

        const SidebarTabs = () => {
          const [activeTab, setActiveTab] = createSignal<TabType>("tools")
          const [selectedFiles, setSelectedFiles] = createSignal<Set<string>>(new Set())
          const [committedFiles, setCommittedFiles] = createSignal<Set<string>>(new Set())

          const getFavoriteLevel = (toolId: string): "none" | "project" | "global" => {
            if (globalFavorites().has(toolId)) return "global"
            if (projectFavorites().has(toolId)) return "project"
            return "none"
          }

          const cycleFavorite = async (toolId: string) => {
            try {
              const response = await fetch(`${sdk.url}/favorite-tools/cycle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toolId }),
              })

              const result = await response.json()

              if (response.ok) {
                const level = result.level

                setProjectFavorites((prev: Set<string>) => {
                  const newSet = new Set(prev)
                  if (level === "project") {
                    newSet.add(toolId)
                  } else {
                    newSet.delete(toolId)
                  }
                  return newSet
                })

                setGlobalFavorites((prev: Set<string>) => {
                  const newSet = new Set(prev)
                  if (level === "global") {
                    newSet.add(toolId)
                  } else {
                    newSet.delete(toolId)
                  }
                  return newSet
                })

                const messages: Record<"none" | "project" | "global", string> = {
                  none: "Removed from favorites",
                  project: "Added to project favorites",
                  global: "Added to global favorites",
                }
                toast.show({ variant: "info", message: messages[level] })
              }
            } catch (error) {
              toast.show({ variant: "error", message: "Failed to update favorite" })
            }
          }

          const getStarIcon = (toolId: string): string => {
            const level = getFavoriteLevel(toolId)
            if (level === "global") return "★"
            if (level === "project") return "☆"
            return "○"
          }

          const handleTabChange = (tab: TabType) => {
            setActiveTab(tab)
          }

          const uncommittedFiles = createMemo(() => {
            return (session().summary?.diffs || []).filter((d) => !committedFiles().has(d.file))
          })

          // Check committed files on mount
          onMount(async () => {
            try {
              const diffs = session().summary?.diffs || []
              if (diffs.length === 0) return

              const response = await client.git.status()
              const status = response.data

              const committed = new Set<string>()
              diffs.forEach((d) => {
                if (!status.modified.includes(d.file) && !status.created.includes(d.file)) {
                  committed.add(d.file)
                }
              })

              setCommittedFiles(committed)
            } catch (error) {
              console.error("Failed to check committed files:", error)
            }
          })

          return (
            <box flexDirection="column">
              {/* Tab Navigation */}
              <box flexDirection="row" gap={2}>
                <text
                  style={{
                    fg: activeTab() === "tools" ? theme.accent : theme.textMuted,
                    attributes: activeTab() === "tools" ? TextAttributes.BOLD : undefined,
                  }}
                  onMouseUp={() => handleTabChange("tools")}
                >
                  {activeTab() === "tools" ? "●" : "○"} Tools(
                  {toolsUsed().length +
                    Object.keys(sync.mcp || {}).length +
                    (sync.lsp || []).length}
                  )
                </text>
                <text
                  style={{
                    fg: activeTab() === "todos" ? theme.accent : theme.textMuted,
                    attributes: activeTab() === "todos" ? TextAttributes.BOLD : undefined,
                  }}
                  onMouseUp={() => handleTabChange("todos")}
                >
                  {activeTab() === "todos" ? "●" : "○"} Todos({todo().length})
                </text>
                <text
                  style={{
                    fg: activeTab() === "files" ? theme.accent : theme.textMuted,
                    attributes: activeTab() === "files" ? TextAttributes.BOLD : undefined,
                  }}
                  onMouseUp={() => handleTabChange("files")}
                >
                  {activeTab() === "files" ? "●" : "○"} Files(
                  {session().summary?.diffs?.length || 0})
                </text>
              </box>

              {/* Tools Tab */}
              <Show when={activeTab() === "tools"}>
                <Show when={toolsUsed().length > 0}>
                  <box marginTop={1}>
                    <text attributes={TextAttributes.BOLD} marginBottom={1}>
                      Tools Used
                    </text>
                    <For each={toolsUsed()}>
                      {([toolName, count]) => {
                        const isClaudeCode = toolName.startsWith("cc_")
                        const level = createMemo(() => getFavoriteLevel(toolName))
                        return (
                          <box flexDirection="row" gap={1} justifyContent="space-between">
                            <box flexDirection="row" gap={1}>
                              <text
                                fg={
                                  level() === "global"
                                    ? "#FFD700"
                                    : level() === "project"
                                      ? theme.accent
                                      : theme.textMuted
                                }
                                onMouseUp={() => {
                                  if (renderer.getSelection()?.getSelectedText()) return
                                  cycleFavorite(toolName)
                                }}
                              >
                                {getStarIcon(toolName)}
                              </text>
                              <text
                                fg={isClaudeCode ? theme.accent : theme.text}
                                onMouseUp={() => {
                                  if (renderer.getSelection()?.getSelectedText()) return
                                  cycleFavorite(toolName)
                                }}
                              >
                                {toolName}
                              </text>
                            </box>
                            <text fg={theme.textMuted}>×{count}</text>
                          </box>
                        )
                      }}
                    </For>
                  </box>
                </Show>

                <Show when={toolsUsed().length === 0}>
                  <box marginTop={0}>
                    <text fg={theme.textMuted}>
                      <i>No tools used yet. Favorites will appear here when used.</i>
                    </text>
                  </box>
                </Show>

                {/* LSP Section */}
                <Show when={(sync.lsp || []).length > 0}>
                  <box marginTop={1}>
                    <text attributes={TextAttributes.BOLD} marginBottom={1}>
                      LSP
                    </text>
                    <For each={sync.lsp || []}>
                      {(item) => (
                        <box flexDirection="row" gap={1}>
                          <text
                            flexShrink={0}
                            style={{
                              fg: {
                                connected: theme.success,
                                error: theme.error,
                              }[item.status],
                            }}
                          >
                            ●
                          </text>
                          <text fg={theme.textMuted}>
                            {item.id} {item.root}
                          </text>
                        </box>
                      )}
                    </For>
                  </box>
                </Show>

                {/* MCP Section */}
                <Show when={Object.keys(sync.mcp || {}).length > 0}>
                  <box marginTop={1}>
                    <text attributes={TextAttributes.BOLD} marginBottom={1}>
                      MCP
                    </text>
                    <For each={Object.entries(sync.mcp || {})}>
                      {([key, item]: [string, any]) => (
                        <box flexDirection="column">
                          <box flexDirection="row" gap={1}>
                            <text
                              flexShrink={0}
                              style={{
                                fg: {
                                  connected: theme.success,
                                  failed: theme.error,
                                  disabled: theme.textMuted,
                                }[item.status],
                              }}
                            >
                              ●
                            </text>
                            <text fg={theme.text}>{key}</text>
                          </box>
                        </box>
                      )}
                    </For>
                  </box>
                </Show>

                {/* UI Plugin Widgets */}
                <Show when={(uiExtensions.extensions()?.widgets ?? []).length > 0}>
                  <box marginTop={0}>
                    <text attributes={TextAttributes.BOLD}>Widgets</text>
                    <For each={uiExtensions.extensions()?.widgets ?? []}>
                      {(widget) => (
                        <box>
                          <text fg={theme.textMuted}>
                            <b>{widget.label}</b>
                          </text>
                          {/* Widget content would be rendered by PluginComponent in actual sidebar */}
                          <text fg={theme.textMuted}>{widget.id}</text>
                        </box>
                      )}
                    </For>
                  </box>
                </Show>

                {/* UI Plugin Panels */}
                <Show when={(uiExtensions.extensions()?.panels ?? []).length > 0}>
                  <box marginTop={0}>
                    <text attributes={TextAttributes.BOLD}>Panels</text>
                    <For each={uiExtensions.extensions()?.panels ?? []}>
                      {(panel) => (
                        <box>
                          <text fg={theme.textMuted}>
                            <b>{panel.label}</b>
                          </text>
                          {/* Panel content would be rendered by PluginComponent in actual sidebar */}
                          <text fg={theme.textMuted}>{panel.id}</text>
                        </box>
                      )}
                    </For>
                  </box>
                </Show>
              </Show>

              {/* Todos Tab */}
              <Show when={activeTab() === "todos"}>
                <Show when={todo().length > 0}>
                  <box marginTop={0}>
                    <text attributes={TextAttributes.BOLD}>Todo</text>
                    <For each={todo()}>
                      {(todoItem) => (
                        <text
                          style={{
                            fg: todoItem.status === "in_progress" ? theme.success : theme.textMuted,
                          }}
                        >
                          [{todoItem.status === "completed" ? "✓" : " "}] {todoItem.content}
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
              </Show>

              {/* Files Tab */}
              <Show when={activeTab() === "files"}>
                <Show when={session().summary?.diffs}>
                  <box marginTop={0} flexDirection="column">
                    <box flexDirection="row" justifyContent="space-between">
                      <text attributes={TextAttributes.BOLD}>Session Files</text>
                      <Show when={uncommittedFiles().length > 0}>
                        <text
                          fg={theme.accent}
                          onMouseUp={() => {
                            if (renderer.getSelection()?.getSelectedText()) return
                            const uncommitted = uncommittedFiles()
                            if (selectedFiles().size === uncommitted.length) {
                              setSelectedFiles(new Set<string>())
                            } else {
                              setSelectedFiles(new Set<string>(uncommitted.map((d) => d.file)))
                            }
                          }}
                        >
                          {selectedFiles().size === uncommittedFiles().length
                            ? "Desel All"
                            : "Sel All"}
                        </text>
                      </Show>
                    </box>
                    <For each={session().summary?.diffs || []}>
                      {(item) => {
                        // Ensure file is a string
                        const filePath =
                          typeof item.file === "string" ? item.file : String(item.file || "")
                        const splits = filePath.split("/").filter(Boolean)
                        const fileName = splits.at(-1) || filePath
                        const dirPath = splits.slice(0, -1).join("/")
                        const isCommitted = committedFiles().has(item.file)
                        const isSelected = selectedFiles().has(item.file)

                        return (
                          <box
                            flexDirection="row"
                            gap={1}
                            justifyContent="space-between"
                            onMouseUp={() => {
                              if (renderer.getSelection()?.getSelectedText()) return
                              if (!isCommitted) {
                                setSelectedFiles((prev) => {
                                  const newSet = new Set(prev)
                                  if (newSet.has(item.file)) {
                                    newSet.delete(item.file)
                                  } else {
                                    newSet.add(item.file)
                                  }
                                  return newSet
                                })
                              }
                            }}
                          >
                            <box flexDirection="column" flexGrow={1}>
                              <text fg={isCommitted ? theme.textMuted : theme.text}>
                                {isCommitted ? "✓ " : isSelected ? "☑ " : "☐ "}
                                {fileName}
                              </text>
                              <Show when={dirPath}>
                                <text fg={theme.textMuted}>{dirPath}</text>
                              </Show>
                            </box>
                            <text fg={theme.textMuted}>
                              {item.added > 0 && `+${item.added}`}
                              {item.added > 0 && item.removed > 0 && " "}
                              {item.removed > 0 && `-${item.removed}`}
                            </text>
                          </box>
                        )
                      }}
                    </For>
                  </box>
                </Show>
              </Show>
            </box>
          )
        }

        // Return the component FUNCTION, not the JSX
        // This way it will be called later within the render tree
        output.component = SidebarTabs
        output.type = "component"
      }
    },
  }
}

export default SidebarTabsPlugin

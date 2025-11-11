import type { Component } from "solid-js"
import { createSignal, For } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"

interface SidebarPanelProps {
  col?: number
  width?: number
  todos: Array<any>
  subagents: Array<{
    id: string
    title: string
    status: "running" | "completed" | "failed"
    time: { created: number; updated: number }
  }>
  files?: Array<{ path: string; operation: string; messageID: string; partID: string }>
  lspServers?: Array<{
    id: string
    name: string
    status: "running" | "stopped"
  }>
  mcpServers?: Array<{
    id: string
    name: string
    status: "running" | "stopped"
  }>
  onCollapse?: () => void
  onSelectSession?: (id: string) => void
  onSelectLspServer?: (id: string) => void
  onSelectMcpServer?: (id: string) => void
  onSelectFile?: (messageID: string, partID: string) => void
}

type TabType = "tools" | "todos" | "files"

export const SidebarPanel: Component<SidebarPanelProps> = (props) => {
  const startCol = () => props.col ?? 119
  const panelWidth = () => props.width ?? 38

  const [activeTab, setActiveTab] = createSignal<TabType>("tools")
  const [toolsExpanded, setToolsExpanded] = createSignal(false)
  const [pluginsExpanded, setPluginsExpanded] = createSignal(false)
  const [subagentsExpanded, setSubagentsExpanded] = createSignal(false)
  const [lspExpanded, setLspExpanded] = createSignal(false)
  const [mcpExpanded, setMcpExpanded] = createSignal(false)
  const [favoriteTools, setFavoriteTools] = createSignal<Set<string>>(new Set())
  const [expandedPlugins, setExpandedPlugins] = createSignal<Set<string>>(new Set())

  const toggleFavorite = (tool: string) => {
    setFavoriteTools((prev) => {
      const next = new Set(prev)
      if (next.has(tool)) {
        next.delete(tool)
      } else {
        next.add(tool)
      }
      return next
    })
  }

  const togglePlugin = (plugin: string) => {
    setExpandedPlugins((prev) => {
      const next = new Set(prev)
      if (next.has(plugin)) {
        next.delete(plugin)
      } else {
        next.add(plugin)
      }
      return next
    })
  }

  // Mock data for tools and plugins
  const toolsList = ["bash", "read", "write", "edit", "grep"]
  const pluginsList = [
    { name: "filesystem", tools: ["read", "write", "list"] },
    { name: "git", tools: ["commit", "diff", "log"] },
    { name: "web", tools: ["fetch", "scrape"] },
  ]

  return (
    <GridPanel col={startCol()} row={0} width={panelWidth()} height="100%" bg="#0a0a0a" scrollable={true}>
      {/* Header - row 1 flush left */}
      <GridText col={2} row={1} text="CODESURF" fg="#858585" bold />
      <GridText col={panelWidth() - 2} row={1} text="◀" fg="#858585" onClick={props.onCollapse} />

      {/* Server */}
      <GridText col={2} row={3} text="server:65132/" fg="#6a6a6a" />

      {/* Session title */}
      <GridText col={2} row={5} text="Continuing conversation" fg="#ffffff" />

      {/* Context */}
      <GridText col={2} row={7} text="Context" fg="#ffffff" bold />

      {/* Context bar with colored segments - BRIGHT TERMINAL COLORS */}
      <GridText col={2} row={8} text="█████" fg="#999999" />
      <GridText col={7} row={8} text="██████████" fg="#ff9800" />
      <GridText col={17} row={8} text="██" fg="#4da6ff" />
      <GridText col={19} row={8} text="███" fg="#ff9800" />
      <GridText col={22} row={8} text="░░░░░░░░░░░░" fg="#3a3a3a" />
      <GridText col={34} row={8} text="50%" fg="#ffffff" />

      {/* Legend with colored blocks */}
      <GridText col={2} row={10} text="█" fg="#999999" />
      <GridText col={4} row={10} text="System" fg="#999999" />
      <GridText col={11} row={10} text="█" fg="#ff9800" />
      <GridText col={13} row={10} text="AI" fg="#ff9800" />
      <GridText col={16} row={10} text="█" fg="#4da6ff" />
      <GridText col={18} row={10} text="User" fg="#4da6ff" />
      <GridText col={23} row={10} text="█" fg="#ff9800" />
      <GridText col={25} row={10} text="Tool" fg="#ff9800" />

      {/* Token stats */}
      <GridText col={2} row={12} text="99,050 tokens (99% cached)" fg="#6a6a6a" />
      <GridText col={2} row={13} text="50% used" fg="#6a6a6a" />
      <GridText col={2} row={14} text="$0.00 spent (saved $0.00)" fg="#6a6a6a" />

      {/* Tabs - active tab white with ●, inactive muted with ○ */}
      <GridText
        col={2}
        row={16}
        text={`${activeTab() === "tools" ? "●" : "○"} Tools(15)`}
        fg={activeTab() === "tools" ? "#ffffff" : "#6a6a6a"}
        onClick={() => setActiveTab("tools")}
      />
      <GridText
        col={15}
        row={16}
        text={`${activeTab() === "todos" ? "●" : "○"} Todos(6)`}
        fg={activeTab() === "todos" ? "#ffffff" : "#6a6a6a"}
        onClick={() => setActiveTab("todos")}
      />
      <GridText
        col={27}
        row={16}
        text={`${activeTab() === "files" ? "●" : "○"} Files(${props.files?.length ?? 0})`}
        fg={activeTab() === "files" ? "#ffffff" : "#6a6a6a"}
        onClick={() => setActiveTab("files")}
      />

      {/* Tools Tab Content */}
      {activeTab() === "tools" && (
        <>
          {(() => {
            let currentRow = 19

            // Tools Used header
            const toolsHeaderRow = currentRow
            currentRow++

            // Tools list
            const toolsRows = toolsExpanded() ? toolsList.length : 0
            currentRow += toolsRows

            // Blank line after Tools
            currentRow++

            // Plugins header
            const pluginsHeaderRow = currentRow
            currentRow++

            // Calculate plugin rows
            let pluginRows = 0
            if (pluginsExpanded()) {
              pluginsList.forEach((plugin) => {
                pluginRows++ // plugin header row
                if (expandedPlugins().has(plugin.name)) {
                  pluginRows += plugin.tools.length // tool items
                }
              })
              currentRow += pluginRows
            }

            // Blank line after Plugins
            currentRow++

            // Subagents header
            const subagentsHeaderRow = currentRow
            currentRow++

            // Subagents list
            const subagentRows = subagentsExpanded() ? props.subagents.length : 0
            currentRow += subagentRows

            // Add Subagent row
            currentRow++

            // Blank line after Subagents
            currentRow++

            // LSP Servers header
            const lspHeaderRow = currentRow
            currentRow++

            // LSP Servers list
            const lspRows = lspExpanded() ? (props.lspServers?.length ?? 0) : 0
            currentRow += lspRows

            // Add LSP Server row
            currentRow++

            // Blank line after LSP
            currentRow++

            // MCP Servers header
            const mcpHeaderRow = currentRow
            currentRow++

            // MCP Servers list
            const mcpRows = mcpExpanded() ? (props.mcpServers?.length ?? 0) : 0

            return (
              <>
                {/* Tools Used header */}
                <GridText
                  col={2}
                  row={toolsHeaderRow}
                  text={`${toolsExpanded() ? "▼" : "▶"} Tools Used (${toolsList.length})`}
                  fg="#ffffff"
                  onClick={() => setToolsExpanded(!toolsExpanded())}
                />

                {/* Tool list with favorite stars */}
                {toolsExpanded() && (
                  <For each={toolsList}>
                    {(tool, idx) => {
                      const row = toolsHeaderRow + 1 + idx()
                      const star = favoriteTools().has(tool) ? "★" : "☆"
                      return (
                        <>
                          <GridText col={2} row={row} text={star} fg="#e5c07b" onClick={() => toggleFavorite(tool)} />
                          <GridText col={4} row={row} text={tool} fg="#ffffff" />
                        </>
                      )
                    }}
                  </For>
                )}

                {/* Plugins header */}
                <GridText
                  col={2}
                  row={pluginsHeaderRow}
                  text={`${pluginsExpanded() ? "▼" : "▶"} Plugins (${pluginsList.length})`}
                  fg="#ffffff"
                  onClick={() => setPluginsExpanded(!pluginsExpanded())}
                />

                {/* Plugin list with expandable tools */}
                {pluginsExpanded() &&
                  (() => {
                    let pluginCurrentRow = pluginsHeaderRow + 1
                    return (
                      <For each={pluginsList}>
                        {(plugin) => {
                          const pluginRow = pluginCurrentRow
                          pluginCurrentRow++
                          const isExpanded = expandedPlugins().has(plugin.name)
                          if (isExpanded) {
                            pluginCurrentRow += plugin.tools.length
                          }

                          return (
                            <>
                              <GridText
                                col={2}
                                row={pluginRow}
                                text={`${isExpanded ? "▼" : "▶"} ${plugin.name} (${plugin.tools.length})`}
                                fg="#ffffff"
                                onClick={() => togglePlugin(plugin.name)}
                              />
                              {isExpanded && (
                                <For each={plugin.tools}>
                                  {(tool, tidx) => (
                                    <GridText col={4} row={pluginRow + 1 + tidx()} text={`- ${tool}`} fg="#6a6a6a" />
                                  )}
                                </For>
                              )}
                            </>
                          )
                        }}
                      </For>
                    )
                  })()}

                {/* Subagents header */}
                <GridText
                  col={2}
                  row={subagentsHeaderRow}
                  text={`${subagentsExpanded() ? "▼" : "▶"} Subagents (${props.subagents.length})`}
                  fg="#e5c07b"
                  onClick={() => setSubagentsExpanded(!subagentsExpanded())}
                />

                {/* Subagent list with clickable sessions */}
                {subagentsExpanded() && (
                  <For each={props.subagents}>
                    {(subagent, idx) => {
                      const row = subagentsHeaderRow + 1 + idx()
                      const statusIcon =
                        subagent.status === "running" ? "●" : subagent.status === "completed" ? "✓" : "✗"
                      const statusColor =
                        subagent.status === "running"
                          ? "#98c379"
                          : subagent.status === "completed"
                            ? "#61afef"
                            : "#e06c75"
                      const textColor = subagent.status === "completed" ? "#6a6a6a" : "#ffffff"
                      const maxTitleLength = panelWidth() - 6
                      const truncatedTitle =
                        subagent.title.length > maxTitleLength
                          ? subagent.title.slice(0, maxTitleLength - 3) + "..."
                          : subagent.title

                      return (
                        <>
                          <GridText col={2} row={row} text={statusIcon} fg={statusColor} />
                          <GridText
                            col={4}
                            row={row}
                            text={truncatedTitle}
                            fg={textColor}
                            onClick={() => props.onSelectSession?.(subagent.id)}
                          />
                        </>
                      )
                    }}
                  </For>
                )}

                {/* Add Subagent */}
                <GridText
                  col={2}
                  row={subagentsHeaderRow + (subagentsExpanded() ? subagentRows + 1 : 1)}
                  text="+ Add Subagent"
                  fg="#e5c07b"
                />

                {/* LSP Servers header */}
                <GridText
                  col={2}
                  row={lspHeaderRow}
                  text={`${lspExpanded() ? "▼" : "▶"} LSP Servers (${props.lspServers?.length ?? 0})`}
                  fg="#ffffff"
                  onClick={() => setLspExpanded(!lspExpanded())}
                />

                {/* LSP Server list with status */}
                {lspExpanded() && props.lspServers && (
                  <For each={props.lspServers}>
                    {(server, idx) => {
                      const row = lspHeaderRow + 1 + idx()
                      const statusIcon = server.status === "running" ? "●" : "○"
                      const statusColor = server.status === "running" ? "#98c379" : "#6a6a6a"
                      const maxNameLength = panelWidth() - 6
                      const truncatedName =
                        server.name.length > maxNameLength
                          ? server.name.slice(0, maxNameLength - 3) + "..."
                          : server.name

                      return (
                        <>
                          <GridText col={2} row={row} text={statusIcon} fg={statusColor} />
                          <GridText
                            col={4}
                            row={row}
                            text={truncatedName}
                            fg="#ffffff"
                            onClick={() => props.onSelectLspServer?.(server.id)}
                          />
                        </>
                      )
                    }}
                  </For>
                )}

                {/* Add LSP Server */}
                <GridText
                  col={2}
                  row={lspHeaderRow + (lspExpanded() ? lspRows + 1 : 1)}
                  text="+ Add Server"
                  fg="#ff9800"
                />

                {/* MCP Servers header */}
                <GridText
                  col={2}
                  row={mcpHeaderRow}
                  text={`${mcpExpanded() ? "▼" : "▶"} MCP Servers (${props.mcpServers?.length ?? 0})`}
                  fg="#ffffff"
                  onClick={() => setMcpExpanded(!mcpExpanded())}
                />

                {/* MCP Server list with status */}
                {mcpExpanded() && props.mcpServers && (
                  <For each={props.mcpServers}>
                    {(server, idx) => {
                      const row = mcpHeaderRow + 1 + idx()
                      const statusIcon = server.status === "running" ? "●" : "○"
                      const statusColor = server.status === "running" ? "#98c379" : "#6a6a6a"
                      const maxNameLength = panelWidth() - 6
                      const truncatedName =
                        server.name.length > maxNameLength
                          ? server.name.slice(0, maxNameLength - 3) + "..."
                          : server.name

                      return (
                        <>
                          <GridText col={2} row={row} text={statusIcon} fg={statusColor} />
                          <GridText
                            col={4}
                            row={row}
                            text={truncatedName}
                            fg="#ffffff"
                            onClick={() => props.onSelectMcpServer?.(server.id)}
                          />
                        </>
                      )
                    }}
                  </For>
                )}

                {/* Add MCP Server */}
                <GridText
                  col={2}
                  row={mcpHeaderRow + (mcpExpanded() ? mcpRows + 1 : 1)}
                  text="+ Add Server"
                  fg="#ff9800"
                />
              </>
            )
          })()}
        </>
      )}

      {/* Todos Tab Content */}
      {activeTab() === "todos" && (
        <>
          <GridText col={2} row={18} text="Todos" fg="#ffffff" bold />

          {/* Todo list with nesting */}
          {props.todos && props.todos.length > 0 ? (
            <For each={props.todos.slice(0, 20)}>
              {(todo, idx) => {
                const row = 19 + idx()
                const indent = todo.parentId ? 4 : 2
                const checkbox = todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "◐" : "○"
                const checkboxColor =
                  todo.status === "completed" ? "#98c379" : todo.status === "in_progress" ? "#e5c07b" : "#6a6a6a"
                const textColor = todo.status === "completed" ? "#6a6a6a" : "#ffffff"
                const maxLength = panelWidth() - indent - 4
                const truncatedContent =
                  todo.content.length > maxLength ? todo.content.slice(0, maxLength - 3) + "..." : todo.content

                return (
                  <>
                    <GridText col={indent} row={row} text={checkbox} fg={checkboxColor} />
                    <GridText col={indent + 2} row={row} text={truncatedContent} fg={textColor} />
                  </>
                )
              }}
            </For>
          ) : (
            <GridText col={2} row={19} text="No todos" fg="#6a6a6a" />
          )}

          <GridText col={2} row={39} text="+ Add Todo" fg="#e5c07b" />
        </>
      )}

      {/* Files Tab Content */}
      {activeTab() === "files" && (
        <>
          <GridText col={2} row={18} text="Files" fg="#ffffff" bold />

          {/* File list grouped by operation */}
          {props.files && props.files.length > 0 ? (
            (() => {
              let currentRow = 19
              const filesByOp = {
                write: props.files.filter((f) => f.operation === "write"),
                edit: props.files.filter((f) => f.operation === "edit"),
                read: props.files.filter((f) => f.operation === "read"),
              }

              return (
                <>
                  {/* Written Files */}
                  {filesByOp.write.length > 0 && (
                    <>
                      <GridText col={2} row={currentRow} text="Written" fg="#ff9800" bold />
                      {(() => {
                        currentRow++
                        return (
                          <For each={filesByOp.write.slice(0, 10)}>
                            {(file) => {
                              const row = currentRow
                              currentRow++
                              const maxLength = panelWidth() - 4
                              const truncatedPath =
                                file.path.length > maxLength ? "..." + file.path.slice(-maxLength + 3) : file.path
                              return (
                                <GridText
                                  col={2}
                                  row={row}
                                  text={truncatedPath}
                                  fg="#ffffff"
                                  onClick={() => props.onSelectFile?.(file.messageID, file.partID)}
                                />
                              )
                            }}
                          </For>
                        )
                      })()}
                      {(() => {
                        currentRow++
                        return null
                      })()}
                    </>
                  )}

                  {/* Edited Files */}
                  {filesByOp.edit.length > 0 && (
                    <>
                      <GridText col={2} row={currentRow} text="Edited" fg="#ff9800" bold />
                      {(() => {
                        currentRow++
                        return (
                          <For each={filesByOp.edit.slice(0, 10)}>
                            {(file) => {
                              const row = currentRow
                              currentRow++
                              const maxLength = panelWidth() - 4
                              const truncatedPath =
                                file.path.length > maxLength ? "..." + file.path.slice(-maxLength + 3) : file.path
                              return (
                                <GridText
                                  col={2}
                                  row={row}
                                  text={truncatedPath}
                                  fg="#ffffff"
                                  onClick={() => props.onSelectFile?.(file.messageID, file.partID)}
                                />
                              )
                            }}
                          </For>
                        )
                      })()}
                      {(() => {
                        currentRow++
                        return null
                      })()}
                    </>
                  )}

                  {/* Read Files */}
                  {filesByOp.read.length > 0 && (
                    <>
                      <GridText col={2} row={currentRow} text="Read" fg="#ff9800" bold />
                      {(() => {
                        currentRow++
                        return (
                          <For each={filesByOp.read.slice(0, 10)}>
                            {(file) => {
                              const row = currentRow
                              currentRow++
                              const maxLength = panelWidth() - 4
                              const truncatedPath =
                                file.path.length > maxLength ? "..." + file.path.slice(-maxLength + 3) : file.path
                              return (
                                <GridText
                                  col={2}
                                  row={row}
                                  text={truncatedPath}
                                  fg="#ffffff"
                                  onClick={() => props.onSelectFile?.(file.messageID, file.partID)}
                                />
                              )
                            }}
                          </For>
                        )
                      })()}
                    </>
                  )}
                </>
              )
            })()
          ) : (
            <GridText col={2} row={19} text="No files modified" fg="#6a6a6a" />
          )}
        </>
      )}
    </GridPanel>
  )
}

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
  onCollapse?: () => void
}

type TabType = "tools" | "todos" | "files"

export const SidebarPanel: Component<SidebarPanelProps> = (props) => {
  const startCol = () => props.col ?? 119
  const panelWidth = () => props.width ?? 38

  const [activeTab, setActiveTab] = createSignal<TabType>("tools")
  const [toolsExpanded, setToolsExpanded] = createSignal(false)
  const [pluginsExpanded, setPluginsExpanded] = createSignal(false)
  const [subagentsExpanded, setSubagentsExpanded] = createSignal(false)

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

      {/* Context bar with colored segments - TERMINAL BRIGHT COLORS */}
      <GridText col={2} row={8} text="█████" fg="#808080" />
      <GridText col={7} row={8} text="██████████" fg="#d19a66" />
      <GridText col={17} row={8} text="██" fg="#61afef" />
      <GridText col={19} row={8} text="███" fg="#e5c07b" />
      <GridText col={22} row={8} text="░░░░░░░░░░░░" fg="#3a3a3a" />
      <GridText col={34} row={8} text="50%" fg="#ffffff" />

      {/* Legend with colored blocks */}
      <GridText col={2} row={10} text="█" fg="#808080" />
      <GridText col={4} row={10} text="System" fg="#ffffff" />
      <GridText col={11} row={10} text="█" fg="#d19a66" />
      <GridText col={13} row={10} text="AI" fg="#ffffff" />
      <GridText col={16} row={10} text="█" fg="#61afef" />
      <GridText col={18} row={10} text="User" fg="#ffffff" />
      <GridText col={23} row={10} text="█" fg="#e5c07b" />
      <GridText col={25} row={10} text="Tool" fg="#ffffff" />

      {/* Token stats */}
      <GridText col={2} row={12} text="99,050 tokens (99% cached)" fg="#6a6a6a" />
      <GridText col={2} row={13} text="50% used" fg="#6a6a6a" />
      <GridText col={2} row={14} text="$0.00 spent (saved $0.00)" fg="#6a6a6a" />

      {/* Tabs - active tab white with ●, inactive muted with ○ */}
      <GridText
        col={0}
        row={16}
        text={`${activeTab() === "tools" ? "●" : "○"} Tools(15)`}
        fg={activeTab() === "tools" ? "#ffffff" : "#6a6a6a"}
        onClick={() => setActiveTab("tools")}
      />
      <GridText
        col={13}
        row={16}
        text={`${activeTab() === "todos" ? "●" : "○"} Todos(6)`}
        fg={activeTab() === "todos" ? "#ffffff" : "#6a6a6a"}
        onClick={() => setActiveTab("todos")}
      />
      <GridText
        col={25}
        row={16}
        text={`${activeTab() === "files" ? "●" : "○"} Files(30)`}
        fg={activeTab() === "files" ? "#ffffff" : "#6a6a6a"}
        onClick={() => setActiveTab("files")}
      />

      {/* Tools Tab Content */}
      {activeTab() === "tools" && (
        <>
          {/* Blank line */}
          {/* Tools Used - row 19 */}
          <GridText
            col={2}
            row={19}
            text={`${toolsExpanded() ? "▼" : "▶"} Tools Used (5)`}
            fg="#ffffff"
            onClick={() => setToolsExpanded(!toolsExpanded())}
          />
          {/* Blank line */}

          {/* Plugins - row 21 */}
          <GridText
            col={2}
            row={21}
            text={`${pluginsExpanded() ? "▼" : "▶"} Plugins (10)`}
            fg="#ffffff"
            onClick={() => setPluginsExpanded(!pluginsExpanded())}
          />
          {/* Blank line */}

          {/* Subagents - row 23 */}
          <GridText
            col={2}
            row={23}
            text={`${subagentsExpanded() ? "▼" : "▶"} Subagents (${props.subagents.length})`}
            fg="#e5c07b"
            onClick={() => setSubagentsExpanded(!subagentsExpanded())}
          />

          {/* Subagent list - starts at row 24 */}
          {subagentsExpanded() && (
            <For each={props.subagents}>
              {(subagent, idx) => {
                const row = 24 + idx()
                const statusIcon = subagent.status === "running" ? "●" : subagent.status === "completed" ? "✓" : "✗"
                const statusColor =
                  subagent.status === "running" ? "#98c379" : subagent.status === "completed" ? "#6a6a6a" : "#e06c75"
                const textColor = subagent.status === "completed" ? "#6a6a6a" : "#ffffff"
                const maxTitleLength = panelWidth() - 4
                const truncatedTitle =
                  subagent.title.length > maxTitleLength
                    ? subagent.title.slice(0, maxTitleLength - 3) + "..."
                    : subagent.title

                return (
                  <>
                    <GridText col={1} row={row} text={statusIcon} fg={statusColor} />
                    <GridText col={3} row={row} text={truncatedTitle} fg={textColor} />
                  </>
                )
              }}
            </For>
          )}

          {/* Add Subagent - dynamic row based on expanded state */}
          <GridText
            col={0}
            row={subagentsExpanded() ? 24 + props.subagents.length + 1 : 25}
            text="+ Add Subagent"
            fg="#e5c07b"
          />
        </>
      )}

      {/* Todos Tab Content */}
      {activeTab() === "todos" && (
        <>
          <GridText col={2} row={18} text="Todo" fg="#ffffff" bold />

          {/* DEBUG LOG */}
          {console.log("[SidebarPanel] Todos tab - props.todos:", props.todos, "length:", props.todos?.length)}

          {/* Scrollable todo list */}
          <div style={{ position: "absolute", top: "20em", bottom: "10em", overflow: "auto" }}>
            {props.todos && props.todos.length > 0 ? (
              <For each={props.todos.slice(0, 20)}>
                {(todo, idx) => {
                  const row = 19 + idx()
                  const checkbox = todo.status === "completed" ? "[✓]" : "[ ]"
                  return (
                    <GridText
                      col={0}
                      row={row}
                      text={`${checkbox} ${todo.content.slice(0, 35)}`}
                      fg={todo.status === "completed" ? "#6a6a6a" : "#ffffff"}
                    />
                  )
                }}
              </For>
            ) : (
              <GridText col={2} row={19} text="No todos" fg="#6a6a6a" />
            )}
          </div>

          <GridText col={2} row={60} text="+ Add Todo" fg="#d7ba7d" />
        </>
      )}

      {/* Files Tab Content */}
      {activeTab() === "files" && <GridText col={2} row={18} text="No files modified" fg="#6a6a6a" />}
    </GridPanel>
  )
}

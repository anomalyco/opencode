import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { TodoItem } from "../../component/todo-item"
import type { Issue } from "@opencode-ai/sdk/v2"

const id = "internal:sidebar-issue"

const statusOrder: Issue["status"][] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]

const statusIcon = (status: string | undefined) => {
  switch (status) {
    case "backlog":
      return "○"
    case "todo":
      return "▢"
    case "in_progress":
      return "●"
    case "in_review":
      return "◎"
    case "done":
      return "✓"
    case "canceled":
      return "✗"
    default:
      return " "
  }
}

type TreeNode = Issue & { children: Issue[] }

function buildTree(flat: Issue[]): TreeNode[] {
  const nodes: TreeNode[] = []
  for (const item of flat) {
    if (item.level === 0) {
      nodes.push({ ...item, children: [] })
    } else if (item.level === 1 && item.parent_id) {
      const parent = nodes.find((n) => n.id === item.parent_id)
      if (parent) parent.children.push(item)
    }
  }
  if (nodes.length === 0 && flat.length > 0) {
    return flat.map((item) => ({ ...item, children: [] }))
  }
  return nodes
}

function cycleStatus(current: Issue["status"]): Issue["status"] {
  const idx = statusOrder.indexOf(current)
  if (idx === -1 || idx === statusOrder.length - 1) return statusOrder[0]
  return statusOrder[idx + 1]
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const directory = () => props.api.state.path.directory
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())

  const fetcher = async () => {
    return props.api.client.issue
      .list({ directory: directory() })
      .then((res) => res.data ?? [])
      .catch(() => [])
  }
  const [data] = createResource(refreshKey, fetcher)
  const list = createMemo(() => data() ?? [])
  const tree = createMemo(() => buildTree(list()))

  const refresh = () => setRefreshKey((k) => k + 1)

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = async () => {
    const now = Date.now()
    await props.api.client.issue
      .create({
        query_directory: directory(),
        body_directory: directory(),
        issue: {
          directory: directory(),
          level: 0,
          title: "New todo",
          content: "",
          status: "backlog",
          priority: "none",
          position: now,
          time_created: now,
          time_updated: now,
        },
      })
      .catch(() => undefined)
    refresh()
  }

  const handleCycle = async (issue: Issue) => {
    if (!issue.id) return
    const next = cycleStatus(issue.status)
    await props.api.client.issue
      .patchStatus({
        id: issue.id,
        query_directory: directory(),
        body_directory: directory(),
        status: next,
      })
      .catch(() => undefined)
    refresh()
  }

  const handleDelete = async (issue: Issue) => {
    if (!issue.id) return
    await props.api.client.issue
      .delete({ id: issue.id, directory: directory() })
      .catch(() => undefined)
    refresh()
  }

  return (
    <box gap={1}>
      <box flexDirection="row" gap={1}>
        <text fg={theme().text}>
          <b>Todos</b>
        </text>
        <text flexGrow={1} />
        <text fg={theme().textMuted} onMouseDown={handleAdd}>
          [+]
        </text>
      </box>
      <Show
        when={list().length > 0}
        fallback={<text fg={theme().textMuted}>No todos yet. Press [+] to add one.</text>}
      >
        <For each={tree()}>
          {(node) => {
            const nodeId = node.id ?? ""
            const hasChildren = node.children.length > 0
            const isExpanded = !collapsed().has(nodeId)
            return (
              <box flexDirection="column">
                <box flexDirection="row" gap={1}>
                  <text
                    flexShrink={0}
                    fg={theme().textMuted}
                    onMouseDown={() => hasChildren && toggle(nodeId)}
                  >
                    {hasChildren ? (isExpanded ? "▼" : "▶") : " "}
                  </text>
                  <text
                    flexShrink={0}
                    fg={node.status === "in_progress" ? theme().warning : theme().textMuted}
                  >
                    {statusIcon(node.status)}
                  </text>
                  <box flexGrow={1} onMouseDown={() => handleCycle(node)}>
                    <TodoItem
                      status={node.status ?? "backlog"}
                      content={node.content || node.title}
                      title={node.title}
                      priority={node.priority}
                      level={0}
                      hasChildren={hasChildren}
                      isExpanded={isExpanded}
                    />
                  </box>
                  <text flexShrink={0} fg={theme().textMuted} onMouseDown={() => handleDelete(node)}>
                    ×
                  </text>
                </box>
                <Show when={hasChildren && isExpanded}>
                  <For each={node.children}>
                    {(child) => (
                      <box flexDirection="row" gap={1} paddingLeft={2}>
                        <text
                          flexShrink={0}
                          fg={child.status === "in_progress" ? theme().warning : theme().textMuted}
                        >
                          {statusIcon(child.status)}
                        </text>
                        <box flexGrow={1} onMouseDown={() => handleCycle(child)}>
                          <TodoItem
                            status={child.status ?? "backlog"}
                            content={child.content || child.title}
                            title={child.title}
                            priority={child.priority}
                            level={1}
                            parent_id={child.parent_id}
                          />
                        </box>
                        <text flexShrink={0} fg={theme().textMuted} onMouseDown={() => handleDelete(child)}>
                          ×
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin

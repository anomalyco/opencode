import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show, createSignal } from "solid-js"
import { TodoItem } from "../../component/todo-item"

const id = "internal:sidebar-todo"

/** Extended todo shape with hierarchy fields (server returns these, SDK type is outdated) */
type Todo = {
  id?: string
  parent_id?: string | null
  level?: number
  title?: string
  content: string
  status: string
  priority?: string
}

type TreeNode = Todo & { children: Todo[] }

function buildTree(flat: Todo[]): TreeNode[] {
  const nodes: TreeNode[] = []
  for (const item of flat) {
    const lvl = item.level ?? 0
    if (lvl === 0) {
      nodes.push({ ...item, children: [] })
    } else if (lvl === 1 && item.parent_id) {
      const parent = nodes.find((n) => n.id === item.parent_id)
      if (parent) parent.children.push(item)
    }
  }
  // If no L1 items found (legacy flat list), treat all as L1
  if (nodes.length === 0 && flat.length > 0) {
    return flat.map((item) => ({ ...item, children: [] }))
  }
  return nodes
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())
  const theme = () => props.api.theme.current
  const raw = createMemo(() => props.api.state.session.todo(props.session_id) as Todo[])
  const tree = createMemo(() => buildTree(raw()))
  const show = createMemo(() => raw().length > 0 && raw().some((item) => item.status !== "completed"))

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => raw().length > 2 && setOpen((x) => !x)}>
          <Show when={raw().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={raw().length <= 2 || open()}>
          <For each={tree()}>
            {(node) => {
              const id = node.id ?? ""
              const hasChildren = node.children.length > 0
              const isExpanded = !collapsed().has(id)
              return (
                <>
                  <box onMouseDown={() => hasChildren && toggle(id)}>
                    <TodoItem
                      status={node.status}
                      content={node.content}
                      title={node.title}
                      priority={node.priority}
                      level={0}
                      hasChildren={hasChildren}
                      isExpanded={isExpanded}
                    />
                  </box>
                  <Show when={hasChildren && isExpanded}>
                    <For each={node.children}>
                      {(child) => (
                        <TodoItem
                          status={child.status}
                          content={child.content}
                          title={child.title}
                          priority={child.priority}
                          level={1}
                          parent_id={child.parent_id}
                        />
                      )}
                    </For>
                  </Show>
                </>
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 400,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin

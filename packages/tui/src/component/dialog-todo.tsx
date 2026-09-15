import { createMemo, createSignal } from "solid-js"
import { useSync } from "../context/sync"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import type { Todo } from "@opencode-ai/sdk/v2"

const STATUS_CYCLE = ["pending", "in_progress", "completed"] as const

function nextStatus(current: string): string {
  const idx = STATUS_CYCLE.indexOf(current as any)
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
}

function StatusIcon(props: { status: string }) {
  const { theme } = useTheme()
  const mark = props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "
  return (
    <text
      style={{
        fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
      }}
    >
      [{mark}]{" "}
    </text>
  )
}

export function DialogTodo(props: { sessionID: string }) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const [deleting, setDeleting] = createSignal<string | null>(null)

  const todos = createMemo(() => sync.data.todo[props.sessionID] ?? [])

  const options = createMemo(() =>
    todos().map((todo, index) => ({
      value: String(index),
      title: todo.content,
      description: `${todo.status} · ${todo.priority}`,
      footer: <StatusIcon status={todo.status} />,
    })),
  )

  function patch(transform: (current: Array<Todo>) => Array<Todo>) {
    void sdk.client.session
      .todo({ sessionID: props.sessionID })
      .then((res) => {
        if (res.error) {
          toast.show({ variant: "error", message: "Failed to refresh todos" })
          return
        }
        const current = res.data ?? []
        const next = transform(current)
        return sdk.client.session.todoUpdate({ sessionID: props.sessionID, body: next })
      })
      .then((res) => {
        if (res && res.error) {
          toast.show({ variant: "error", message: "Failed to update todos" })
        }
      })
      .catch(() => {
        toast.show({ variant: "error", message: "Failed to update todos" })
      })
  }

  function moveUp(index: number) {
    if (index === 0) return
    patch((current) => {
      if (index >= current.length) return current
      const next = [...current]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }

  function moveDown(index: number) {
    if (index >= todos().length - 1) return
    patch((current) => {
      if (index >= current.length - 1) return current
      const next = [...current]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }

  function toggle(index: number) {
    patch((current) =>
      current.map((todo, i) => (i === index ? { ...todo, status: nextStatus(todo.status) } : todo)),
    )
  }

  function edit(index: number) {
    const current = todos()[index]
    dialog.replace(() => (
      <DialogPrompt
        title="Edit Todo"
        value={current.content}
        onConfirm={(value) => {
          const trimmed = value.trim()
          if (!trimmed) return
          patch((current) =>
            current.map((todo, i) => (i === index ? { ...todo, content: trimmed } : todo)),
          )
          dialog.clear()
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }

  function remove(index: number) {
    const target = todos()[index]
    if (deleting() !== target.content) {
      setDeleting(target.content)
      return
    }
    setDeleting(null)
    patch((current) => current.filter((_, i) => i !== index))
  }

  function clearAll() {
    DialogConfirm.show(dialog, "Clear All Todos", "Remove all todos from this session?").then((ok) => {
      if (ok !== true) return
      patch(() => [])
      dialog.clear()
    })
  }

  return (
    <DialogSelect
      title="Todos"
      options={options()}
      actions={[
        {
          command: "todo.move_up",
          title: "move up",
          disabled: (option) => option ? Number(option.value) <= 0 : false,
          onTrigger: (option: DialogSelectOption<string>) => {
            moveUp(Number(option.value))
          },
        },
        {
          command: "todo.move_down",
          title: "move down",
          disabled: (option) => option ? Number(option.value) >= todos().length - 1 : false,
          onTrigger: (option: DialogSelectOption<string>) => {
            moveDown(Number(option.value))
          },
        },
        {
          command: "todo.toggle",
          title: "toggle",
          onTrigger: (option: DialogSelectOption<string>) => {
            toggle(Number(option.value))
          },
        },
        {
          command: "todo.edit",
          title: "edit",
          onTrigger: (option: DialogSelectOption<string>) => {
            edit(Number(option.value))
          },
        },
        {
          command: "todo.delete",
          title: "delete",
          onTrigger: (option: DialogSelectOption<string>) => {
            remove(Number(option.value))
          },
        },
        {
          command: "todo.clear_all",
          title: "clear all",
          side: "right",
          onTrigger: clearAll,
        },
      ]}
      onMove={() => setDeleting(null)}
      skipFilter={true}
    />
  )
}

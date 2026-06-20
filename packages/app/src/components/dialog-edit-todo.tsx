import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { Component, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { PromptInput } from "@/components/prompt-input"

type TodoInfo = {
  id?: string
  parent_id?: string | null
  level?: number
  title?: string
  content: string
  description?: string
  status?: string
  priority?: string
  labels?: string[]
  due_date?: string | null
  team_id?: string | null
  project_id?: string | null
  assignee_id?: string | null
  linear_issue_id?: string | null
}

interface DialogEditTodoProps {
  todo?: TodoInfo
  mode: "create" | "edit"
  onClose: () => void
}

const PRIORITY_OPTIONS = [
  { value: "", label: "None" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

export const DialogEditTodo: Component<DialogEditTodoProps> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()

  const [store, setStore] = createStore({
    title: props.todo?.title ?? "",
    description: props.todo?.description ?? "",
    priority: props.todo?.priority ?? "",
    due_date: props.todo?.due_date ?? "",
    labels: props.todo?.labels?.join(", ") ?? "",
    assignee_id: props.todo?.assignee_id ?? "",
    parent_id: props.todo?.parent_id ?? "",
  })

  const handleClose = () => {
    props.onClose()
    dialog.close()
  }

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault()

    const title = store.title.trim()
    if (!title) {
      showToast({
        variant: "error",
        title: language.t("common.error"),
        description: "Title is required",
      })
      return
    }

    // TODO: SDK doesn't have todo.add() or todo.update() yet
    // Once available, call:
    // - For create: sdk.client.todo.add({ sessionID, todo: { ... } })
    // - For edit: sdk.client.todo.update({ sessionID, todoID, patch: { ... } })

    const todoData = {
      title,
      description: store.description,
      priority: store.priority || undefined,
      due_date: store.due_date || undefined,
      labels: store.labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
      assignee_id: store.assignee_id || undefined,
      parent_id: store.parent_id || undefined,
    }

    showToast({
      variant: "success",
      title: props.mode === "create" ? "Todo created" : "Todo updated",
      description: `${title}${store.priority ? ` (${store.priority})` : ""}`,
    })

    console.log(`[TODO ${props.mode.toUpperCase()}]`, todoData)

    handleClose()
  }

  return (
    <Dialog
      title={props.mode === "create" ? "Create Todo" : "Edit Todo"}
      class="w-full max-w-[560px] mx-auto"
    >
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6 pt-0">
        <div class="flex flex-col gap-4">
          <TextField
            autofocus
            type="text"
            label="Title"
            placeholder="Enter todo title..."
            value={store.title}
            onChange={(v) => setStore("title", v)}
            required
          />

          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">Description</label>
            <div class="h-[200px] border border-border-base rounded-lg overflow-hidden">
              <PromptInput class="size-full" />
            </div>
            <span class="text-11-regular text-text-weaker">
              Supports markdown, @file references, and /skill invocations
            </span>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-2">
              <label class="text-12-medium text-text-weak">Priority</label>
              <Select
                options={PRIORITY_OPTIONS}
                current={PRIORITY_OPTIONS.find((o) => o.value === store.priority) ?? PRIORITY_OPTIONS[0]}
                value={(o) => o.value}
                label={(o) => o.label}
                onSelect={(option) => setStore("priority", option?.value ?? "")}
                variant="secondary"
                size="normal"
              />
            </div>

            <TextField
              type="date"
              label="Due Date"
              value={store.due_date}
              onChange={(v) => setStore("due_date", v)}
            />
          </div>

          <TextField
            type="text"
            label="Labels"
            placeholder="bug, feature, urgent (comma-separated)"
            value={store.labels}
            onChange={(v) => setStore("labels", v)}
            description="Separate multiple labels with commas"
          />

          <div class="grid grid-cols-2 gap-4">
            <TextField
              type="text"
              label="Assignee ID"
              placeholder="User ID"
              value={store.assignee_id}
              onChange={(v) => setStore("assignee_id", v)}
            />

            <Show when={props.mode === "create"}>
              <TextField
                type="text"
                label="Parent ID"
                placeholder="Parent todo ID (optional)"
                value={store.parent_id}
                onChange={(v) => setStore("parent_id", v)}
                description="For creating sub-tasks"
              />
            </Show>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={handleClose}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large">
            {props.mode === "create" ? "Create" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

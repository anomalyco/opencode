import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Select } from "@opencode-ai/ui/select"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { Component, For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { labelChipColors } from "@/pages/layout/sidebar-todo"
import { DatePicker } from "@/components/date-picker"

// Align with Linear App's Issue entity (PRD): title, description, status,
// priority, labels, due_date. The kernel's IssueTable already stores all of
// these (see packages/opencode/src/issue/issue.sql.ts).
type TodoInfo = {
  id?: string
  parent_id?: string | null
  level?: number | string
  title?: string
  content?: string
  description?: string
  status?: string
  priority?: "none" | "urgent" | "high" | "medium" | "low"
  labels?: string[]
  due_date?: string | null
  assignee_id?: string | null
  linear_issue_id?: string | null
}

interface DialogEditTodoProps {
  directory: string
  mode: "create" | "edit"
  todo?: TodoInfo
  parentId?: string
  parentLevel?: number
  onClose?: () => void
}

/**
 * Fallback status when Linear is not connected or the status list cannot be
 * fetched. "Backlog" is Linear's default unstarted state — it does not
 * trigger the AutoProgress workflow, so the todo stays idle while the user
 * is editing (per PRD requirement: the default status must not trigger the
 * agent auto-workflow).
 */
const FALLBACK_STATUS = "Backlog"

const PRIORITY_OPTIONS = ["none", "urgent", "high", "medium", "low"] as const

// Linear-aligned preset labels (mirrors Linear App's default label set + the
// ready-for-agent workflow label used by the agent loop).
const LABEL_OPTIONS = ["Feature", "Improvement", "Bug", "ready-for-agent"] as const

// Slash command from SDK command.list (only skill / mcp sources surface here;
// builtin commands like /clear are session-scoped and not relevant in a Todo
// description, so we only show custom commands).
interface SlashCommand {
  id: string
  trigger: string
  title: string
  description?: string
  source?: "command" | "mcp" | "skill"
}

export const DialogEditTodo: Component<DialogEditTodoProps> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useServerSDK()
  const serverSync = useServerSync()

  const [store, setStore] = createStore({
    title: props.todo?.title ?? "",
    description: props.todo?.description ?? "",
    status: props.todo?.status ?? FALLBACK_STATUS,
    priority: props.todo?.priority ?? "none",
    due_date: props.todo?.due_date ? props.todo.due_date.substring(0, 10) : "",
    labels: [...(props.todo?.labels ?? [])] as string[],
    assignee_id: (props.todo?.assignee_id ?? null) as string | null,
  })

  // Linear workflow statuses — loaded via Linear MCP `list_issue_statuses`.
  // Used to populate the status selector with the team's actual workflow
  // states (Backlog, Todo, In Progress, In Review, Done, Canceled,
  // Duplicate, plus any team-customized names). The `name` is the workflow
  // state name, stored verbatim as Issue.Status — no separate classification
  // field is needed because AutoProgress matches the 7 Linear default status
  // names directly. Falls back to ["Backlog"] when Linear is not connected.
  type LinearStatus = { id: string; name: string; color?: string }
  // Linear workspace members — loaded via Linear MCP `list_users`. Used to
  // populate the assignee selector. Empty list means Linear is not connected
  // or has no members; in that case the assignee field is hidden.
  type LinearUser = { id: string; name: string; email?: string; avatarUrl?: string }

  const [ui, setUi] = createStore({
    linearStatuses: [] as LinearStatus[],
    linearUsers: [] as LinearUser[],
    usersLoading: false,
    usersError: false,
    popover: null as "at" | "slash" | null,
    atQuery: "",
    atResults: [] as string[],
    atActive: 0,
    slashCommands: [] as SlashCommand[],
    slashQuery: "",
    slashActive: 0,
    textareaEl: null as HTMLTextAreaElement | null,
    triggerRange: null as { start: number; end: number } | null,
  })

  const loadLinearStatuses = async () => {
    await sdk()
      .client.issue.linearStatuses({ directory: props.directory })
      .then((res) => {
        if (res.error || !res.data) {
          setUi("linearStatuses", [])
          return
        }
        const statuses = (res.data as unknown as LinearStatus[]).filter((s) => !!s.name)
        setUi("linearStatuses", statuses)
      })
      .catch(() => {
        setUi("linearStatuses", [])
      })
  }
  void loadLinearStatuses()

  // Status options for the selector. Uses the dynamically loaded Linear
  // workflow states; falls back to ["Backlog"] when Linear is not connected.
  // Always includes the current status even if it's not in the Linear list
  // (e.g., a locally-created issue with a custom status before first sync).
  // Case-insensitive dedup: if store.status matches a Linear status name
  // (e.g., legacy "todo" vs Linear "Todo"), the Linear canonical casing wins
  // and no duplicate is appended.
  const statusOptions = createMemo<string[]>(() => {
    const names = ui.linearStatuses.map((s) => s.name)
    if (names.length === 0) return [FALLBACK_STATUS]
    if (store.status && !names.some((n) => n.toLowerCase() === store.status!.toLowerCase())) {
      names.push(store.status)
    }
    return names
  })

  // When the user picks a status, store the workflow state name directly.
  // AutoProgress classifies states by matching against the 7 Linear default
  // status names, so no separate classification field is needed.
  const onSelectStatus = (name: string) => {
    setStore("status", name)
  }

  const loadLinearUsers = async () => {
    setUi("usersLoading", true)
    setUi("usersError", false)
    await sdk()
      .client.issue.linearUsers({ directory: props.directory })
      .then((res) => {
        if (res.error || !res.data) {
          setUi("usersError", true)
          return
        }
        const users = (res.data as unknown as LinearUser[]).filter((u) => !!u.id && !!u.name)
        setUi("linearUsers", users)
      })
      .catch(() => {
        setUi("usersError", true)
      })
      .finally(() => {
        setUi("usersLoading", false)
      })
  }
  void loadLinearUsers()

  // Assignee options: "Unassigned" sentinel + Linear members.
  // The sentinel uses empty id so we can map back to null assignee_id.
  type AssigneeOption = { id: string; name: string }
  const assigneeOptions = createMemo<AssigneeOption[]>(() => {
    const unassigned: AssigneeOption = { id: "", name: language.t("dialog.todo.field.assignee.unassigned") }
    return [unassigned, ...ui.linearUsers.map((u) => ({ id: u.id, name: u.name }))]
  })

  const currentAssigneeOption = createMemo<AssigneeOption>(() => {
    const aid = store.assignee_id
    if (!aid) return assigneeOptions()[0] // Unassigned
    return assigneeOptions().find((o) => o.id === aid) ?? { id: aid, name: aid }
  })

  // Load slash commands once on mount (skill + mcp sources; builtin commands
  // are session-scoped and not useful in a Todo description).
  const loadSlashCommands = async () => {
    const res = await sdk().client.command.list({ directory: props.directory })
    if (res.error || !res.data) return
    const cmds = (res.data as unknown as Array<{ name: string; description?: string; source?: string }>)
      .filter((c) => c.source === "skill" || c.source === "mcp" || c.source === "command")
      .map((c) => ({
        id: `custom.${c.name}`,
        trigger: c.name,
        title: c.name,
        description: c.description,
        source: c.source as "command" | "mcp" | "skill",
      }))
    setUi("slashCommands", cmds)
  }
  void loadSlashCommands()

  const handleClose = () => {
    props.onClose?.()
    dialog.close()
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const title = store.title.trim()
      if (!title) throw new Error(language.t("dialog.todo.error.titleRequired"))

      const payload = {
        title,
        content: title,
        description: store.description,
        status: store.status,
        priority: store.priority,
        labels: store.labels,
        // SDK type is `due_date?: string` (nullable not emitted by Effect OpenAPI
        // generator). Cast to satisfy the type while preserving `null` at runtime
        // so the server clears the field (server checks `!== undefined`).
        due_date: (store.due_date || null) as string | undefined,
        assignee_id: store.assignee_id || undefined,
      }

      if (props.mode === "create") {
        const issue =
          props.parentId !== undefined ? { ...payload, level: 1, parent_id: props.parentId } : { ...payload, level: 0 }
        const res = await sdk().client.issue.create({
          directory: props.directory,
          issue,
        })
        // throwOnError:true throws on non-2xx; but hono-openapi validator returns
        // 200 + {success:false, error:[...]} on validation failure, so we must
        // check success field manually.
        const r = res as unknown as { success?: boolean; error?: unknown }
        if (r.success === false) throw r
        if (res.error) throw res.error
        return
      }
      const res = await sdk().client.issue.update({
        id: props.todo!.id!,
        directory: props.directory,
        patch: payload,
      })
      if (res.error) throw res.error
    },
    onSuccess: () => {
      serverSync().todo.refresh(props.directory)
      showToast({
        variant: "success",
        title: props.mode === "create" ? language.t("dialog.todo.created") : language.t("dialog.todo.updated"),
      })
      handleClose()
    },
    onError: (e: unknown) => {
      const msg = (() => {
        if (typeof e === "string") return e
        if (!e || typeof e !== "object") return undefined
        const err = e as { message?: string; error?: unknown }
        if (err.message) return err.message
        if (typeof err.error === "string") return err.error
        if (Array.isArray(err.error)) {
          // Zod validation errors: [{ path, message, code }]
          return err.error
            .map((x: unknown) => {
              const z = x as { path?: unknown[]; message?: string; code?: string }
              const path = Array.isArray(z.path) ? z.path.join(".") : ""
              return z.message ? (path ? `${path}: ${z.message}` : z.message) : (z.code ?? String(x))
            })
            .join("; ")
        }
        if (err.error && typeof err.error === "object") {
          const inner = err.error as { message?: string; error?: string }
          return inner.message ?? (typeof inner.error === "string" ? inner.error : undefined)
        }
        return undefined
      })()
      showToast({ variant: "error", title: msg ?? language.t("dialog.todo.error.saveFailed") })
    },
  }))

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (saveMutation.isPending) return
    saveMutation.mutate()
  }

  const priorityLabel = (p: (typeof PRIORITY_OPTIONS)[number]) => language.t(`sidebar.issue.priority.${p}`)

  // --- Label multi-select toggle ---
  const toggleLabel = (label: string) => {
    setStore("labels", (prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]))
  }

  // --- Reference autocomplete: trigger detection ---
  const detectTrigger = (text: string, cursor: number) => {
    // `@` matches anywhere before the cursor (file refs can be inserted inline).
    // Allow word chars, dash, dot, slash in the query (file paths contain them).
    const atMatch = text.substring(0, cursor).match(/@([a-zA-Z0-9_./-]*)$/)
    if (atMatch) {
      const start = cursor - atMatch[0].length
      setUi("triggerRange", { start, end: cursor })
      setUi("atQuery", atMatch[1])
      void runAtQuery(atMatch[1])
      setUi("popover", "at")
      setUi("atActive", 0)
      return
    }
    // `/` matches anywhere before the cursor (more permissive than the chat
    // composer's line-start rule, because Todo descriptions are free-form
    // markdown and users may insert skill refs mid-sentence). Allow word
    // chars and dash in skill/command triggers.
    const slashMatch = text.substring(0, cursor).match(/\/([a-zA-Z0-9_-]*)$/)
    if (slashMatch) {
      const start = cursor - slashMatch[0].length
      setUi("triggerRange", { start, end: cursor })
      setUi("slashQuery", slashMatch[1])
      setUi("popover", "slash")
      setUi("slashActive", 0)
      return
    }
    setUi("popover", null)
    setUi("triggerRange", null)
  }

  const runAtQuery = async (query: string) => {
    const res = await sdk().client.find.files({
      query,
      dirs: "false",
      directory: props.directory,
    })
    if (res.error || !res.data) {
      setUi("atResults", [])
      return
    }
    const paths = (res.data as unknown as Array<{ path?: string } | string>)
      .map((item) => (typeof item === "string" ? item : item.path))
      .filter((p): p is string => !!p)
      .slice(0, 10)
    setUi("atResults", paths)
  }

  const filteredSlash = createMemo(() => {
    const q = ui.slashQuery.toLowerCase()
    if (!q) return ui.slashCommands
    return ui.slashCommands.filter((c) => c.trigger.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
  })

  // --- Reference autocomplete: insertion ---
  const insertAtSelection = (path: string) => {
    const el = ui.textareaEl
    if (!el) return
    const range = ui.triggerRange
    if (!range) return
    const before = store.description.substring(0, range.start)
    const after = store.description.substring(range.end)
    const insert = `@${path} `
    const next = before + insert + after
    setStore("description", next)
    setUi("popover", null)
    setUi("triggerRange", null)
    // Restore focus and place cursor right after the inserted reference.
    requestAnimationFrame(() => {
      const pos = before.length + insert.length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const insertSlashSelection = (cmd: SlashCommand) => {
    const el = ui.textareaEl
    if (!el) return
    const range = ui.triggerRange
    if (!range) return
    const before = store.description.substring(0, range.start)
    const after = store.description.substring(range.end)
    const insert = `/${cmd.trigger} `
    const next = before + insert + after
    setStore("description", next)
    setUi("popover", null)
    setUi("triggerRange", null)
    requestAnimationFrame(() => {
      const pos = before.length + insert.length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const handleDescriptionInput = (e: InputEvent) => {
    const el = e.currentTarget as HTMLTextAreaElement
    setStore("description", el.value)
    detectTrigger(el.value, el.selectionStart ?? el.value.length)
  }

  const handleDescriptionKeyDown = (e: KeyboardEvent) => {
    if (ui.popover === "at") {
      const items = ui.atResults
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setUi("atActive", (i) => (i + 1) % Math.max(items.length, 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setUi("atActive", (i) => (i - 1 + items.length) % Math.max(items.length, 1))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        const item = items[ui.atActive]
        if (item) insertAtSelection(item)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setUi("popover", null)
        return
      }
      return
    }
    if (ui.popover === "slash") {
      const items = filteredSlash()
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setUi("slashActive", (i) => (i + 1) % Math.max(items.length, 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setUi("slashActive", (i) => (i - 1 + items.length) % Math.max(items.length, 1))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        const item = items[ui.slashActive]
        if (item) insertSlashSelection(item)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setUi("popover", null)
        return
      }
    }
  }

  return (
    <Dialog
      size="large"
      title={props.mode === "create" ? language.t("dialog.todo.title.create") : language.t("dialog.todo.title.edit")}
      class="w-full"
    >
      <form onSubmit={handleSubmit} class="flex h-full flex-col">
        <div class="flex-1 overflow-y-auto px-6 py-4">
          <div class="flex flex-col gap-4">
            {/* Title — primary identifier */}
            <TextField
              autofocus
              type="text"
              label={language.t("dialog.todo.field.title")}
              placeholder={language.t("dialog.todo.field.title.placeholder")}
              value={store.title}
              onChange={(v) => setStore("title", v)}
              required
            />

            {/* Description — supports markdown + @file / /skill refs */}
            <div class="flex flex-col gap-1.5">
              <label class="text-12-medium text-text-weak">{language.t("dialog.todo.field.description")}</label>
              <div class="relative">
                <textarea
                  ref={(el) => setUi("textareaEl", el)}
                  class="min-h-[100px] resize-y rounded-lg border border-border-base bg-surface-base px-3 py-2 text-13-regular text-text-strong outline-none transition-colors focus:border-border-interactive-base w-full"
                  placeholder={language.t("dialog.todo.field.description.placeholder")}
                  value={store.description}
                  onInput={handleDescriptionInput}
                  onKeyDown={handleDescriptionKeyDown}
                  onBlur={() => setTimeout(() => setUi("popover", null), 150)}
                />
                {/* Autocomplete dropdown — @file list.
                    Selected item uses info-tinted background + interactive border
                    for strong contrast against the raised dropdown surface. */}
                <Show when={ui.popover === "at"}>
                  <div class="absolute z-10 left-0 right-0 mt-1 rounded-md border border-border-base bg-surface-raised-base shadow-lg max-h-48 overflow-y-auto">
                    <Show
                      when={ui.atResults.length > 0}
                      fallback={
                        <div class="px-3 py-2 text-11-regular text-text-weaker">
                          {language.t("dialog.todo.autocomplete.noFiles")}
                        </div>
                      }
                    >
                      <For each={ui.atResults}>
                        {(path, idx) => (
                          <button
                            type="button"
                            class={`block w-full text-left px-3 py-1.5 text-12-regular transition-colors ${
                              idx() === ui.atActive
                                ? "bg-surface-info-base/30 text-text-strong border-l-2 border-border-interactive-base"
                                : "text-text-strong hover:bg-surface-strong-base border-l-2 border-transparent"
                            }`}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              insertAtSelection(path)
                            }}
                            onMouseEnter={() => setUi("atActive", idx())}
                          >
                            <span class="text-text-weaker">@</span>
                            {path}
                          </button>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
                {/* Autocomplete dropdown — /skill /command list */}
                <Show when={ui.popover === "slash"}>
                  <div class="absolute z-10 left-0 right-0 mt-1 rounded-md border border-border-base bg-surface-raised-base shadow-lg max-h-48 overflow-y-auto">
                    <Show
                      when={filteredSlash().length > 0}
                      fallback={
                        <div class="px-3 py-2 text-11-regular text-text-weaker">
                          {language.t("dialog.todo.autocomplete.noSkills")}
                        </div>
                      }
                    >
                      <For each={filteredSlash()}>
                        {(cmd, idx) => (
                          <button
                            type="button"
                            class={`block w-full text-left px-3 py-1.5 text-12-regular transition-colors ${
                              idx() === ui.slashActive
                                ? "bg-surface-info-base/30 text-text-strong border-l-2 border-border-interactive-base"
                                : "text-text-strong hover:bg-surface-strong-base border-l-2 border-transparent"
                            }`}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              insertSlashSelection(cmd)
                            }}
                            onMouseEnter={() => setUi("slashActive", idx())}
                          >
                            <div class="flex items-center gap-2">
                              <span class="text-text-weaker">/{cmd.trigger}</span>
                              <Show when={cmd.source}>
                                <span class="text-9-regular px-1 rounded bg-surface-base text-text-weaker border border-border-base">
                                  {cmd.source}
                                </span>
                              </Show>
                            </div>
                            <Show when={cmd.description}>
                              <span class="block text-10-regular text-text-weaker truncate">{cmd.description}</span>
                            </Show>
                          </button>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
              </div>
              <span class="text-11-regular text-text-weaker">{language.t("dialog.todo.field.description.hint")}</span>
            </div>

            {/* Status + Priority — Linear-aligned. Status options are fetched
              dynamically from the team's Linear workflow via list_issue_statuses;
              falls back to ["Backlog"] when Linear is not connected. The status
              name is displayed verbatim (no i18n mapping) since teams may
              customize state names. */}
            <div class="grid grid-cols-2 gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-weak">{language.t("dialog.todo.field.status")}</label>
                <Select
                  options={statusOptions()}
                  current={store.status}
                  value={(s) => s}
                  label={(s) => s}
                  onSelect={(s) => onSelectStatus(s ?? FALLBACK_STATUS)}
                  variant="secondary"
                  size="normal"
                  class="w-full"
                />
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-weak">{language.t("dialog.todo.field.priority")}</label>
                <Select
                  options={[...PRIORITY_OPTIONS]}
                  current={store.priority}
                  value={(p) => p}
                  label={(p) => priorityLabel(p as (typeof PRIORITY_OPTIONS)[number])}
                  onSelect={(p) => setStore("priority", (p ?? "none") as typeof store.priority)}
                  variant="secondary"
                  size="normal"
                  class="w-full"
                />
              </div>
            </div>

            {/* Due date + Labels multi-select */}
            <div class="grid grid-cols-2 gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-weak">{language.t("dialog.todo.field.dueDate")}</label>
                <DatePicker
                  value={store.due_date}
                  onChange={(v) => setStore("due_date", v)}
                  label={language.t("dialog.todo.field.dueDate")}
                />
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-weak">{language.t("dialog.todo.field.labels")}</label>
                <div class="flex flex-wrap gap-1.5 pt-1">
                  <For each={LABEL_OPTIONS}>
                    {(label) => {
                      const selected = () => store.labels.includes(label)
                      const c = () => labelChipColors(label)
                      return (
                        <button
                          type="button"
                          class="text-11-regular px-2 py-1 rounded-md border transition-colors"
                          style={
                            selected()
                              ? { "background-color": c().bg, color: c().text, "border-color": c().border }
                              : undefined
                          }
                          classList={{
                            "bg-surface-base text-text-weaker border-border-base hover:border-border-interactive-base":
                              !selected(),
                          }}
                          onClick={() => toggleLabel(label)}
                          aria-pressed={selected()}
                        >
                          {label}
                        </button>
                      )
                    }}
                  </For>
                </div>
              </div>
            </div>

            {/* Linear link info — read-only informational banner (NOT an input).
                Per ui-ux-pro-max §8 read-only-distinction: read-only state must
                be visually distinct from inputs; use plain text + icon, no
                input border, no background that mimics a form field. */}
            <Show when={props.mode === "edit" && props.todo?.linear_issue_id}>
              <div class="flex items-center gap-2 text-11-regular text-text-weaker">
                <span class="size-1.5 rounded-full bg-surface-success-strong shrink-0" />
                <span>
                  {language.t("dialog.todo.linkedLinear")}:{" "}
                  <span class="text-text-base">{props.todo?.linear_issue_id}</span>
                </span>
              </div>
            </Show>

            {/* Assignee — Linear MCP integration.
                Loads Linear workspace members via `list_users` and writes
                `assignee_id` through the standard issue create/update path.
                Hidden when Linear is not connected (empty user list and no
                existing assignee). Per ui-ux-pro-max §5 visual-hierarchy:
                uses the same Select component as Status/Priority for
                consistency. */}
            <Show when={ui.usersLoading || ui.linearUsers.length > 0 || (!!store.assignee_id && !ui.usersLoading)}>
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-weak">{language.t("dialog.todo.field.assignee")}</label>
                <Show
                  when={!ui.usersError || ui.linearUsers.length > 0}
                  fallback={
                    <div class="text-11-regular text-text-weaker px-2 py-1.5 rounded-md border border-border-base bg-surface-base">
                      {language.t("dialog.todo.field.assignee.loadFailed")}
                    </div>
                  }
                >
                  <Show
                    when={!ui.usersLoading || ui.linearUsers.length > 0}
                    fallback={
                      <div class="flex items-center gap-2 text-11-regular text-text-weaker px-2 py-1.5 rounded-md border border-border-base bg-surface-base">
                        <Spinner class="size-3" />
                        {language.t("dialog.todo.field.assignee.loading")}
                      </div>
                    }
                  >
                    <Select
                      options={assigneeOptions()}
                      current={currentAssigneeOption()}
                      value={(o) => o.id}
                      label={(o) => o.name}
                      onSelect={(o) => setStore("assignee_id", o?.id || null)}
                      variant="secondary"
                      size="normal"
                      class="w-full"
                      placeholder={language.t("dialog.todo.field.assignee.placeholder")}
                    />
                  </Show>
                </Show>
                <span class="text-11-regular text-text-weaker">{language.t("dialog.todo.field.assignee.hint")}</span>
              </div>
            </Show>
          </div>
        </div>

        {/* Sticky footer — primary + secondary actions (UX §8 destructive-emphasis) */}
        <div class="flex shrink-0 justify-end gap-2 border-t border-border-weak-base px-6 py-3">
          <Button type="button" variant="ghost" size="large" onClick={handleClose}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={saveMutation.isPending}>
            {saveMutation.isPending
              ? language.t("common.saving")
              : props.mode === "create"
                ? language.t("dialog.todo.action.create")
                : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

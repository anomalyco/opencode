import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useOpencodeModeStack, useBindings } from "../keymap"
import { useProject } from "../context/project"
import { useRoute, useRouteData } from "../context/route"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"

type Role = "architect" | "coder"

type ModelRef = {
  readonly id: string
  readonly providerID: string
  readonly variant?: string
}

type RoleSelection = {
  readonly agent: string
  readonly model?: ModelRef
}

type WorkflowTask = {
  readonly id: string
  readonly title: string
  readonly status:
    | "blocked"
    | "ready"
    | "coding"
    | "audit_pending"
    | "remediation_ready"
    | "approved"
    | "integrating"
    | "integrated"
    | "needs_human"
    | "failed"
    | "cancelled"
  readonly dependencies: readonly string[]
  readonly attempts: number
  readonly summary?: string
}

type WorkflowAttempt = {
  readonly id: string
  readonly taskID: string
  readonly status: "submitted" | "approved" | "rejected" | "failed"
  readonly sessionID?: string
  readonly summary?: string
  readonly feedback?: string
  readonly findings: readonly {
    readonly severity: "info" | "warning" | "error"
    readonly message: string
    readonly path?: string
  }[]
}

type WorkflowInfo = {
  readonly id: string
  readonly story: string
  readonly status: "planning" | "running" | "final_audit" | "paused" | "needs_human" | "completed" | "failed" | "cancelled"
  readonly architect: RoleSelection
  readonly coder: RoleSelection
  readonly concurrency: number
  readonly tasks: readonly WorkflowTask[]
  readonly attempts: readonly WorkflowAttempt[]
  readonly sessions: {
    readonly architect: readonly string[]
    readonly coder: readonly string[]
  }
  readonly branch?: string
}

type WorkflowPreferences = {
  readonly architect?: RoleSelection
  readonly coder?: RoleSelection
  readonly concurrency?: number
}

const workflowMode = "workflow"

export function WorkflowRoute() {
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const modeStack = useOpencodeModeStack()
  const project = useProject()
  const route = useRoute()
  const routeData = useRouteData("workflow")
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()
  const toast = useToast()
  const [preferences, setPreferences] = createSignal<WorkflowPreferences>({})
  const [workflows, setWorkflows] = createSignal<WorkflowInfo[]>([])
  const [selectedWorkflowID, setSelectedWorkflowID] = createSignal(routeData.workflowID)
  const [busy, setBusy] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string>()
  let textarea: TextareaRenderable | undefined

  const location = createMemo(() => ({
    directory: project.instance.directory() || undefined,
    workspace: project.workspace.current(),
  }))
  const current = createMemo(() => workflows().find((item) => item.id === selectedWorkflowID()) ?? workflows()[0])
  const architect = createMemo(() => preferences().architect)
  const coder = createMemo(() => preferences().coder)
  const concurrency = createMemo(() => preferences().concurrency ?? 2)
  const visibleAgents = createMemo(() => sync.data.agent.filter((agent) => agent.mode !== "subagent" && !agent.hidden))
  const contentWidth = createMemo(() => Math.min(110, Math.max(70, dimensions().width - 4)))

  onMount(() => {
    const popMode = modeStack.push(workflowMode)
    void refresh()
    textarea?.focus()
    const interval = setInterval(() => {
      if (busy()) return
      void refresh({ quiet: true })
    }, 3000)
    onCleanup(() => {
      clearInterval(interval)
      popMode()
    })
  })

  createEffect(() => {
    const match = routeData.workflowID
    if (match) setSelectedWorkflowID(match)
  })

  useBindings(() => ({
    mode: workflowMode,
    commands: [
      {
        name: "workflow.submit",
        title: "Start workflow",
        category: "Workflow",
        run: submit,
      },
      {
        name: "workflow.refresh",
        title: "Refresh workflows",
        category: "Workflow",
        run: () => void refresh(),
      },
      {
        name: "workflow.pause_resume",
        title: "Pause or resume workflow",
        category: "Workflow",
        run: () => void pauseOrResume(),
      },
      {
        name: "workflow.cancel",
        title: "Cancel workflow",
        category: "Workflow",
        run: () => void cancelWorkflow(),
      },
      {
        name: "workflow.home",
        title: "Return home",
        category: "Workflow",
        run: () => route.navigate({ type: "home" }),
      },
    ],
    bindings: [
      { key: "ctrl+return", desc: "Start workflow", cmd: "workflow.submit" },
      { key: "r", desc: "Refresh workflows", cmd: "workflow.refresh" },
      { key: "p", desc: "Pause/resume workflow", cmd: "workflow.pause_resume" },
      { key: "x", desc: "Cancel workflow", cmd: "workflow.cancel" },
      { key: "escape", desc: "Home", cmd: "workflow.home" },
    ],
  }))

  async function refresh(options?: { quiet?: boolean }) {
    if (!options?.quiet) setLoading(true)
    setError(undefined)
    try {
      const [nextPreferences, nextWorkflows] = await Promise.all([
        request<WorkflowPreferences>("GET", "/api/workflow/preferences"),
        request<WorkflowInfo[]>("GET", "/api/workflow"),
      ])
      setPreferences(nextPreferences)
      setWorkflows(nextWorkflows)
      if (!selectedWorkflowID() && nextWorkflows[0]) setSelectedWorkflowID(nextWorkflows[0].id)
    } catch (caught) {
      const message = errorMessage(caught)
      setError(message)
      if (!options?.quiet) toast.show({ variant: "error", message })
    } finally {
      setLoading(false)
    }
  }

  async function savePreferences(next: WorkflowPreferences) {
    setBusy(true)
    try {
      setPreferences(await request("PUT", "/api/workflow/preferences", next))
      toast.show({ variant: "success", message: "Workflow preferences saved" })
    } catch (caught) {
      toast.show({ variant: "error", message: errorMessage(caught) })
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    const text = (textarea?.plainText ?? "").trim()
    if (!text) {
      toast.show({ variant: "warning", message: "Tell the Architect a story first." })
      textarea?.focus()
      return
    }
    if (!architect() || !coder()) {
      toast.show({ variant: "warning", message: "Select both Architect and Coder before starting." })
      return
    }
    setBusy(true)
    try {
      const workflow = await request<WorkflowInfo>("POST", "/api/workflow", {
        story: text,
        architect: architect(),
        coder: coder(),
        concurrency: concurrency(),
      })
      textarea?.setText("")
      setSelectedWorkflowID(workflow.id)
      route.navigate({ type: "workflow", workflowID: workflow.id })
      await refresh({ quiet: true })
      toast.show({ variant: "success", message: "Workflow started" })
    } catch (caught) {
      toast.show({ variant: "error", message: errorMessage(caught) })
    } finally {
      setBusy(false)
    }
  }

  async function pauseOrResume() {
    const workflow = current()
    if (!workflow) return
    const action = workflow.status === "paused" ? "resume" : "pause"
    setBusy(true)
    try {
      const next = await request<WorkflowInfo>("POST", `/api/workflow/${encodeURIComponent(workflow.id)}/${action}`)
      setWorkflows((items) => replaceWorkflow(items, next))
      toast.show({ variant: "success", message: action === "pause" ? "Workflow paused" : "Workflow resumed" })
    } catch (caught) {
      toast.show({ variant: "error", message: errorMessage(caught) })
    } finally {
      setBusy(false)
    }
  }

  async function cancelWorkflow() {
    const workflow = current()
    if (!workflow) return
    setBusy(true)
    try {
      const next = await request<WorkflowInfo>("POST", `/api/workflow/${encodeURIComponent(workflow.id)}/cancel`)
      setWorkflows((items) => replaceWorkflow(items, next))
      toast.show({ variant: "success", message: "Workflow cancelled" })
    } catch (caught) {
      toast.show({ variant: "error", message: errorMessage(caught) })
    } finally {
      setBusy(false)
    }
  }

  async function request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
    const response = await sdk.fetch(url(path), {
      method,
      headers: {
        ...headersObject(sdk.headers),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = (await response.json().catch(() => undefined)) as unknown
    if (!response.ok) throw new Error(responseError(payload) ?? `Workflow request failed (${response.status})`)
    if (payload && typeof payload === "object" && "data" in payload) return payload.data as T
    return payload as T
  }

  function url(path: string) {
    const target = new URL(path, sdk.url)
    const value = location()
    if (value.directory) target.searchParams.set("location[directory]", value.directory)
    if (value.workspace) target.searchParams.set("location[workspace]", value.workspace)
    return target
  }

  function selectAgent(role: Role) {
    dialog.replace(() => (
      <DialogSelect<string>
        title={`Select ${role}`}
        current={preferences()[role]?.agent}
        options={visibleAgents().map((agent) => ({
          value: agent.name,
          title: agent.name,
          description: agent.native ? "native" : agent.description,
        }))}
        onSelect={(option) => {
          void savePreferences({
            ...preferences(),
            [role]: {
              agent: option.value,
              model: preferences()[role]?.model,
            },
          })
          dialog.clear()
        }}
      />
    ))
  }

  function selectModel(role: Role) {
    dialog.replace(() => (
      <DialogSelect<{ providerID: string; modelID: string }>
        title={`Select ${role} model`}
        current={modelSelection(preferences()[role]?.model)}
        options={sync.data.provider.flatMap((provider) =>
          Object.values(provider.models).map((model) => ({
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? model.id,
            category: provider.name,
            description: preferences()[role]?.model?.id === model.id ? "selected" : undefined,
            disabled: provider.id === "opencode" && model.id.includes("-nano"),
          })),
        )}
        flat
        onSelect={(option) => {
          void savePreferences({
            ...preferences(),
            [role]: {
              agent: preferences()[role]?.agent ?? visibleAgents()[0]?.name ?? "build",
              model: {
                providerID: option.value.providerID,
                id: option.value.modelID,
              },
            },
          })
          dialog.clear()
        }}
      />
    ))
  }

  function selectVariant(role: Role) {
    const model = preferences()[role]?.model
    const provider = sync.data.provider.find((item) => item.id === model?.providerID)
    const info = model ? provider?.models[model.id] : undefined
    const variants = Object.keys(info?.variants ?? {})
    if (!model || variants.length === 0) {
      toast.show({ variant: "info", message: `No ${role} model variants available.` })
      return
    }
    dialog.replace(() => (
      <DialogSelect<string>
        title={`Select ${role} variant`}
        current={model.variant ?? "default"}
        options={[
          { value: "default", title: "Default" },
          ...variants.map((variant) => ({
            value: variant,
            title: variant,
          })),
        ]}
        flat
        onSelect={(option) => {
          void savePreferences({
            ...preferences(),
            [role]: {
              agent: preferences()[role]?.agent ?? visibleAgents()[0]?.name ?? "build",
              model: {
                ...model,
                variant: option.value === "default" ? undefined : option.value,
              },
            },
          })
          dialog.clear()
        }}
      />
    ))
  }

  function selectConcurrency() {
    dialog.replace(() => (
      <DialogSelect<number>
        title="Select workflow concurrency"
        current={concurrency()}
        options={[1, 2, 3, 4, 5, 6, 8].map((value) => ({
          value,
          title: `${value}`,
          description: value === 2 ? "default" : undefined,
        }))}
        flat
        onSelect={(option) => {
          void savePreferences({ ...preferences(), concurrency: option.value })
          dialog.clear()
        }}
      />
    ))
  }

  return (
    <box flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} backgroundColor={theme.background}>
      <box width="100%" maxWidth={contentWidth()} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Architect-Coder Workflow
          </text>
          <text fg={theme.textMuted}>esc home · r refresh · ctrl+return start</text>
        </box>

        <box flexDirection="row" gap={2} flexShrink={0}>
          <RoleCard
            title="Architect"
            selection={architect()}
            onAgent={() => selectAgent("architect")}
            onModel={() => selectModel("architect")}
            onVariant={() => selectVariant("architect")}
          />
          <RoleCard
            title="Coder"
            selection={coder()}
            onAgent={() => selectAgent("coder")}
            onModel={() => selectModel("coder")}
            onVariant={() => selectVariant("coder")}
          />
          <box width={18} border borderColor={theme.border} paddingLeft={1} paddingRight={1}>
            <text fg={theme.textMuted}>Concurrency</text>
            <text fg={theme.text} onMouseUp={selectConcurrency}>
              {concurrency()} <span style={{ fg: theme.textMuted }}>select</span>
            </text>
          </box>
        </box>

        <box border borderColor={theme.border} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} gap={1}>
          <text fg={theme.textMuted}>Story for Architect</text>
          <textarea
            ref={(value: TextareaRenderable) => (textarea = value)}
            height={5}
            placeholder="Describe the story. The Architect will plan task chunks for the Coder."
            placeholderColor={theme.textMuted}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
          />
          <box flexDirection="row" gap={2}>
            <text fg={busy() ? theme.textMuted : theme.success} onMouseUp={() => void submit()}>
              ctrl+return start workflow
            </text>
            <Show when={busy()}>
              <text fg={theme.textMuted}>working...</text>
            </Show>
          </box>
        </box>

        <Show when={error()}>
          {(message) => <text fg={theme.error}>{message()}</text>}
        </Show>

        <box flexDirection="row" gap={2} minHeight={0} flexGrow={1}>
          <box width={32} border borderColor={theme.border} paddingLeft={1} paddingRight={1} gap={1}>
            <text fg={theme.textMuted}>Workflows</text>
            <Show when={!loading()} fallback={<text fg={theme.textMuted}>loading...</text>}>
              <For each={workflows()}>
                {(workflow) => (
                  <text
                    fg={workflow.id === current()?.id ? theme.text : theme.textMuted}
                    onMouseUp={() => {
                      setSelectedWorkflowID(workflow.id)
                      route.navigate({ type: "workflow", workflowID: workflow.id })
                    }}
                  >
                    {statusIcon(workflow.status)} {workflow.id.slice(0, 14)}
                  </text>
                )}
              </For>
              <Show when={workflows().length === 0}>
                <text fg={theme.textMuted}>No workflows yet</text>
              </Show>
            </Show>
          </box>

          <box flexGrow={1} minWidth={0} border borderColor={theme.border} paddingLeft={1} paddingRight={1}>
            <Show when={current()} fallback={<text fg={theme.textMuted}>Start a workflow to see status here.</text>}>
              {(workflow) => (
                <scrollbox flexGrow={1}>
                  <box gap={1} paddingRight={1}>
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.text}>
                        <b>{workflow().id}</b> <span style={{ fg: statusColor(workflow().status, theme) }}>{workflow().status}</span>
                      </text>
                      <text fg={theme.textMuted}>
                        p {workflow().status === "paused" ? "resume" : "pause"} · x cancel
                      </text>
                    </box>
                    <text fg={theme.textMuted} wrapMode="word">
                      {workflow().story}
                    </text>
                    <Show when={workflow().branch}>
                      {(branch) => <text fg={theme.textMuted}>branch {branch()}</text>}
                    </Show>
                    <box flexDirection="row" gap={2}>
                      <text fg={theme.warning} onMouseUp={() => void pauseOrResume()}>
                        {workflow().status === "paused" ? "resume" : "pause"}
                      </text>
                      <text fg={theme.error} onMouseUp={() => void cancelWorkflow()}>
                        cancel
                      </text>
                    </box>
                    <text fg={theme.textMuted}>Tasks</text>
                    <For each={workflow().tasks}>
                      {(task) => (
                        <box gap={0}>
                          <text fg={taskColor(task.status, theme)}>
                            {taskIcon(task.status)} {task.id} · {task.title} · {task.status} · attempts {task.attempts}
                          </text>
                          <Show when={task.dependencies.length > 0}>
                            <text fg={theme.textMuted}>  deps {task.dependencies.join(", ")}</text>
                          </Show>
                          <Show when={latestAttempt(workflow(), task.id)}>
                            {(attempt) => (
                              <box gap={0}>
                                <text fg={theme.textMuted}>  last {attempt().status}: {attempt().summary}</text>
                                <Show when={attempt().feedback}>
                                  {(feedback) => <text fg={theme.textMuted} wrapMode="word">  feedback {feedback()}</text>}
                                </Show>
                              </box>
                            )}
                          </Show>
                        </box>
                      )}
                    </For>
                    <SessionLinks label="Architect sessions" ids={workflow().sessions.architect} />
                    <SessionLinks label="Coder sessions" ids={workflow().sessions.coder} />
                  </box>
                </scrollbox>
              )}
            </Show>
          </box>
        </box>
      </box>
    </box>
  )
}

function RoleCard(props: {
  title: string
  selection?: RoleSelection
  onAgent: () => void
  onModel: () => void
  onVariant: () => void
}) {
  const { theme } = useTheme()
  return (
    <box width={30} border borderColor={theme.border} paddingLeft={1} paddingRight={1}>
      <text fg={theme.textMuted}>{props.title}</text>
      <text fg={theme.text} onMouseUp={props.onAgent}>
        {props.selection?.agent ?? "Select agent"}
      </text>
      <text fg={theme.text} onMouseUp={props.onModel}>
        {formatModel(props.selection?.model)}
      </text>
      <text fg={theme.textMuted} onMouseUp={props.onVariant}>
        variant {props.selection?.model?.variant ?? "default"}
      </text>
    </box>
  )
}

function SessionLinks(props: { label: string; ids: readonly string[] }) {
  const route = useRoute()
  const { theme } = useTheme()
  return (
    <box gap={0}>
      <text fg={theme.textMuted}>{props.label}</text>
      <Show when={props.ids.length > 0} fallback={<text fg={theme.textMuted}>  none yet</text>}>
        <For each={props.ids}>
          {(id) => (
            <text fg={theme.info} onMouseUp={() => route.navigate({ type: "session", sessionID: id })}>
              {"  "}{id}
            </text>
          )}
        </For>
      </Show>
    </box>
  )
}

function replaceWorkflow(items: WorkflowInfo[], next: WorkflowInfo) {
  if (items.some((item) => item.id === next.id)) return items.map((item) => (item.id === next.id ? next : item))
  return [next, ...items]
}

function modelSelection(model?: ModelRef) {
  if (!model) return undefined
  return { providerID: model.providerID, modelID: model.id }
}

function formatModel(model?: ModelRef) {
  if (!model) return "Select model"
  return `${model.providerID}/${model.id}`
}

function latestAttempt(workflow: WorkflowInfo, taskID: string) {
  return workflow.attempts.filter((attempt) => attempt.taskID === taskID).at(-1)
}

function headersObject(headers: RequestInit["headers"]) {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers
}

function responseError(payload: unknown) {
  if (!payload || typeof payload !== "object") return
  if ("message" in payload && typeof payload.message === "string") return payload.message
  if ("error" in payload && typeof payload.error === "object" && payload.error && "message" in payload.error) {
    const error = payload.error
    if (typeof error.message === "string") return error.message
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function statusIcon(status: WorkflowInfo["status"]) {
  if (status === "completed") return "✓"
  if (status === "failed" || status === "needs_human") return "!"
  if (status === "paused" || status === "cancelled") return "·"
  return "›"
}

function taskIcon(status: WorkflowTask["status"]) {
  if (status === "integrated" || status === "approved") return "✓"
  if (status === "failed" || status === "needs_human") return "!"
  if (status === "blocked" || status === "cancelled") return "·"
  return "›"
}

function statusColor(status: WorkflowInfo["status"], theme: ReturnType<typeof useTheme>["theme"]) {
  if (status === "completed") return theme.success
  if (status === "failed" || status === "needs_human") return theme.error
  if (status === "paused" || status === "cancelled") return theme.warning
  return theme.info
}

function taskColor(status: WorkflowTask["status"], theme: ReturnType<typeof useTheme>["theme"]) {
  if (status === "integrated" || status === "approved") return theme.success
  if (status === "failed" || status === "needs_human") return theme.error
  if (status === "blocked" || status === "cancelled") return theme.textMuted
  return theme.text
}

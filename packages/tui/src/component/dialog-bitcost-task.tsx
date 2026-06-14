import { createSignal, onMount, Match, Switch } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { useSDK } from "../context/sdk"
import { useRoute } from "../context/route"
import { useLocal } from "../context/local"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { TextAttributes } from "@opentui/core"
import { markBitcostBound, rememberBitcostTasks } from "./bitcost-binding"
import { bitcostBaseUrl, bitcostTraceID, createBitcostTask, fetchBitcostTasks, logBitcostEvent, type BitcostTask } from "./bitcost-api"

type State =
  | { phase: "loading" }
  | { phase: "ready"; tasks: BitcostTask[] }
  | { phase: "error"; message: string }

const CREATE_VALUE = "__bitcost_create__"

export function DialogBitcostTask(props: { sessionID?: string; onBound?: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()
  const sdk = useSDK()
  const route = useRoute()
  const local = useLocal()
  const [state, setState] = createSignal<State>({ phase: "loading" })

  async function load() {
    try {
      const tasks = await fetchBitcostTasks()
      rememberBitcostTasks(tasks)
      setState({ phase: "ready", tasks })
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === "TimeoutError"
            ? `Couldn't reach Bitcost at ${bitcostBaseUrl()} (timed out). Is it running?`
            : err.message
          : "Failed to load tasks"
      setState({ phase: "error", message })
    }
  }

  onMount(() => {
    void load()
  })

  async function bind(taskID: string) {
    const bindTraceID = bitcostTraceID("task-bind", taskID)
    try {
      // No session yet (picked a task from home) → create one now, bound to the
      // task. A session only ever exists once it is attributed to a Task.
      let sessionID = props.sessionID
      const created = sessionID === undefined
      if (sessionID === undefined) {
        const agent = local.agent.current()
        const model = local.model.current()
        if (!agent || !model) {
          toast.show({ variant: "error", message: "Choose an agent and model before selecting a task" })
          return
        }
        const res = await sdk.client.session.create({
          agent: agent.name,
          model: {
            providerID: model.providerID,
            id: model.modelID,
            variant: local.model.variant.current(),
          },
          directory: process.cwd(),
        })
        if (!res.data?.id) {
          toast.show({ variant: "error", message: "Failed to start a session" })
          return
        }
        sessionID = res.data.id
      }
      logBitcostEvent("Bitcost task selected", { traceID: bindTraceID, taskID, sessionID, created })
      await sdk.client.v2.session.bindTask({ sessionID, taskID })
      markBitcostBound(sessionID, taskID)
      logBitcostEvent("Bitcost task bound", { traceID: bindTraceID, taskID, sessionID })
      if (created) route.navigate({ type: "session", sessionID })
      toast.show({ variant: "success", message: "Task selected" })
      dialog.clear()
      props.onBound?.()
    } catch {
      logBitcostEvent("Bitcost task bind failed", { traceID: bindTraceID, taskID, sessionID: props.sessionID })
      toast.show({ variant: "error", message: "Failed to select task" })
    }
  }

  function promptCreate() {
    dialog.replace(() => (
      <DialogPrompt
        title="New task name"
        onConfirm={(value) => void createAndBind(value)}
        onCancel={() => dialog.replace(() => <DialogBitcostTask {...props} />)}
      />
    ))
  }

  async function createAndBind(name: string) {
    if (name.trim().length === 0) {
      dialog.replace(() => <DialogBitcostTask {...props} />)
      return
    }
    try {
      const task = await createBitcostTask(name.trim())
      rememberBitcostTasks([task])
      await bind(String(task.id))
    } catch {
      toast.show({ variant: "error", message: "Failed to create task" })
      dialog.replace(() => <DialogBitcostTask {...props} />)
    }
  }

  const options = (tasks: BitcostTask[]): DialogSelectOption<string>[] => [
    ...tasks.map((task) => ({
      title: task.name ?? String(task.id),
      value: String(task.id),
      onSelect: () => void bind(String(task.id)),
    })),
    {
      title: "＋ Create new task",
      value: CREATE_VALUE,
      onSelect: () => promptCreate(),
    },
  ]

  // NOTE: the top-level element must be a stable container (a <box>), not a bare
  // <Switch>. opentui-solid's child insert unwraps a returned reactive accessor
  // (`while (typeof v === "function") v = v()`), so returning <Switch> directly
  // subscribes the dialog's insert effect to the active-branch memo — flipping the
  // branch (loading→ready) then re-creates the whole component, resetting it to
  // loading in an infinite remount loop. Wrapping in a <box> keeps the inserted
  // node stable and confines branch changes to this box's own children.
  return (
    <box>
      <Switch>
        <Match when={state().phase === "loading"}>
          <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
            <text fg={theme.textMuted}>Loading tasks…</text>
          </box>
        </Match>
        <Match when={state().phase === "error" ? (state() as Extract<State, { phase: "error" }>) : undefined}>
          {(s) => (
            <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
              <text attributes={TextAttributes.BOLD} fg={theme.text}>
                Select a Bitcost task
              </text>
              <text fg={theme.error}>{s().message}</text>
            </box>
          )}
        </Match>
        <Match when={state().phase === "ready" ? (state() as Extract<State, { phase: "ready" }>) : undefined}>
          {(s) => (
            <DialogSelect title="Select a Bitcost task" placeholder="Search tasks…" options={options(s().tasks)} />
          )}
        </Match>
      </Switch>
    </box>
  )
}

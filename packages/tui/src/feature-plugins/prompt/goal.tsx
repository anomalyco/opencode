import type { Plugin } from "@opencode/plugin/tui"
import { Goal } from "@opencode/schema/goal"
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type Accessor } from "solid-js"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { DialogFooter, DialogHeader, DialogLayout, type DialogFooterAction } from "../../ui/dialog"

/**
 * The goal `/goal` set on a Session, from the goal plugin's RPC: fetched when the Session changes or the server
 * reconnects, since changes published meanwhile were missed, and kept current from its `changed` events.
 */
export function createGoal(context: Plugin.Context, sessionID: Accessor<string | undefined>) {
  const [goal, setGoal] = createSignal<Goal.State>()
  const rpc = context.client.rpc(Goal.Definition)
  // A change that arrives while a fetch is in flight is newer than its reply, so each change or fetch takes a turn.
  const turn = { value: 0 }
  const load = (id: string) => {
    const current = ++turn.value
    const directory = context.data.session.get(id)?.location.directory
    // A server without the goal plugin answers with an error, and the Session shows no goal.
    void rpc.get({ sessionID: id }, directory ? { location: { directory } } : undefined).then(
      (next) => {
        if (current === turn.value && sessionID() === id) setGoal(next ?? undefined)
      },
      () => undefined,
    )
  }
  onCleanup(
    rpc.events.on("changed", (event) => {
      if (event.data.sessionID !== sessionID()) return
      turn.value++
      setGoal(event.data.goal ?? undefined)
    }),
  )
  onCleanup(
    context.data.on("server.connected", () => {
      const id = sessionID()
      if (id) load(id)
    }),
  )
  createEffect(
    on(sessionID, (id) => {
      setGoal(undefined)
      if (id) load(id)
    }),
  )
  return goal
}

function goalColor(theme: Plugin.Context["theme"], goal: Goal.State) {
  if (goal.status === "paused") return theme.text.feedback.warning.base
  if (goal.status === "complete") return theme.text.feedback.success.base
  return theme.text.muted
}

function goalLabel(goal: Goal.State) {
  if (goal.status === "paused") return "goal paused"
  if (goal.status === "complete") return "goal met"
  return "goal"
}

/**
 * The goal under the prompt, beside the other session status. Its continuations are hidden from the timeline, so this
 * is where a running goal shows; the objective itself is in the dialog it opens.
 */
export function GoalStatus(props: {
  context: Plugin.Context
  sessionID: string
  goal: Accessor<Goal.State | undefined>
}) {
  const [hovered, setHovered] = createSignal(false)
  const color = (current: Goal.State) =>
    hovered() ? props.context.theme.text.base : goalColor(props.context.theme, current)

  return (
    <Show when={props.goal()}>
      {(current) => (
        <box
          flexShrink={0}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
          onMouseUp={() => showGoal(props.context, props.sessionID, props.goal)}
        >
          <text fg={color(current())} wrapMode="none">
            ◎ {goalLabel(current())}
          </text>
        </box>
      )}
    </Show>
  )
}

/** Opens the goal dialog for a Session, or explains how to start one. */
function showGoal(context: Plugin.Context, sessionID: string, goal: Accessor<Goal.State | undefined>) {
  if (!goal()) {
    context.ui.toast.show({ message: "No goal is set. Start one with /goal <objective>.", variant: "info" })
    return
  }
  context.ui.dialog.show(() => <GoalDialog context={context} sessionID={sessionID} goal={goal} />)
}

function GoalDialog(props: {
  context: Plugin.Context
  sessionID: string
  goal: Accessor<Goal.State | undefined>
}) {
  const theme = useTheme().surface("dialog")
  const goal = props.goal
  const run = (text: "pause" | "resume" | "clear") => {
    if (text === "clear") props.context.ui.dialog.clear()
    void props.context.client.session.command({ sessionID: props.sessionID, name: "goal", text }).catch((error) =>
      props.context.ui.toast.show({
        title: "Failed to update the goal",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      }),
    )
  }
  const actions = createMemo((): DialogFooterAction[] => {
    const current = goal()
    if (!current) return []
    return [
      ...(current.status === "active" ? [{ title: "pause", key: "p", onTrigger: () => run("pause") }] : []),
      ...(current.status === "paused" ? [{ title: "resume", key: "r", onTrigger: () => run("resume") }] : []),
      { title: "clear", key: "x", onTrigger: () => run("clear") },
    ]
  })

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "p",
        title: "Pause goal",
        group: "Dialog",
        enabled: goal()?.status === "active",
        run: () => run("pause"),
      },
      {
        bind: "r",
        title: "Resume goal",
        group: "Dialog",
        enabled: goal()?.status === "paused",
        run: () => run("resume"),
      },
      { bind: "x", title: "Clear goal", group: "Dialog", enabled: goal() !== undefined, run: () => run("clear") },
    ],
  }))

  return (
    <Show when={goal()}>
      {(current) => (
        <DialogLayout
          header={<DialogHeader title="Goal" />}
          footer={{ actions: { primary: actions() } }}
          legacyFooter={<DialogFooter actions={{ primary: actions() }} />}
        >
          <box gap={1}>
            <text fg={theme.text.base}>{current().objective}</text>
            <box>
              <text fg={goalColor(theme, current())} wrapMode="none">
                ◎ {current().status === "active" ? "Active" : current().status === "paused" ? "Paused" : "Met"}
              </text>
              <Show when={current().reason}>{(reason) => <text fg={theme.text.muted}>{reason()}</text>}</Show>
            </box>
          </box>
        </DialogLayout>
      )}
    </Show>
  )
}

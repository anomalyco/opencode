import type { SessionMessageShell } from "@opencode/client/promise"
import { Predicate } from "effect"
import { type UiI18n, useI18n } from "@opencode/ui/context/i18n"
import { Badge } from "@opencode/ui/badge"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createComputed, createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js"
import { useData } from "../../context"
import {
  createShellRunState,
  shellRunProps,
  transitionShellRun,
  viewShellRun,
  type ShellRunEvent,
} from "../../tools/run-machine"
import { createShellFollower } from "../../tools/shell-output"
import { BasicTool } from "../../components/basic-tool"
import { ConsoleOutput, ShellSubmessage, toolInput, toolMetadata, type ToolProps } from "../../tools/tool-renderer"

/**
 * An agent's shell call is a row of activity, as in the current timeline: Shell, then its command, cut to the row while
 * closed. Opening it shows the command and its output in full. How it ended sits at the end of the row when it did not
 * succeed: the exit code, a timeout, or that it was stopped.
 */
export function ShellTool(props: ToolProps) {
  const i18n = useI18n()
  const run = shellRun(props)
  const outcome = createMemo(() => shellOutcome(props.metadata, i18n))
  // The row animates the command in only when it mounted while the model was still writing it.
  const animateCommand = untrack(run.state).status === "writing"

  function Output() {
    run.follow()

    return <ConsoleOutput command={run.view().command} output={run.view().output} />
  }

  return (
    <BasicTool
      {...props}
      status={run.view().basicStatus}
      icon="console"
      rail={false}
      hasContent
      compact
      allowOpenWhilePending
      trigger={(open) => (
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text={i18n.t("ui.tool.shell")} active={run.view().pending} />
            </span>
            <Show when={!open()}>
              <Show
                when={run.view().command}
                fallback={
                  <Show when={run.view().writingPlaceholder}>
                    <span data-slot="basic-tool-tool-subtitle">{i18n.t("ui.tool.shell.writingCommand")}</span>
                  </Show>
                }
              >
                {(command) => <ShellSubmessage text={command()} animate={animateCommand} />}
              </Show>
            </Show>
            <Show when={outcome()}>{(value) => <Badge variant={value().tone}>{value().label}</Badge>}</Show>
          </div>
        </div>
      )}
    >
      <Output />
    </BasicTool>
  )
}

/**
 * A command the user ran shows as an agent's shell call does once opened, its command and output, without the row above
 * them to open it.
 */
function ShellCard(props: ToolProps) {
  const i18n = useI18n()
  const run = shellRun(props)

  run.follow()

  return (
    <div data-component="shell-tool">
      <Show
        when={run.view().command}
        fallback={
          <Show when={run.view().writingPlaceholder}>
            <span data-slot="shell-tool-writing">
              <TextShimmer text={i18n.t("ui.tool.shell.writingCommand")} active />
            </span>
          </Show>
        }
      >
        <ConsoleOutput command={run.view().command} output={run.view().output} />
      </Show>
    </div>
  )
}

// A shell call's run: its state as the call and the shell's live output change it. `follow` streams the output of a
// command still running, for as long as the calling scope lives.
function shellRun(props: ToolProps) {
  const data = useData()

  const runProps = () =>
    shellRunProps(
      {
        status: props.status,
        input: toolInput(props.input),
        metadata: toolMetadata(props.metadata),
        output: props.output,
      },
      (id) => data.shellRunning?.(id) === true,
    )

  const [state, setState] = createSignal(createShellRunState(untrack(runProps)))

  const dispatch = (event: ShellRunEvent) => {
    const next = transitionShellRun(untrack(state), event)

    if (next !== untrack(state)) setState(next)
  }

  // Synchronous, so the row never renders a pass with the previous phase.
  createComputed(on(runProps, (value) => dispatch({ type: "sync", props: value }), { defer: true }))
  const view = createMemo(() => viewShellRun(state()))

  const follow = () => {
    const followID = createMemo(() => view().follow?.id)
    const followRunning = createMemo(() => view().follow?.running === true)

    createEffect(() => {
      const id = followID()
      const load = data.shellOutput

      if (id === undefined || !load) return

      const follower = createShellFollower({
        id,
        directory: data.directory,
        running: untrack(followRunning),
        load,
        onOutput: (output) => dispatch({ type: "output.received", shellID: id, output }),
      })

      createEffect(on(followRunning, (running) => follower.setRunning(running), { defer: true }))
      onCleanup(follower.dispose)
    })
  }

  return { state, view, follow }
}

// How a command ended, where it did not succeed.
function shellOutcome(metadata: ToolProps["metadata"], i18n: UiI18n) {
  if (metadata.interrupted === true || metadata.status === "killed")
    return { tone: "neutral" as const, label: i18n.t("ui.timeline.shell.stopped") }

  if (metadata.timeout === true || metadata.status === "timeout")
    return { tone: "danger" as const, label: i18n.t("ui.timeline.shell.timedOut") }

  if (Predicate.isNumber(metadata.exit) && metadata.exit !== 0)
    return { tone: "danger" as const, label: i18n.t("ui.timeline.shell.exit", { code: metadata.exit }) }
}

/** A command the user ran. */
export function ShellMessage(props: { message: SessionMessageShell }) {
  return (
    <div data-component="session-shell-message" data-timeline-part-id={props.message.id}>
      <ShellCard
        tool="shell"
        input={{ command: props.message.command }}
        metadata={{
          shellID: props.message.shellID,
          status: props.message.status,
          exit: props.message.exit,
          truncated: props.message.output?.truncated,
        }}
        output={props.message.output?.output}
        status={props.message.status === "running" ? "running" : "completed"}
      />
    </div>
  )
}

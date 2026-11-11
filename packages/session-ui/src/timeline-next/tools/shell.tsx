import type { SessionMessageShell } from "@opencode/client/promise"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { createComputed, createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js"
import { LinkedText } from "../../components/linked-text"
import { useData } from "../../context"
import {
  createShellRunState,
  shellRunProps,
  transitionShellRun,
  viewShellRun,
  type ShellRunEvent,
} from "../../tools/run-machine"
import { createShellFollower } from "../../tools/shell-output"
import { ConsoleCopy, toolInput, toolMetadata, type ToolProps } from "../../tools/tool-renderer"
import { ClampedContent } from "./clamped-content"

/**
 * A shell call always shows its command and output. Cut short, the output shows its last lines, where a command says how
 * it went; opening the call shows it in full. How it ended sits on the card when it did not succeed: the exit code, a
 * timeout, or that it was stopped.
 */
export function ShellTool(props: ToolProps) {
  const i18n = useI18n()
  const data = useData()
  const [expanded, setExpanded] = createSignal(false)

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

  const [run, setRun] = createSignal(createShellRunState(untrack(runProps)))

  const dispatch = (event: ShellRunEvent) => {
    const next = transitionShellRun(untrack(run), event)

    if (next !== untrack(run)) setRun(next)
  }

  // Synchronous, so the row never renders a pass with the previous phase.
  createComputed(on(runProps, (value) => dispatch({ type: "sync", props: value }), { defer: true }))
  const view = createMemo(() => viewShellRun(run()))
  const open = () => props.open ?? expanded()

  const outcome = createMemo(() => {
    const metadata = props.metadata

    if (metadata.interrupted === true || metadata.status === "killed")
      return { tone: "neutral" as const, label: i18n.t("ui.timeline.shell.stopped") }

    if (metadata.timeout === true || metadata.status === "timeout")
      return { tone: "danger" as const, label: i18n.t("ui.timeline.shell.timedOut") }

    if (typeof metadata.exit === "number" && metadata.exit !== 0)
      return { tone: "danger" as const, label: i18n.t("ui.timeline.shell.exit", { code: metadata.exit }) }
  })

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

  return (
    <div data-component="shell-tool">
      <Show
        when={view().command}
        fallback={
          <Show when={view().writingPlaceholder}>
            <span data-slot="shell-tool-writing">
              <TextShimmer text={i18n.t("ui.tool.shell.writingCommand")} active />
            </span>
          </Show>
        }
      >
        <ShellOutput
          command={view().command}
          output={view().output}
          expanded={open()}
          outcome={outcome()}
          onToggle={() => {
            const next = !open()

            setExpanded(next)
            props.onOpenChange?.(next)
          }}
        />
      </Show>
    </div>
  )
}

/** A command the user ran, shown as the agent's shell calls are. */
export function ShellMessage(props: {
  message: SessionMessageShell
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <div data-component="session-shell-message" data-timeline-part-id={props.message.id}>
      <ShellTool
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
        open={props.open}
        onOpenChange={props.onOpenChange}
      />
    </div>
  )
}

// Copy sits on the output only. The command's corner holds how the command ended, and the output's toggle once there is
// more than the cut shows.
function ShellOutput(props: {
  command?: string
  output: string
  expanded: boolean
  outcome?: { tone: "neutral" | "danger"; label: string }
  onToggle: () => void
}) {
  const i18n = useI18n()
  const [overflow, setOverflow] = createSignal(false)
  const toggleLabel = () => i18n.t(props.expanded ? "ui.common.showLess" : "ui.common.showMore")

  return (
    <div
      data-component="bash-output"
      data-variant="shell"
      data-clamp=""
      data-expanded={props.expanded ? "" : undefined}
      dir="ltr"
    >
      <div
        data-slot="bash-scroll"
        data-scrollable
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
      >
        <Show when={props.command}>
          {(command) => (
            <div data-slot="bash-command">
              <Show when={props.outcome || overflow() || props.expanded}>
                <div data-slot="bash-actions">
                  <Show when={props.outcome}>
                    {(outcome) => (
                      <span data-slot="bash-outcome" data-tone={outcome().tone}>
                        {outcome().label}
                      </span>
                    )}
                  </Show>
                  <Show when={overflow() || props.expanded}>
                    <div data-slot="bash-toggle">
                      <Tooltip value={toggleLabel()} placement="top">
                        <button
                          type="button"
                          data-slot="bash-toggle-button"
                          aria-label={toggleLabel()}
                          aria-expanded={props.expanded}
                          onClick={() => props.onToggle()}
                        >
                          <Icon name="chevron-grabber-vertical" size="small" />
                        </button>
                      </Tooltip>
                    </div>
                  </Show>
                </div>
              </Show>
              <pre data-slot="bash-pre">
                <code>{command()}</code>
              </pre>
            </div>
          )}
        </Show>
        <Show when={props.output}>
          {(output) => (
            <div data-slot="bash-result">
              <ConsoleCopy text={output()} label={i18n.t("ui.message.copyOutput")} />
              <ClampedContent expanded={props.expanded} tail onOverflowChange={setOverflow}>
                <pre data-slot="bash-pre">
                  <code>
                    <LinkedText text={output()} />
                  </code>
                </pre>
              </ClampedContent>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

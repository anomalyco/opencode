import { stripAnsi } from "./ansi"

/** A shell tool call as the renderer decoded it: tool state, input and metadata. */
type ShellTool = {
  readonly status: string | undefined
  readonly input: { readonly command?: string }
  readonly metadata: { readonly command?: string; readonly shellID?: string; readonly status?: string }
  readonly output: string | undefined
}

export type ShellRunProps = {
  readonly status: string | undefined
  readonly command: string
  readonly output: string
  readonly shellID: string | undefined
  /** The result carries the shell's final output, so the shell is never read again. */
  readonly saved: boolean
  /** The running-shell inventory lists the shell. It can arrive after the timeline renders. */
  readonly shellRunning: boolean
}

// `completed` is an agent shell that finished in the foreground; the others are direct user shells. A backgrounded agent
// shell reports `running` for good, so its output keeps coming from the shell.
const SAVED_STATUSES = new Set(["completed", "exited", "timeout", "killed"])

export function shellRunProps(tool: ShellTool, shellRunning: (id: string) => boolean): ShellRunProps {
  const shellID = tool.metadata.shellID

  return {
    status: tool.status,
    command: tool.input.command ?? tool.metadata.command ?? "",
    output: tool.output ?? "",
    shellID,
    saved: tool.metadata.status !== undefined && SAVED_STATUSES.has(tool.metadata.status),
    shellRunning: shellID !== undefined && shellRunning(shellID),
  }
}

type ShellRunShared = { readonly command: string; readonly output: string }

/** `streamed` is the latest output read from shell `shellID`; it is shown in place of the result's output. */
type ShellRunFollowed = ShellRunShared & { readonly shellID: string | undefined; readonly streamed: string }

/** A shell row: the model is writing the command, the shell runs (in the foreground or background), or it ended. */
export type ShellRunState =
  | (ShellRunShared & { readonly status: "writing" })
  | (ShellRunFollowed & { readonly status: "running" })
  | (ShellRunFollowed & { readonly status: "exited"; readonly saved: boolean })
  | (ShellRunFollowed & { readonly status: "error" })

export type ShellRunEvent =
  | { readonly type: "sync"; readonly props: ShellRunProps }
  | { readonly type: "output.received"; readonly shellID: string; readonly output: string }

export function createShellRunState(props: ShellRunProps): ShellRunState {
  return fromProps(props, "")
}

export function transitionShellRun(state: ShellRunState, event: ShellRunEvent): ShellRunState {
  if (event.type === "output.received") {
    if (state.status === "writing" || (state.status === "exited" && state.saved)) return state

    if (state.shellID !== event.shellID || state.streamed === event.output) return state

    return { ...state, streamed: event.output }
  }

  // Output read from one shell never shows for another.
  const streamed = state.status !== "writing" && state.shellID === event.props.shellID ? state.streamed : ""
  const next = fromProps(event.props, streamed)

  return sameShellRun(state, next) ? state : next
}

// The tool status `BasicTool` reads, so a background shell counts as pending there too.
const SHELL_BASIC_STATUS = {
  writing: "streaming",
  running: "running",
  exited: "completed",
  error: "error",
} as const satisfies Record<ShellRunState["status"], string>

export function viewShellRun(state: ShellRunState) {
  const followed = state.status === "writing" || (state.status === "exited" && state.saved) ? undefined : state
  const id = followed?.shellID

  return {
    pending: state.status === "writing" || state.status === "running",
    basicStatus: SHELL_BASIC_STATUS[state.status],
    command: state.command,
    writingPlaceholder: state.status === "writing" && !state.command,
    /** The shell to read output from, and whether to keep polling it. */
    follow: id === undefined ? undefined : { id, running: state.status === "running" },
    output: stripAnsi((id !== undefined && followed?.streamed) || state.output).replace(/\r\n?/g, "\n"),
  }
}

function fromProps(props: ShellRunProps, streamed: string): ShellRunState {
  if (props.status === "streaming") return { status: "writing", command: props.command, output: props.output }
  const shared = { command: props.command, output: props.output, shellID: props.shellID, streamed }

  if (props.status === "error") return { ...shared, status: "error" }

  if (!props.saved && (props.status === "running" || props.shellRunning)) return { ...shared, status: "running" }

  return { ...shared, status: "exited", saved: props.saved }
}

function sameShellRun(a: ShellRunState, b: ShellRunState) {
  if (a.status !== b.status || a.command !== b.command || a.output !== b.output) return false

  if (a.status === "writing" || b.status === "writing") return true

  if (a.status === "exited" && b.status === "exited" && a.saved !== b.saved) return false

  return a.shellID === b.shellID && a.streamed === b.streamed
}

/** A subagent call as the renderer decoded it. */
type SubagentTool = {
  readonly status: string | undefined
  readonly metadata: { readonly status?: string; readonly background?: boolean }
}

export type SubagentRunProps = {
  readonly status: string | undefined
  readonly background: boolean
  /** The child session is busy, which outlives the call when the subagent runs in the background. */
  readonly childBusy: boolean
}

export function subagentRunProps(tool: SubagentTool, childBusy: boolean): SubagentRunProps {
  return {
    status: tool.status,
    // A completed call whose result reports `running` handed the subagent off to the background.
    background:
      tool.metadata.background === true || (tool.status === "completed" && tool.metadata.status === "running"),
    childBusy,
  }
}

/** The model is writing the delegation, or the subagent runs, finished or failed. */
export type SubagentRunState =
  | { readonly status: "delegating" }
  | { readonly status: "running" | "completed" | "error"; readonly background: boolean }

export type SubagentRunEvent = { readonly type: "sync"; readonly props: SubagentRunProps }

export const INITIAL_SUBAGENT_RUN_STATE: SubagentRunState = Object.freeze({ status: "delegating" })

export function transitionSubagentRun(state: SubagentRunState, event: SubagentRunEvent): SubagentRunState {
  const props = event.props

  if (props.status === "streaming") return INITIAL_SUBAGENT_RUN_STATE

  const status =
    props.status === "running" || props.childBusy ? "running" : props.status === "error" ? "error" : "completed"

  if (state.status === status && state.background === props.background) return state

  return { status, background: props.background }
}

export function viewSubagentRun(state: SubagentRunState) {
  return {
    delegating: state.status === "delegating",
    running: state.status === "delegating" || state.status === "running",
    basicStatus: state.status === "delegating" ? "streaming" : state.status,
    background: state.status !== "delegating" && state.background,
  }
}

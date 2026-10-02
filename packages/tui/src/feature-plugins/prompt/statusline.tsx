import { Plugin } from "@opencode/plugin/tui"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import stripAnsi from "strip-ansi"
import { useConfig } from "../../config"
import { lastAssistantWithUsage } from "../../util/session"

const DEBOUNCE_MS = 300
const TIMEOUT_MS = 5_000

// Field names follow Claude Code's statusLine payload so existing scripts work unchanged.
export function statuslineInput(context: Plugin.Context, sessionID?: string) {
  const session = sessionID ? context.data.session.get(sessionID) : undefined
  const location = session?.location ?? context.location
  const selected = context.ui.model.current()
  const ref = selected ? { providerID: selected.providerID, id: selected.modelID } : session?.model
  const model = ref
    ? context.data.location.model
        .list(location)
        ?.find((item) => item.providerID === ref.providerID && item.id === ref.id)
    : undefined
  // A new session has an ID before it exists.
  const usage = session
    ? lastAssistantWithUsage(context.data.session.message.list(session.id), session.revert?.messageID)?.tokens
    : undefined
  const used = usage ? usage.input + usage.output + usage.reasoning + usage.cache.read + usage.cache.write : 0
  const size = model?.limit?.context
  const percent = size && used > 0 ? Math.round((used / size) * 100) : undefined
  return {
    hook_event_name: "Status",
    session_id: sessionID,
    cwd: location?.directory,
    version: context.app.version,
    model: ref ? { id: `${ref.providerID}/${ref.id}`, display_name: model?.name ?? ref.id } : undefined,
    workspace: {
      current_dir: location?.directory,
      project_dir: session ? context.data.project.get(session.projectID)?.canonical : undefined,
    },
    cost: { total_cost_usd: session ? context.data.session.cost(session.id) : 0 },
    context_window: {
      context_window_size: size,
      used_percentage: percent,
      remaining_percentage: percent === undefined ? undefined : 100 - percent,
      current_usage: usage
        ? {
            input_tokens: usage.input,
            output_tokens: usage.output + usage.reasoning,
            cache_creation_input_tokens: usage.cache.write,
            cache_read_input_tokens: usage.cache.read,
          }
        : undefined,
    },
  }
}

// Resolves with the first line of stdout, or undefined when the command could not run or was aborted.
export function runStatusline(input: { command: string; stdin: string; cwd?: string; signal: AbortSignal }) {
  return new Promise<string | undefined>((resolve) => {
    const child = spawn(input.command, {
      shell: true,
      cwd: input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd(),
      signal: input.signal,
      timeout: TIMEOUT_MS,
      stdio: ["pipe", "pipe", "ignore"],
    })
    const chunks: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.on("error", () => resolve(undefined))
    child.on("close", () =>
      resolve(stripAnsi(Buffer.concat(chunks).toString("utf8")).split(/\r?\n/, 1)[0]?.trim() ?? ""),
    )
    // A script that never reads stdin closes the pipe early.
    child.stdin.on("error", () => {})
    child.stdin.end(input.stdin)
  })
}

export function Statusline(props: { context: Plugin.Context; sessionID?: string }) {
  const config = useConfig().data
  const [text, setText] = createSignal("")
  const [tick, setTick] = createSignal(0)
  // Memoized as a string so streaming updates that leave the payload unchanged do not rerun the command.
  const stdin = createMemo(() => JSON.stringify(statuslineInput(props.context, props.sessionID)))

  createEffect(() => {
    const seconds = config.statusline?.interval
    if (!seconds) return
    const timer = setInterval(() => setTick((value) => value + 1), seconds * 1000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const command = config.statusline?.command
    if (!command) return setText("")
    tick()
    const abort = new AbortController()
    const run = {
      command,
      stdin: stdin(),
      cwd: (props.sessionID ? props.context.data.session.get(props.sessionID)?.location : props.context.location)
        ?.directory,
      signal: abort.signal,
    }
    const timer = setTimeout(
      () =>
        void runStatusline(run).then((value) => {
          if (value !== undefined && !abort.signal.aborted) setText(value)
        }),
      DEBOUNCE_MS,
    )
    onCleanup(() => {
      clearTimeout(timer)
      abort.abort()
    })
  })

  return (
    <Show when={text()}>
      <text fg={props.context.theme.text.muted} wrapMode="none" truncate flexShrink={1}>
        {text()}
      </text>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.prompt.statusline",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => <Statusline context={context} sessionID={props.sessionID} />,
    })
  },
})

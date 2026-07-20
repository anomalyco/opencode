import type {
  EventSubscribeOutput,
  FormInfo,
  LocationRef,
  OpenCodeClient,
  PermissionV2Request,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode-ai/client/promise"
import { Event } from "@opencode-ai/schema/event"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { blockerStatus, pickBlockerView } from "./session-data"
import { writeSessionOutput } from "./stream"
import { createFragmentReconciler, fragmentRef, type FragmentReconciler } from "./stream-v2.fragment"
import { createSubagentTracker, toolCommit, toolFinalPhase } from "./stream-v2.subagent"
import { normalizeTool, toolOutputText } from "./tool"
import type {
  FooterApi,
  FooterView,
  LocalReplayRow,
  MiniPermissionRequest,
  MiniFormRequest,
  RunFilePart,
  RunInput,
  RunPrompt,
  RunPromptPart,
  StreamCommit,
} from "./types"

type Trace = {
  write(type: string, data?: unknown): void
}

type StreamInput = {
  sdk: OpenCodeClient
  reconnect?: (signal: AbortSignal) => Promise<OpenCodeClient>
  onClient?: (sdk: OpenCodeClient) => void
  readTextFile?: (url: string) => Promise<string>
  location?: LocationRef
  sessionID: string
  thinking: boolean
  replay?: boolean
  replayLimit?: number
  footer: FooterApi
  onCommit?: (commit: StreamCommit) => void
  trace?: Trace
  signal?: AbortSignal
  onCatalogRefresh?: (signal?: AbortSignal) => unknown | Promise<unknown>
}

export type SessionTurnInput = {
  agent: string | undefined
  model: RunInput["model"]
  variant: string | undefined
  prompt: RunPrompt
  files: RunFilePart[]
  includeFiles: boolean
  signal?: AbortSignal
}

export type SessionResizeReplayInput = {
  localRows: () => LocalReplayRow[]
  reset: () => Promise<void>
}

export type SessionTransport = {
  runPromptTurn(input: SessionTurnInput): Promise<void>
  interruptActiveTurn(): Promise<void>
  selectSubagent(sessionID: string | undefined): void
  replayOnResize(input: SessionResizeReplayInput): Promise<boolean>
  close(): Promise<void>
  settleForm?(sessionID: string, formID: string): void
}

type Wait = {
  messageID: string
  promoted: boolean
  interrupted: boolean
  failureRendered: boolean
  resolve: () => void
  reject: (error: unknown) => void
}

// One active session.shell call. The HTTP response is the completion signal;
// callID correlates the live shell events once shell.started is observed, and
// abort cancels the blocking request when the user interrupts the turn.
type ShellWait = {
  eventID: string
  messageID: string
  callID?: string
  resolve: () => void
  abort: () => void
}

type RunV2Event = EventSubscribeOutput
type PromptFilePart = Extract<RunPromptPart, { type: "file" }>

type Attempt = {
  client: OpenCodeClient
  signal: AbortSignal
  generation: number
}

type ReplayBuffer = {
  attempt: Attempt
  events: RunV2Event[]
}

type ToolState = {
  part: SessionMessageAssistantTool
  output: string
  version: number
}

type State = {
  permissions: MiniPermissionRequest[]
  forms: MiniFormRequest[]
  globalForms: MiniFormRequest[]
  view: FooterView
  messageIDs: Set<string>
  fragments: FragmentReconciler
  tools: Map<string, ToolState>
  toolSources: Map<string, SessionMessageAssistantTool>
  finishedTools: Set<string>
  skillMessages: Set<string>
  shellCommands: Map<string, string>
  shellStarted: Set<string>
  shellEnded: Set<string>
  shellWait?: ShellWait
  wait?: Wait
  connected: boolean
  closed: boolean
  initial: boolean
  rootActive: boolean
  buffered?: ReplayBuffer
  errors: Set<string>
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function formatUnknownError(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message || error.name
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message")
    if (typeof message === "string" && message.trim()) return message
    const tag = Reflect.get(error, "_tag")
    if (typeof tag === "string" && tag.trim()) return tag
  }
  return "unknown error"
}

function sessionID(event: RunV2Event) {
  if (event.type === "form.created") return event.data.form.sessionID
  return "sessionID" in event.data && typeof event.data.sessionID === "string" ? event.data.sessionID : undefined
}

function sameLocation(left: LocationRef | undefined, right: LocationRef | undefined) {
  return !!left && !!right && left.directory === right.directory && left.workspaceID === right.workspaceID
}

function globalForm(form: FormInfo, location: LocationRef): MiniFormRequest {
  return { ...form, location: { directory: location.directory, workspaceID: location.workspaceID } }
}

function errorMessage(error: { message?: string; _tag?: string }) {
  return error.message || error._tag || "Session execution failed"
}

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, delay)
    signal.addEventListener("abort", done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })
}

function nextEvent(stream: AsyncIterator<RunV2Event>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Event stream aborted"))
  return new Promise<IteratorResult<RunV2Event>>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(signal.reason ?? new Error("Event stream aborted"))
    }
    signal.addEventListener("abort", abort, { once: true })
    void stream.next().then(
      (next) => {
        signal.removeEventListener("abort", abort)
        resolve(next)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

async function prepareInitialFile(file: RunFilePart, readTextFile?: StreamInput["readTextFile"]) {
  if (file.mime !== "text/plain") return { type: "file" as const, file: { uri: file.url, name: file.filename } }
  const content = file.url.startsWith("data:")
    ? Buffer.from(file.url.slice(file.url.indexOf(",") + 1), "base64").toString("utf8")
    : await (readTextFile?.(file.url) ?? Promise.reject(new Error("Local text file acquisition is unavailable")))
  return { type: "text" as const, text: `<file name="${file.filename}">\n${content}\n</file>` }
}

function promptFileMention(part: PromptFilePart) {
  if (!part.source?.text) return
  return {
    start: part.source.text.start,
    end: part.source.text.end,
    text: part.source.text.value,
  }
}

function promptFiles(next: SessionTurnInput) {
  return next.prompt.parts.flatMap((part) =>
    part.type === "file"
      ? [
          {
            uri: part.url,
            name: part.filename,
            mention: promptFileMention(part),
          },
        ]
      : [],
  )
}

async function prepareAttachments(
  next: SessionTurnInput,
  mode: "command" | "prompt",
  readTextFile?: StreamInput["readTextFile"],
) {
  const initial = next.includeFiles ? next.files : []
  if (mode === "command") {
    return {
      text: [],
      files: [...initial.map((file) => ({ uri: file.url, name: file.filename })), ...promptFiles(next)],
    }
  }
  const prepared = await Promise.all(initial.map((file) => prepareInitialFile(file, readTextFile)))
  return {
    text: prepared.flatMap((file) => (file.type === "text" ? [file.text] : [])),
    files: [...prepared.flatMap((file) => (file.type === "file" ? [file.file] : [])), ...promptFiles(next)],
  }
}

function promptAgents(next: SessionTurnInput) {
  return next.prompt.parts.flatMap((part) =>
    part.type === "agent"
      ? [
          {
            name: part.name,
            mention: part.source
              ? { start: part.source.start, end: part.source.end, text: part.source.value }
              : undefined,
          },
        ]
      : [],
  )
}

function streamPartKey(messageID: string, partID: string) {
  return `${messageID}\u0000${partID}`
}

function permissionSourceKey(messageID: string, callID: string) {
  return streamPartKey(messageID, callID)
}

function permissionTool(request: PermissionV2Request, tools: Map<string, SessionMessageAssistantTool>) {
  if (request.source?.type !== "tool") return request
  const tool = tools.get(permissionSourceKey(request.source.messageID, request.source.callID))
  return tool ? { ...request, tool } : request
}

// Direct shell calls use one "start" commit rendering `$ command` and one "progress"
// commit rendering the merged output (see toolEntryBody in tool.ts).
function shellCommit(
  callID: string,
  command: string,
  next: Pick<StreamCommit, "text" | "phase" | "toolState" | "toolError">,
): StreamCommit {
  return {
    kind: "tool",
    source: "tool",
    partID: `shell:${callID}`,
    tool: "shell",
    shell: { command },
    ...next,
  }
}

function shellTerminal(
  callID: string,
  command: string,
  shell: { status: string; exit?: number | string },
  output: { output: string; cursor: number; size: number; truncated: boolean },
) {
  const incomplete = output.truncated || output.cursor < output.size
  const text = `${output.output}${incomplete ? `${output.output.endsWith("\n") || !output.output ? "" : "\n"}[output truncated]` : ""}`
  const error =
    shell.status === "exited" && shell.exit === 0
      ? undefined
      : shell.status === "exited"
        ? `Shell exited with code ${shell.exit ?? "unknown"}`
        : `Shell ${shell.status}`
  if (!error) return [shellCommit(callID, command, { text, phase: "progress", toolState: "completed" })]
  return [
    ...(text ? [shellCommit(callID, command, { text, phase: "progress", toolState: "running" })] : []),
    shellCommit(callID, command, { text: error, phase: "final", toolState: "error", toolError: error }),
  ]
}

function messageIDFromEvent(id: string) {
  return SessionMessage.ID.fromEvent(Event.ID.make(id))
}

const catalogEvents = new Set([
  "catalog.updated",
  "integration.updated",
  "agent.updated",
  "command.updated",
  "skill.updated",
  "reference.updated",
])

// session.shell resolves after the command settled server-side; the matching
// live shell.ended event usually lands within the same tick, but hold the turn
// briefly so the output commit renders inside it.
const SHELL_OUTPUT_GRACE_MS = 1500

function skillCommit(messageID: string, name: string): StreamCommit {
  return {
    kind: "system",
    source: "system",
    messageID,
    partID: `skill:${messageID}`,
    text: `→ Skill "${name}"`,
    phase: "start",
  }
}

async function resolveSelectedModel(
  input: StreamInput,
  sdk: OpenCodeClient,
  next: Pick<SessionTurnInput, "model" | "variant" | "signal">,
) {
  if (next.model) return { providerID: next.model.providerID, id: next.model.modelID, variant: next.variant }
  if (!next.variant) return

  const session = await sdk.session
    .get({ sessionID: input.sessionID }, { signal: next.signal })
    .then((response) => response.model)
  if (session) return { ...session, variant: next.variant }

  const fallback = await sdk.model.default(undefined, { signal: next.signal }).then((response) => response.data)
  if (!fallback) return
  return { providerID: fallback.providerID, id: fallback.id, variant: next.variant }
}

export async function createSessionTransport(input: StreamInput): Promise<SessionTransport> {
  const controller = new AbortController()
  let sdk = input.sdk
  let generation = 0
  let activeAttempt: Attempt | undefined
  input.signal?.addEventListener("abort", () => controller.abort(), { once: true })
  const state: State = {
    permissions: [],
    forms: [],
    globalForms: [],
    view: { type: "prompt" },
    messageIDs: new Set(),
    fragments: createFragmentReconciler(),
    tools: new Map(),
    toolSources: new Map(),
    finishedTools: new Set(),
    skillMessages: new Set(),
    shellCommands: new Map(),
    shellStarted: new Set(),
    shellEnded: new Set(),
    connected: false,
    closed: false,
    initial: true,
    rootActive: false,
    errors: new Set(),
  }
  let readyResolve!: () => void
  let readyReject!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const abortReady = () => readyReject(new Error("Mini closed before the event stream connected"))
  controller.signal.addEventListener("abort", abortReady, { once: true })
  const offFooterClose = input.footer.onClose(() => controller.abort())
  const current = (attempt: Attempt) =>
    !state.closed &&
    !controller.signal.aborted &&
    !attempt.signal.aborted &&
    attempt.generation === generation &&
    attempt.client === sdk

  const subagents = createSubagentTracker({
    sessionID: input.sessionID,
    thinking: input.thinking,
    directory: input.location?.directory,
    signal: controller.signal,
    emit: () => {
      if (state.closed || input.footer.isClosed) return
      const snapshot = subagents.snapshot()
      writeSessionOutput(
        { footer: input.footer, trace: input.trace },
        { commits: [], updates: [{ type: "stream.subagent", state: snapshot }] },
      )
      syncBlockers()
    },
  })
  controller.signal.addEventListener("abort", () => subagents.close(), { once: true })

  const write = (commits: StreamCommit[], patch?: { phase?: "idle" | "running"; status?: string; usage?: string }) => {
    if (state.closed || controller.signal.aborted || input.footer.isClosed) return
    if (!state.initial && state.buffered === undefined)
      commits.forEach((commit) => {
        if (!commit.messageID || !commit.partID || (commit.kind !== "assistant" && commit.kind !== "reasoning")) {
          input.onCommit?.(commit)
          return
        }
        const text = state.fragments.value({ messageID: commit.messageID, partID: commit.partID })
        input.onCommit?.({
          ...commit,
          text: commit.kind === "reasoning" && text ? `Thinking: ${text}` : (text ?? commit.text),
        })
      })
    writeSessionOutput(
      { footer: input.footer, trace: input.trace },
      { commits, updates: patch ? [{ type: "stream.patch", patch }] : undefined },
    )
  }

  const syncBlockers = () => {
    if (state.closed || controller.signal.aborted || input.footer.isClosed) return
    const descendant = subagents.snapshot()
    const next = pickBlockerView({
      permission: state.permissions[0] ?? descendant.permissions[0],
      form: state.forms[0] ?? descendant.forms[0] ?? state.globalForms[0],
    })
    if (next.type === "prompt" && state.view.type === "prompt") return
    if (next.type !== "prompt" && state.view.type === next.type && next.request.id === state.view.request.id) return
    state.view = next
    writeSessionOutput(
      { footer: input.footer, trace: input.trace },
      {
        commits: [],
        updates: [
          {
            type: "stream.patch",
            patch:
              next.type === "prompt"
                ? { phase: state.rootActive ? "running" : "idle", status: blockerStatus(next) }
                : { status: blockerStatus(next) },
          },
          { type: "stream.view", view: next },
        ],
      },
    )
  }

  const sourcePending = (key: string) =>
    state.permissions.some(
      (request) =>
        request.source?.type === "tool" && permissionSourceKey(request.source.messageID, request.source.callID) === key,
    )

  const pruneToolSources = () => {
    for (const key of state.toolSources.keys()) {
      if (!state.tools.has(key) && !sourcePending(key)) state.toolSources.delete(key)
    }
  }

  const renderTool = (messageID: string, item: SessionMessageAssistantTool, render = true) => {
    const part = normalizeTool(item)
    const key = permissionSourceKey(messageID, part.id)
    if (state.finishedTools.has(key)) {
      if (sourcePending(key)) state.toolSources.set(key, part)
      else state.toolSources.delete(key)
      return
    }
    state.toolSources.set(key, part)
    if (part.state.status === "streaming") {
      state.tools.set(key, { part, output: "", version: 0 })
      return
    }
    const current = state.tools.get(key)
    const output = toolOutputText(part.name, part.state.content)
    const prefix = current ? output.startsWith(current.output) : false
    const version = current && !prefix ? current.version + 1 : (current?.version ?? 0)
    const delta = current && prefix ? output.slice(current.output.length) : output
    if (part.state.status === "running") {
      if (render && (!current || current.part.state.status === "streaming"))
        write([toolCommit(part, messageID, "start", undefined, input.location?.directory, version)], {
          phase: "running",
          status: `running ${part.name}`,
        })
      if (render && delta) write([toolCommit(part, messageID, "progress", delta, input.location?.directory, version)])
      state.tools.set(key, { part, output, version })
      return
    }
    if (render && (!current || current.part.state.status === "streaming"))
      write([toolCommit(part, messageID, "start", undefined, input.location?.directory, version)])
    state.finishedTools.add(key)
    state.tools.delete(key)
    if (!sourcePending(key)) state.toolSources.delete(key)
    if (!render) return
    const phase = toolFinalPhase(part)
    if (part.state.status === "error" && delta)
      write([toolCommit(part, messageID, "progress", delta, input.location?.directory, version)])
    write([
      toolCommit(part, messageID, phase, phase === "progress" ? delta : undefined, input.location?.directory, version),
    ])
  }

  const renderMessage = (message: SessionMessageInfo, render: boolean, reuseVisibleWait: boolean) => {
    if (message.type === "user") {
      const waiting = state.wait?.messageID === message.id
      if (waiting && state.wait) state.wait.promoted = true
      if (!render || state.messageIDs.has(message.id)) return
      state.messageIDs.add(message.id)
      if (reuseVisibleWait && waiting) return
      write([{ kind: "user", source: "system", text: message.text, phase: "start", messageID: message.id }])
      return
    }
    if (message.type === "skill") {
      if (state.wait?.messageID === message.id) state.wait.promoted = true
      if (!render || state.skillMessages.has(message.id)) {
        state.skillMessages.add(message.id)
        return
      }
      state.skillMessages.add(message.id)
      write([skillCommit(message.id, message.name)])
      return
    }
    if (message.type === "shell") {
      state.shellCommands.set(message.shellID, message.command)
      if (state.shellWait?.messageID === message.id) state.shellWait.callID = message.shellID
      const completed = message.time.completed !== undefined
      if (!render) {
        // Suppressed history: mark settled shells rendered so live redelivery
        // stays silent. A still-running shell stays unmarked and renders in
        // full when its live shell.ended event arrives.
        if (completed) {
          state.shellStarted.add(message.shellID)
          state.shellEnded.add(message.shellID)
        }
        return
      }
      if (!state.shellStarted.has(message.shellID)) {
        state.shellStarted.add(message.shellID)
        write([
          shellCommit(message.shellID, message.command, {
            text: "running shell",
            phase: "start",
            toolState: "running",
          }),
        ])
      }
      if (completed && message.output && !state.shellEnded.has(message.shellID)) {
        state.shellEnded.add(message.shellID)
        write(shellTerminal(message.shellID, message.command, message, message.output))
      }
      if (completed && state.shellWait?.callID === message.shellID) state.shellWait.resolve()
      return
    }
    if (message.type !== "assistant") return
    state.messageIDs.add(message.id)
    let textOrdinal = 0
    let reasoningOrdinal = 0
    for (const item of message.content) {
      if (item.type === "text") {
        const fragment = fragmentRef(message.id, "text", textOrdinal++)
        const update = state.fragments.project(fragment, item.text, render)
        if (render && item.text.length > update.previous.length)
          write([
            {
              kind: "assistant",
              source: "assistant",
              text: item.text.slice(update.previous.length),
              phase: "progress",
              messageID: message.id,
              partID: fragment.partID,
            },
          ])
        continue
      }
      if (item.type === "reasoning") {
        const fragment = fragmentRef(message.id, "reasoning", reasoningOrdinal++)
        const update = state.fragments.project(fragment, item.text, render)
        if (render && input.thinking && item.text.length > update.previous.length)
          write([
            {
              kind: "reasoning",
              source: "reasoning",
              text:
                update.previous.length === 0 ? `Thinking: ${item.text}` : item.text.slice(update.previous.length),
              phase: "progress",
              messageID: message.id,
              partID: fragment.partID,
            },
          ])
        continue
      }
      renderTool(message.id, item, render)
    }
    if (render && message.error && !state.errors.has(message.id)) {
      state.errors.add(message.id)
      write([
        {
          kind: "error",
          source: "system",
          text: errorMessage(message.error),
          phase: "start",
          messageID: message.id,
        },
      ])
    }
  }

  const resolvePermissionSources = async (
    client: OpenCodeClient,
    permissions: PermissionV2Request[],
    attempt: Attempt,
  ) => {
    const pending = new Set(
      permissions.flatMap((request) =>
        request.source?.type === "tool" ? [permissionSourceKey(request.source.messageID, request.source.callID)] : [],
      ),
    )
    const messageIDs = [
      ...new Set(
        permissions.flatMap((request) => {
          if (request.source?.type !== "tool") return []
          const key = permissionSourceKey(request.source.messageID, request.source.callID)
          return state.toolSources.has(key) ? [] : [request.source.messageID]
        }),
      ),
    ]
    const messages = await Promise.allSettled(
      messageIDs.map((messageID) =>
        client.session.message({ sessionID: input.sessionID, messageID }, { signal: attempt.signal }),
      ),
    )
    if (!current(attempt)) return permissions
    for (const result of messages) {
      if (result.status !== "fulfilled" || result.value.type !== "assistant") continue
      for (const item of result.value.content) {
        if (item.type !== "tool") continue
        const key = permissionSourceKey(result.value.id, item.id)
        if (pending.has(key)) state.toolSources.set(key, normalizeTool(item))
      }
    }
    return permissions.map((request) => permissionTool(request, state.toolSources))
  }

  const hydrate = async (
    attempt: Attempt,
    next: { render: boolean; reuseVisibleWait: boolean; reconnect?: boolean },
  ) => {
    const client = attempt.client
    const options = { signal: attempt.signal }
    const [messages, permissions, forms, globals, active] = await Promise.all([
      client.message.list({ sessionID: input.sessionID, limit: input.replayLimit ?? 200, order: "desc" }, options),
      client.permission.list({ sessionID: input.sessionID }, options),
      client.form.list({ sessionID: input.sessionID }, options),
      input.location
        ? client.form.request.list(
            {
              location: { directory: input.location.directory, workspace: input.location.workspaceID },
            },
            options,
          )
        : Promise.resolve(undefined),
      client.session.active(options),
    ])
    if (!current(attempt)) return
    const projected = structuredClone(messages.data).toReversed() as SessionMessageInfo[]
    state.permissions = permissions
    pruneToolSources()
    for (const message of projected) renderMessage(message, next.render, next.reuseVisibleWait)
    state.permissions = await resolvePermissionSources(client, permissions, attempt)
    if (!current(attempt)) return
    pruneToolSources()
    state.forms = forms
    state.globalForms = globals
      ? globals.data.filter((form) => form.sessionID === "global").map((form) => globalForm(form, globals.location))
      : []
    state.rootActive = input.sessionID in active
    syncBlockers()
    await subagents.hydrate({
      sdk: client,
      messages: [...projected],
      active,
      signal: attempt.signal,
      reconnect: next.reconnect,
    })
    if (!current(attempt)) return
    write([], {
      phase: state.rootActive ? "running" : "idle",
      status: state.rootActive ? "assistant responding" : blockerStatus(state.view),
    })
    if (!state.rootActive) await input.footer.idle()
    if (!current(attempt)) return
    if (!state.rootActive && state.wait && (state.wait.promoted || state.wait.interrupted)) {
      const current = state.wait
      state.wait = undefined
      current.resolve()
    }
  }

  const apply = (attempt: Attempt, event: RunV2Event) => {
    if (!current(attempt)) return
    const client = attempt.client
    if (catalogEvents.has(event.type)) {
      if (
        input.location &&
        event.location &&
        (event.location.directory !== input.location.directory ||
          event.location.workspaceID !== input.location.workspaceID)
      )
        return
      void refreshCatalog(attempt)
      return
    }
    const source = sessionID(event)
    if (
      source === "global" &&
      (event.type === "form.created" || event.type === "form.replied" || event.type === "form.cancelled")
    ) {
      if (!sameLocation(event.location, input.location)) return
      if (event.type === "form.created") {
        if (!state.globalForms.some((item) => item.id === event.data.form.id))
          state.globalForms.push(globalForm(event.data.form, event.location!))
      } else {
        state.globalForms = state.globalForms.filter((item) => item.id !== event.data.id)
      }
      syncBlockers()
      return
    }
    if (source !== input.sessionID) {
      if (source) subagents.foreign(client, source, event, attempt.signal)
      return
    }
    input.trace?.write("recv.event", event)
    subagents.main(client, event, attempt.signal)
    if (event.type === "session.input.promoted") {
      if (state.wait?.messageID === event.data.inputID) state.wait.promoted = true
      state.messageIDs.add(event.data.inputID)
      write([], { phase: "running", status: "waiting for assistant" })
      return
    }
    if (event.type === "session.step.started") {
      write([], { phase: "running", status: "assistant responding" })
      return
    }
    if (event.type === "session.skill.activated") {
      const messageID = messageIDFromEvent(event.id)
      if (state.wait?.messageID === messageID) state.wait.promoted = true
      if (state.skillMessages.has(messageID)) return
      state.skillMessages.add(messageID)
      write([skillCommit(messageID, event.data.name)])
      return
    }
    if (event.type === "session.shell.started") {
      state.shellCommands.set(event.data.shell.id, event.data.shell.command)
      const wait = state.shellWait
      if (wait?.eventID === event.id) wait.callID = event.data.shell.id
      if (state.shellStarted.has(event.data.shell.id)) return
      state.shellStarted.add(event.data.shell.id)
      write(
        [
          shellCommit(event.data.shell.id, event.data.shell.command, {
            text: "running shell",
            phase: "start",
            toolState: "running",
          }),
        ],
        {
          phase: "running",
          status: "running shell",
        },
      )
      return
    }
    if (event.type === "session.shell.ended") {
      const command = state.shellCommands.get(event.data.shell.id) ?? event.data.shell.command
      const commits: StreamCommit[] = []
      if (!state.shellStarted.has(event.data.shell.id)) {
        state.shellStarted.add(event.data.shell.id)
        if (command)
          commits.push(
            shellCommit(event.data.shell.id, command, { text: "running shell", phase: "start", toolState: "running" }),
          )
      }
      if (!state.shellEnded.has(event.data.shell.id)) {
        state.shellEnded.add(event.data.shell.id)
        commits.push(...shellTerminal(event.data.shell.id, command, event.data.shell, event.data.output))
      }
      const wait = state.shellWait
      const owned = wait?.callID === event.data.shell.id
      write(commits, owned || state.wait || state.shellWait ? undefined : { phase: "idle", status: "" })
      if (owned) wait.resolve()
      return
    }
    if (event.type === "session.text.started") {
      return
    }
    if (event.type === "session.text.delta") {
      const fragment = fragmentRef(event.data.assistantMessageID, "text", event.data.ordinal)
      if (!state.fragments.delta(fragment, event.data.delta)) return
      write([
        {
          kind: "assistant",
          source: "assistant",
          text: event.data.delta,
          phase: "progress",
          messageID: event.data.assistantMessageID,
          partID: fragment.partID,
        },
      ])
      return
    }
    if (event.type === "session.text.ended") {
      const update = state.fragments.end(
        fragmentRef(event.data.assistantMessageID, "text", event.data.ordinal),
        event.data.text,
      )
      if (event.data.text.length > update.previous.length)
        write([
          {
            kind: "assistant",
            source: "assistant",
            text: event.data.text.slice(update.previous.length),
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: update.partID,
          },
        ])
      return
    }
    if (event.type === "session.reasoning.started") {
      return
    }
    if (event.type === "session.reasoning.delta") {
      const update = state.fragments.delta(
        fragmentRef(event.data.assistantMessageID, "reasoning", event.data.ordinal),
        event.data.delta,
      )
      if (!update) return
      if (input.thinking)
        write([
          {
            kind: "reasoning",
            source: "reasoning",
            text: update.previous ? event.data.delta : `Thinking: ${event.data.delta}`,
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: update.partID,
          },
        ])
      return
    }
    if (event.type === "session.reasoning.ended") {
      const update = state.fragments.end(
        fragmentRef(event.data.assistantMessageID, "reasoning", event.data.ordinal),
        event.data.text,
      )
      if (input.thinking && event.data.text.length > update.previous.length)
        write([
          {
            kind: "reasoning",
            source: "reasoning",
            text: update.previous ? event.data.text.slice(update.previous.length) : `Thinking: ${event.data.text}`,
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: update.partID,
          },
        ])
      return
    }
    if (event.type === "session.tool.input.started") {
      renderTool(event.data.assistantMessageID, {
        type: "tool",
        id: event.data.callID,
        name: event.data.name,
        state: { status: "streaming", input: "" },
        time: { created: event.created },
      })
      return
    }
    if (event.type === "session.tool.input.delta" || event.type === "session.tool.input.ended") {
      const current = state.tools.get(streamPartKey(event.data.assistantMessageID, event.data.callID))
      if (!current || current.part.state.status !== "streaming") return
      renderTool(event.data.assistantMessageID, {
        ...current.part,
        state: {
          status: "streaming",
          input:
            event.type === "session.tool.input.ended" ? event.data.text : current.part.state.input + event.data.delta,
        },
      })
      return
    }
    if (event.type === "session.tool.called") {
      const key = streamPartKey(event.data.assistantMessageID, event.data.callID)
      if (state.finishedTools.has(key)) return
      const current = state.tools.get(key)
      const item: SessionMessageAssistantTool = {
        type: "tool",
        id: event.data.callID,
        name: current?.part.name ?? "tool",
        executed: event.data.executed,
        providerState: event.data.state,
        state: { status: "running", input: event.data.input, structured: {}, content: [] },
        time: { created: current?.part.time.created ?? event.created, ran: event.created },
      }
      renderTool(event.data.assistantMessageID, item)
      return
    }
    if (event.type === "session.tool.progress") {
      const key = streamPartKey(event.data.assistantMessageID, event.data.callID)
      if (state.finishedTools.has(key)) return
      const current = state.tools.get(key)
      const part = current?.part
      renderTool(event.data.assistantMessageID, {
        type: "tool",
        id: event.data.callID,
        name: part?.name ?? "tool",
        executed: part?.executed,
        providerState: part?.providerState,
        state: {
          status: "running",
          input: part && part.state.status !== "streaming" ? part.state.input : {},
          structured: event.data.structured,
          content: event.data.content,
        },
        time: { created: part?.time.created ?? event.created, ran: part?.time.ran ?? event.created },
      })
      return
    }
    if (event.type === "session.tool.success" || event.type === "session.tool.failed") {
      const current = state.tools.get(streamPartKey(event.data.assistantMessageID, event.data.callID))
      const part = current?.part
      const failed = event.type === "session.tool.failed"
      const item: SessionMessageAssistantTool = {
        type: "tool",
        id: event.data.callID,
        name: part?.name ?? "tool",
        executed: event.data.executed,
        providerState: part?.providerState,
        providerResultState: event.data.resultState,
        state: failed
          ? {
              status: "error",
              input: part && part.state.status !== "streaming" ? part.state.input : {},
              structured: part && part.state.status !== "streaming" ? part.state.structured : {},
              content: part && part.state.status !== "streaming" ? part.state.content : [],
              error: event.data.error,
              result: event.data.result,
            }
          : {
              status: "completed",
              input: part && part.state.status !== "streaming" ? part.state.input : {},
              structured: event.data.structured,
              content: event.data.content,
              result: event.data.result,
            },
        time: { created: part?.time.created ?? event.created, ran: part?.time.ran, completed: event.created },
      }
      renderTool(event.data.assistantMessageID, item)
      return
    }
    if (event.type === "permission.v2.asked") {
      if (!state.permissions.some((item) => item.id === event.data.id))
        state.permissions.push(permissionTool(event.data, state.toolSources))
      syncBlockers()
      return
    }
    if (event.type === "permission.v2.replied") {
      state.permissions = state.permissions.filter((item) => item.id !== event.data.requestID)
      pruneToolSources()
      syncBlockers()
      return
    }
    if (event.type === "form.created") {
      if (!state.forms.some((item) => item.id === event.data.form.id)) state.forms.push(event.data.form)
      syncBlockers()
      return
    }
    if (event.type === "form.replied" || event.type === "form.cancelled") {
      state.forms = state.forms.filter((item) => item.id !== event.data.id)
      syncBlockers()
      return
    }
    if (event.type === "session.step.ended") {
      const total =
        event.data.tokens.input +
        event.data.tokens.output +
        event.data.tokens.reasoning +
        event.data.tokens.cache.read +
        event.data.tokens.cache.write
      const usage = total > 0 ? total.toLocaleString() : ""
      write([], {
        usage: event.data.cost ? `${usage} · ${money.format(event.data.cost)}` : usage,
      })
      return
    }
    if (event.type === "session.step.failed") {
      const rendered = state.errors.has(event.data.assistantMessageID)
      state.errors.add(event.data.assistantMessageID)
      if (state.wait) state.wait.failureRendered = true
      if (rendered) return
      write([
        {
          kind: "error",
          source: "system",
          text: errorMessage(event.data.error),
          phase: "start",
          messageID: event.data.assistantMessageID,
        },
      ])
      return
    }
    if (event.type === "session.execution.started") {
      state.rootActive = true
      write([], { phase: "running" })
      return
    }
    if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    ) {
      state.rootActive = false
      write([], { phase: "idle", status: "" })
      const current = state.wait
      if (!current || (!current.promoted && !current.interrupted)) return
      state.wait = undefined
      if (current.interrupted && event.type === "session.execution.interrupted" && event.data.reason === "user") {
        current.resolve()
        return
      }
      if (event.type === "session.execution.failed") {
        if (current.failureRendered) {
          current.resolve()
          return
        }
        current.reject(new Error(errorMessage(event.data.error)))
        return
      }
      if (event.type === "session.execution.interrupted") {
        current.reject(new Error(`Session interrupted: ${event.data.reason}`))
        return
      }
      current.resolve()
    }
  }

  const receive = (attempt: Attempt, event: RunV2Event) => {
    if (!current(attempt)) return
    if (state.buffered?.attempt === attempt) {
      state.buffered.events.push(event)
      return
    }
    apply(attempt, event)
  }

  const hydration = new Map<number, Promise<void>>()
  const serializeHydration = <A>(attempt: Attempt, run: () => Promise<A>) => {
    const previous = hydration.get(attempt.generation) ?? Promise.resolve()
    const task = previous.then(run, run)
    const tail = task.then(
      () => {},
      () => {},
    )
    hydration.set(attempt.generation, tail)
    void tail.then(() => {
      if (hydration.get(attempt.generation) === tail) hydration.delete(attempt.generation)
    })
    return task
  }
  const settleHydration = async () => {
    while (hydration.size > 0) await Promise.all(hydration.values())
  }

  const catalogRefreshes = new Map<number, Set<Promise<void>>>()
  const refreshCatalog = (attempt: Attempt) => {
    if (!current(attempt)) return Promise.resolve()
    const task = Promise.resolve(input.onCatalogRefresh?.(attempt.signal))
      .then(() => {})
      .catch(() => {})
    const refreshes = catalogRefreshes.get(attempt.generation) ?? new Set()
    refreshes.add(task)
    catalogRefreshes.set(attempt.generation, refreshes)
    void task.finally(() => {
      refreshes.delete(task)
      if (refreshes.size === 0 && catalogRefreshes.get(attempt.generation) === refreshes)
        catalogRefreshes.delete(attempt.generation)
    })
    return task
  }
  const settleCatalog = async (attempt: Attempt) => {
    while (current(attempt)) {
      const refreshes = catalogRefreshes.get(attempt.generation)
      if (!refreshes || refreshes.size === 0) return
      await Promise.all(refreshes)
    }
  }
  const settleCatalogRefreshes = async () => {
    while (catalogRefreshes.size > 0)
      await Promise.all([...catalogRefreshes.values()].flatMap((refreshes) => [...refreshes]))
  }

  const connect = async () => {
    while (!controller.signal.aborted && !input.footer.isClosed) {
      const client = sdk
      const error = await (async () => {
        const connection = new AbortController()
        const abortConnection = () => connection.abort()
        controller.signal.addEventListener("abort", abortConnection, { once: true })
        const attempt = { client, signal: connection.signal, generation: ++generation }
        const stream = client.event.subscribe({ signal: connection.signal })[Symbol.asyncIterator]()
        activeAttempt = attempt
        try {
          const first = await nextEvent(stream, connection.signal)
          if (first.done || first.value.type !== "server.connected") throw new Error("Event stream disconnected")
          const buffered: RunV2Event[] = []
          let booting = true
          const consume = (async () => {
            while (true) {
              const next = await nextEvent(stream, connection.signal)
              if (next.done) throw new Error("Event stream disconnected")
              if (booting) buffered.push(next.value)
              else receive(attempt, next.value)
            }
          })()
          await Promise.race([
            serializeHydration(attempt, () =>
              hydrate(attempt, {
                render: state.initial ? input.replay === true : true,
                reuseVisibleWait: !state.initial,
                reconnect: !state.initial,
              }),
            ),
            consume,
          ])
          await Promise.race([refreshCatalog(attempt), consume])
          if (!current(attempt)) throw new Error("Event stream disconnected")
          state.initial = false
          do {
            for (const event of buffered.splice(0)) apply(attempt, event)
            await Promise.race([subagents.ready(), consume])
            await Promise.race([settleCatalog(attempt), consume])
          } while (buffered.length > 0)
          if (!current(attempt)) throw new Error("Event stream disconnected")
          booting = false
          state.connected = true
          readyResolve()
          await consume
        } finally {
          connection.abort()
          if (activeAttempt === attempt) activeAttempt = undefined
          if (state.buffered?.attempt === attempt) state.buffered = undefined
          if (generation === attempt.generation) generation++
          controller.signal.removeEventListener("abort", abortConnection)
          void stream.return?.(undefined).catch(() => {})
        }
      })().catch((error) => error)
      state.connected = false
      if (controller.signal.aborted || input.footer.isClosed) return
      input.trace?.write("recv.reconnect", { error: formatUnknownError(error) })
      write([], { phase: "running", status: "reconnecting" })
      if (input.reconnect) {
        try {
          const next = await input.reconnect(controller.signal)
          if (controller.signal.aborted || input.footer.isClosed) return
          sdk = next
          input.onClient?.(next)
        } catch (resolveError) {
          if (controller.signal.aborted || input.footer.isClosed) return
          input.trace?.write("recv.reresolve", { error: formatUnknownError(resolveError) })
        }
      }
      await wait(250, controller.signal)
    }
  }
  const connection = connect()
  try {
    await ready
  } catch (error) {
    offFooterClose()
    controller.abort()
    await connection.catch(() => {})
    await settleHydration()
    await settleCatalogRefreshes()
    await subagents.ready()
    throw error
  } finally {
    controller.signal.removeEventListener("abort", abortReady)
  }

  const runShellTurn = async (next: SessionTurnInput) => {
    if (state.wait || state.shellWait) throw new Error("prompt already running")
    if (!state.connected) throw new Error("Event stream is reconnecting")
    const client = sdk
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    next.signal?.addEventListener("abort", onAbort, { once: true })
    let rendered!: () => void
    const output = new Promise<void>((resolve) => {
      rendered = resolve
    })
    const eventID = Event.ID.create()
    const active: ShellWait = {
      eventID,
      messageID: messageIDFromEvent(eventID),
      resolve: rendered,
      abort: () => abort.abort(),
    }
    state.shellWait = active
    input.trace?.write("send.shell", { sessionID: input.sessionID, id: eventID, command: next.prompt.text })
    write([], { phase: "running", status: "running shell" })
    try {
      await client.session.shell(
        { sessionID: input.sessionID, id: eventID, command: next.prompt.text },
        { signal: abort.signal },
      )
      await Promise.race([output, wait(SHELL_OUTPUT_GRACE_MS, abort.signal)])
    } catch (error) {
      if (abort.signal.aborted) return
      throw error
    } finally {
      next.signal?.removeEventListener("abort", onAbort)
      if (state.shellWait === active) state.shellWait = undefined
    }
  }

  // Shared settlement scaffolding for prompt-shaped turns: registers the wait,
  // wires interruption, sends, then blocks until the live settled event (or a
  // hydration pass over an idle session) resolves it.
  const runTurnWait = async (
    next: SessionTurnInput,
    messageID: string,
    turn: { promoted?: boolean; send: () => Promise<unknown> },
  ) => {
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const done = new Promise<void>((ok, fail) => {
      resolve = ok
      reject = fail
    })
    const active: Wait = {
      messageID,
      promoted: turn.promoted === true,
      interrupted: false,
      failureRendered: false,
      resolve,
      reject,
    }
    state.wait = active
    const interrupt = () => {
      active.interrupted = true
      void sdk.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
    }
    next.signal?.addEventListener("abort", interrupt, { once: true })
    try {
      await turn.send()
      await done
    } catch (error) {
      if (state.wait === active) state.wait = undefined
      if (next.signal?.aborted) return
      throw error
    } finally {
      next.signal?.removeEventListener("abort", interrupt)
    }
  }

  const performResizeReplay = async (attempt: Attempt, next: SessionResizeReplayInput) => {
    if (!input.replay || !state.connected || !current(attempt) || state.closed || input.footer.isClosed) return false
    const localRows = next.localRows()
    const buffered: RunV2Event[] = []
    const replayBuffer = { attempt, events: buffered }
    let failure: unknown
    let reset = false
    state.buffered = replayBuffer
    try {
      await input.footer.idle()
      if (!current(attempt)) return false
      await next.reset()
      if (!current(attempt)) return false
      reset = true
      state.messageIDs.clear()
      state.fragments.clear()
      state.tools.clear()
      state.toolSources.clear()
      state.finishedTools.clear()
      state.skillMessages.clear()
      state.shellCommands.clear()
      state.shellStarted.clear()
      state.shellEnded.clear()
      state.errors.clear()
      await hydrate(attempt, { render: true, reuseVisibleWait: false })
    } catch (error) {
      failure = error
    } finally {
      if (state.buffered === replayBuffer) state.buffered = undefined
    }
    if (!current(attempt)) return false
    try {
      if (reset) {
        for (const row of localRows) {
          if (
            row.commit.messageID &&
            row.commit.partID &&
            (row.commit.kind === "assistant" || row.commit.kind === "reasoning")
          ) {
            const prefix = row.commit.kind === "reasoning" ? "Thinking: " : ""
            const text = row.commit.text.startsWith(prefix) ? row.commit.text.slice(prefix.length) : row.commit.text
            const restored = state.fragments.restore(
              { messageID: row.commit.messageID, partID: row.commit.partID },
              text,
            )
            if (restored.type === "covered") continue
            if (restored.type === "append") {
              if (restored.suffix)
                input.footer.append(restored.suffix === text ? row.commit : { ...row.commit, text: restored.suffix })
              continue
            }
          }
          if (row.commit.kind === "error" && row.commit.messageID) {
            if (state.errors.has(row.commit.messageID)) continue
            state.errors.add(row.commit.messageID)
            input.footer.append(row.commit)
            continue
          }
          if (row.commit.messageID && state.messageIDs.has(row.commit.messageID)) continue
          input.footer.append(row.commit)
        }
      }
    } finally {
      for (const event of buffered) apply(attempt, event)
    }
    if (reset) await input.footer.idle()
    if (failure) throw failure
    return true
  }

  let resizeReplay: Promise<boolean> | undefined
  let queuedResizeReplay: SessionResizeReplayInput | undefined
  let closing: Promise<void> | undefined

  const replayOnResize = (next: SessionResizeReplayInput) => {
    queuedResizeReplay = next
    if (resizeReplay) return resizeReplay
    resizeReplay = (async () => {
      let replayed = false
      let failure: unknown
      while (queuedResizeReplay) {
        const next = queuedResizeReplay
        queuedResizeReplay = undefined
        const attempt = activeAttempt
        if (!attempt || !current(attempt)) continue
        try {
          replayed = (await serializeHydration(attempt, () => performResizeReplay(attempt, next))) || replayed
        } catch (error) {
          failure ??= error
        }
      }
      if (failure) throw failure
      return replayed
    })().finally(() => {
      resizeReplay = undefined
    })
    return resizeReplay
  }

  return {
    async runPromptTurn(next) {
      if (next.prompt.mode === "shell") {
        await runShellTurn(next)
        return
      }
      if (state.wait || state.shellWait) throw new Error("prompt already running")
      if (!state.connected) throw new Error("Event stream is reconnecting")
      const client = sdk
      const messageID = next.prompt.messageID
      if (!messageID) throw new Error("Prompt message ID is required")

      const command = next.prompt.command
      if (command?.source === "skill") {
        input.trace?.write("send.skill", { sessionID: input.sessionID, messageID, skill: command.name })
        await runTurnWait(next, messageID, {
          send: () =>
            client.session.skill(
              { sessionID: input.sessionID, id: messageID, skill: command.name },
              { signal: next.signal },
            ),
        })
        return
      }
      if (command) {
        const selected = await resolveSelectedModel(input, client, next)
        if (next.variant && !selected) throw new Error("Cannot select a variant before selecting a model")
        // Agent and model ride the command payload; the server switches only
        // when the command itself does not pin them.
        const attachments = await prepareAttachments(next, "command")
        const agents = promptAgents(next)
        input.trace?.write("send.command", { sessionID: input.sessionID, messageID, command: command.name })
        await runTurnWait(next, messageID, {
          send: () =>
            client.session.command(
              {
                sessionID: input.sessionID,
                id: messageID,
                command: command.name,
                arguments: command.arguments,
                agent: next.agent,
                model: selected,
                files: attachments.files.length ? attachments.files : undefined,
                agents: agents.length ? agents : undefined,
                delivery: "steer",
              },
              { signal: next.signal },
            ),
        })
        return
      }

      if (next.agent) {
        await client.session.switchAgent({ sessionID: input.sessionID, agent: next.agent }, { signal: next.signal })
      }
      const selected = await resolveSelectedModel(input, client, next)
      if (next.variant && !selected) throw new Error("Cannot select a variant before selecting a model")
      if (selected)
        await client.session.switchModel({ sessionID: input.sessionID, model: selected }, { signal: next.signal })

      const attachments = await prepareAttachments(next, "prompt", input.readTextFile)
      const agents = promptAgents(next)
      input.trace?.write("send.prompt", { sessionID: input.sessionID, messageID })
      await runTurnWait(next, messageID, {
        send: () =>
          client.session.prompt(
            {
              sessionID: input.sessionID,
              id: messageID,
              text: [next.prompt.text, ...attachments.text].join("\n\n"),
              files: attachments.files.length ? attachments.files : undefined,
              agents: agents.length ? agents : undefined,
              delivery: "steer",
            },
            { signal: next.signal },
          ),
      })
    },
    async interruptActiveTurn() {
      // A running shell holds no drain, so session.interrupt cannot reach it;
      // abort the blocking request instead. The server-side command keeps its
      // own lifecycle and simply loses its waiter.
      const shell = state.shellWait
      if (shell) {
        shell.abort()
        return
      }
      if (state.wait) state.wait.interrupted = true
      await sdk.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
    },
    selectSubagent(sessionID) {
      subagents.select(sdk, sessionID)
    },
    settleForm(sessionID, formID) {
      if (sessionID === input.sessionID) state.forms = state.forms.filter((item) => item.id !== formID)
      else if (sessionID === "global") state.globalForms = state.globalForms.filter((item) => item.id !== formID)
      else subagents.settleForm(sessionID, formID)
      syncBlockers()
    },
    replayOnResize,
    close() {
      if (!closing) {
        state.closed = true
        generation++
        offFooterClose()
        controller.abort()
        closing = (async () => {
          await connection.catch(() => {})
          await settleHydration()
          await resizeReplay?.catch(() => {})
          await settleCatalogRefreshes()
          await subagents.ready()
        })()
      }
      return closing
    },
  }
}

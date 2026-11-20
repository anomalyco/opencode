import type { JsonValue, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { Widget } from "@opencode/schema/widget"
import { builtins, program } from "@opencode/widget"
import {
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useClient } from "../../context/client"
import { useData } from "../../context/data"

/** One widget as the timeline renders it: the `widget` tool call's input joined with the plugin's state for it. */
export type WidgetInfo = {
  /** `messageID:callID`, unique in the Session. */
  readonly id: string
  readonly sessionID: string
  readonly messageID: string
  readonly callID: string
  readonly title?: string
  readonly template: { readonly name: string; readonly version: string }
  readonly data: unknown
  readonly status: Widget.Status
  readonly response?: unknown
  readonly wait: boolean
}

export type WidgetResponse = { value: JsonValue } | { dismiss: true }

/** A template version's runnable program (prelude + source) and how it runs. */
export type WidgetProgram = { readonly program: string; readonly mode: Widget.Mode }

export type WidgetBackend = {
  program: (template: { name: string; version: string }) => Promise<WidgetProgram>
  respond: (input: { widget: WidgetInfo; response: WidgetResponse }) => Promise<void>
  /** Sends a non-final value from `send(...)`; the widget stays open. */
  send: (input: { widget: WidgetInfo; value: JsonValue; wake: boolean }) => Promise<void>
  /** Tells the agent this client failed running the widget (client name "tui"). */
  report: (input: { widget: WidgetInfo; error: Widget.RuntimeError }) => Promise<void>
}

export const widgetKey = (messageID: string, callID: string) => `${messageID}:${callID}`

/** Joins a `widget` tool part with its state; undefined until the plugin has stored one. */
export function widgetInfo(
  part: SessionMessageAssistantTool,
  messageID: string,
  state: Widget.State | undefined,
): WidgetInfo | undefined {
  if (!state) return
  const input = typeof part.state.input === "string" ? {} : part.state.input
  return {
    id: widgetKey(messageID, part.id),
    sessionID: state.sessionID,
    messageID,
    callID: part.id,
    title: state.title,
    template: state.template,
    data: input.data ?? {},
    status: state.status,
    response: state.response,
    wait: state.wait,
  }
}

/**
 * The quiet transcript line of a widget answer or message: a synthetic message the widgets plugin admits with
 * `metadata.widget`.
 */
export function widgetNotice(message: SessionMessageInfo | undefined) {
  if (message?.type !== "synthetic") return
  const widget = message.metadata?.widget
  if (typeof widget !== "object" || widget === null || !("callID" in widget)) return
  return message.description ?? ""
}

/** A respond call the server rejected because the widget already has an answer. */
export class WidgetConflict extends Error {}

/**
 * The widget states of a Session, from the widgets plugin's RPC: fetched when the Session changes, the server
 * reconnects (changes published meanwhile were missed) or plugins finish loading (a cold Location answers
 * `rpc.unavailable` until then), and kept current from its `changed` events.
 */
export function createWidgetStates(sessionID: Accessor<string | undefined>) {
  const client = useClient()
  const data = useData()
  const [states, setStates] = createSignal<ReadonlyMap<string, Widget.State>>(new Map())
  const rpc = () => client.api.rpc(Widget.Definition)
  // A change that arrives while a fetch is in flight is newer than its reply, so each change or fetch takes a turn.
  const turn = { value: 0 }
  const load = (id: string) => {
    const current = ++turn.value
    const directory = data.session.get(id)?.location.directory
    // A server without the widgets plugin answers with an error, and the Session shows no widgets.
    void rpc()
      .states({ sessionID: id }, directory ? { location: { directory } } : undefined)
      .then(
        (list) => {
          if (current !== turn.value || sessionID() !== id) return
          setStates(new Map(list.map((state) => [widgetKey(state.messageID, state.callID), state])))
        },
        () => undefined,
      )
  }
  onCleanup(
    rpc().events.on("changed", (event) => {
      if (event.data.sessionID !== sessionID()) return
      turn.value++
      const state = event.data.state
      setStates((current) => new Map(current).set(widgetKey(state.messageID, state.callID), state))
    }),
  )
  onCleanup(
    client.event.on("server.connected", () => {
      const id = sessionID()
      if (id) load(id)
    }),
  )
  // Plugins load after a Location boots, and until then the RPC answers `rpc.unavailable`; reload once they settle.
  onCleanup(
    client.event.on("plugin.updated", () => {
      const id = sessionID()
      if (id) load(id)
    }),
  )
  createEffect(
    on(sessionID, (id) => {
      setStates(new Map())
      if (id) load(id)
    }),
  )
  return {
    list: () => [...states().values()],
    get: (messageID: string, callID: string) => states().get(widgetKey(messageID, callID)),
  }
}

export type WidgetStates = ReturnType<typeof createWidgetStates>

const BackendContext = createContext<WidgetBackend>()

/** Overrides the server backend, for stories and tests that keep templates and responses local. */
export function WidgetBackendProvider(props: ParentProps<{ backend: WidgetBackend }>) {
  return <BackendContext.Provider value={props.backend}>{props.children}</BackendContext.Provider>
}

export function useWidgetBackend(): WidgetBackend {
  const provided = useContext(BackendContext)
  if (provided) return provided
  const client = useClient()
  const data = useData()
  const rpc = () => client.api.rpc(Widget.Definition)
  const options = (widget: WidgetInfo) => {
    const directory = data.session.get(widget.sessionID)?.location.directory
    return directory ? { location: { directory } } : undefined
  }
  return {
    program: (template) =>
      cached(template, () =>
        rpc()
          .program(template)
          .then((result) => ({ program: result.program, mode: result.mode })),
      ),
    respond: (input) =>
      rpc()
        .respond(
          {
            sessionID: input.widget.sessionID,
            messageID: input.widget.messageID,
            callID: input.widget.callID,
            response: input.response,
          },
          options(input.widget),
        )
        .then(
          () => undefined,
          (error: unknown) => {
            if (isRpcFailure(error, "closed")) throw new WidgetConflict("This widget already has an answer")
            throw error
          },
        ),
    report: (input) =>
      rpc()
        .report(
          {
            sessionID: input.widget.sessionID,
            messageID: input.widget.messageID,
            callID: input.widget.callID,
            error: input.error,
            client: "tui",
          },
          options(input.widget),
        )
        .then(() => undefined),
    send: (input) =>
      rpc()
        .send(
          {
            sessionID: input.widget.sessionID,
            messageID: input.widget.messageID,
            callID: input.widget.callID,
            value: input.value,
            wake: input.wake,
          },
          options(input.widget),
        )
        .then(() => undefined),
  }
}

function isRpcFailure(error: unknown, type: string) {
  return typeof error === "object" && error !== null && "type" in error && error.type === type
}

// Versions are content addresses and never change, so programs stay cached for the whole process.
const programs = new Map<string, Promise<WidgetProgram>>()

/** Serves built-in templates locally when the version matches and caches every other program by name@version. */
export function cached(template: { name: string; version: string }, load: () => Promise<WidgetProgram>) {
  const key = `${template.name}@${template.version}`
  const existing = programs.get(key)
  if (existing) return existing
  const builtin = builtins.find((item) => item.name === template.name && item.version === template.version)
  const pending: Promise<WidgetProgram> = builtin
    ? Promise.resolve({ program: program(builtin.source), mode: builtin.mode })
    : load()
  programs.set(key, pending)
  // A failed fetch must not stick, so the next mount retries.
  pending.catch(() => {
    if (programs.get(key) === pending) programs.delete(key)
  })
  return pending
}

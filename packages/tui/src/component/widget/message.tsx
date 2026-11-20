import type { JsonValue } from "@opencode/client"
import { program, StepError, WidgetSession, type Node, type WidgetEvent } from "@opencode/widget"
import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Match, on, onCleanup, Show, Switch, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Keymap } from "../../context/keymap"
import { useLog } from "../../context/log"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { SplitBorder } from "../../ui/border"
import { errorMessage } from "../../util/error"
import { useWidgetBackend, WidgetConflict, type WidgetInfo, type WidgetResponse } from "./backend"
import { WIDGET_MODE, WidgetView } from "./view"

export type WidgetFocus = {
  /** The message ID of the widget that holds the keyboard, if any. */
  engaged: Accessor<string | undefined>
  engage: (messageID: string) => void
  release: () => void
}

/**
 * Keyboard ownership for the widgets of one timeline. The newest open widget takes the keyboard when it appears;
 * escape hands it back to the prompt and a click takes it again.
 */
export function createWidgetFocus(
  widgets: Accessor<readonly { readonly id: string; readonly status: WidgetInfo["status"] }[]>,
): WidgetFocus {
  const keymap = Keymap.use()
  const dialog = useDialog()
  const [engaged, setEngaged] = createSignal<string>()
  const open = createMemo(() => widgets().findLast((widget) => widget.status === "open")?.id)
  createEffect(on(open, (id) => setEngaged(id)))
  // A widget that closed or left the timeline gives the keyboard back.
  createEffect(() => {
    const id = engaged()
    if (id && !widgets().some((widget) => widget.id === id && widget.status === "open")) setEngaged(undefined)
  })
  onCleanup(keymap.mode.push(WIDGET_MODE, () => engaged() !== undefined && dialog.stack.length === 0))
  return {
    engaged,
    engage: setEngaged,
    release: () => setEngaged(undefined),
  }
}

type Status = WidgetInfo["status"]

/** A widget message in the timeline: loads its template program, runs steps and sends the response. */
export function WidgetMessage(props: { message: WidgetInfo; focus: WidgetFocus }) {
  const theme = useTheme()
  const backend = useWidgetBackend()
  const keymap = Keymap.use()
  const renderer = useRenderer()
  const log = useLog({ component: "widget" })
  const dismissShortcut = Keymap.useShortcut("app.exit")
  const [store, setStore] = createStore<{
    view?: Node
    failure?: string
    error?: string
    sending: boolean
    /** A live template, which this client does not run. */
    live?: boolean
    sent?: Status
    response?: unknown
  }>({ sending: false })
  const [session, setSession] = createSignal<WidgetSession>()
  // Lines in the template source, so a position past it (in the appended entry) isn't reported as the template's.
  const source = { lines: 0 }


  const status = () => (props.message.status === "open" ? (store.sent ?? "open") : props.message.status)
  const interactive = () => status() === "open" && !store.sending && session() !== undefined
  const active = () =>
    interactive() && props.focus.engaged() === props.message.id && keymap.mode.current() === WIDGET_MODE
  const title = () => props.message.title || props.message.template.name

  // Keyed by the template version so a status update keeps the view the user just answered.
  const template = createMemo(() => `${props.message.template.name}@${props.message.template.version}`)
  createEffect(
    on(template, () => {
      let current = true
      onCleanup(() => (current = false))
      setStore({ view: undefined, failure: undefined, error: undefined, live: false })
      setSession(undefined)
      void backend
        .program(props.message.template)
        .then((loaded) => {
          // The TUI does not run live programs yet (widgets-live.md).
          if (loaded.mode === "live") return void (current && setStore("live", true))
          source.lines = loaded.program.split("\n").length - preludeLines
          return WidgetSession.start(loaded.program, props.message.data).then((started) => {
            if (!current) return
            setSession(started)
            setStore("view", started.view)
          })
        })
        .catch((error) => {
          if (!current) return
          setStore("failure", stepMessage(error))
          report("init", error)
        })
    }),
  )

  // A widget this client cannot run gives the keyboard back to the prompt.
  createEffect(() => {
    if ((store.live || store.failure) && props.focus.engaged() === props.message.id) props.focus.release()
  })

  function dispatch(event: WidgetEvent) {
    const current = session()
    if (!current || !interactive()) return
    void current
      .dispatch(event)
      .then((output) => {
        if (session() !== current) return
        output.warnings?.forEach((warning) => log.warn(warning, { template: props.message.template.name }))
        setStore({ view: output.view, error: undefined })
        if (output.dismiss) return respond({ dismiss: true })
        // Programs run on a JSON-only interpreter, so a submitted or sent value is always JSON.
        if ("submit" in output) return respond({ value: output.submit as JsonValue })
        if (output.send) return send(output.send.value as JsonValue, output.send.wake)
      })
      .catch((error) => {
        if (session() !== current) return
        setStore("error", stepMessage(error))
        report("update", error)
      })
  }

  // The server never runs templates, so a failing step goes back to the agent, which can fix the template.
  function report(phase: "init" | "update", error: unknown) {
    if (!(error instanceof StepError) || status() !== "open") return
    void backend
      .report({ widget: props.message, error: { phase, ...stepPosition(error.message, source.lines) } })
      .catch((cause) => log.warn("failed to report a widget error", { cause: errorMessage(cause) }))
  }

  function send(value: JsonValue, wake: boolean) {
    if (status() !== "open") return
    return backend.send({ widget: props.message, value, wake }).catch((error) => setStore("error", errorMessage(error)))
  }

  function respond(response: WidgetResponse) {
    if (store.sending || status() !== "open") return
    setStore({ sending: true, error: undefined })
    return backend
      .respond({ widget: props.message, response })
      .then(() =>
        setStore("dismiss" in response ? { sent: "dismissed" } : { sent: "submitted", response: response.value }),
      )
      .catch((error) => {
        if (error instanceof WidgetConflict) {
          setStore({ sent: "submitted", error: error.message })
          return
        }
        setStore("error", errorMessage(error))
      })
      .finally(() => setStore("sending", false))
  }

  Keymap.createLayer(() => ({
    mode: WIDGET_MODE,
    enabled: active(),
    commands: [
      { bind: "escape", title: "Back to prompt", group: "Widget", run: () => props.focus.release() },
      { id: "app.exit", title: "Dismiss widget", group: "Widget", run: () => void respond({ dismiss: true }) },
    ],
  }))

  return (
    <box
      flexShrink={0}
      backgroundColor={theme.background.raised.base}
      border={["left"]}
      borderColor={active() ? theme.background.action.primary.focused : theme.border.base}
      customBorderChars={SplitBorder.customBorderChars}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        if (interactive()) props.focus.engage(props.message.id)
      }}
    >
      <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
        <text fg={theme.text.muted} wrapMode="none">
          {title()}
        </text>
        <Switch>
          <Match when={store.failure}>
            {(failure) => (
              <text fg={theme.text.feedback.error.base} wrapMode="word">
                Widget failed to load: {failure()}
              </text>
            )}
          </Match>
          <Match when={store.live}>
            <text fg={theme.text.muted} wrapMode="word">
              {liveAlt(props.message.data) ?? "Open this widget on desktop or mobile."}
            </text>
          </Match>
          <Match when={store.view}>
            {(view) => (
              <WidgetView
                view={view()}
                interactive={interactive()}
                active={active()}
                background={theme.background.raised.base}
                onEvent={dispatch}
                onEngage={() => props.focus.engage(props.message.id)}
              />
            )}
          </Match>
          <Match when={true}>
            <text fg={theme.text.muted}>Loading widget…</text>
          </Match>
        </Switch>
        <Show when={store.error}>
          {(error) => (
            <text fg={theme.text.feedback.error.base} wrapMode="word">
              {error()}
            </text>
          )}
        </Show>
        <Switch>
          <Match when={status() === "submitted"}>
            <text fg={theme.text.feedback.success.base} wrapMode="word">
              <span style={{ attributes: TextAttributes.BOLD }}>Submitted</span>
              <Show when={summary(props.message.response ?? store.response)}>
                {(text) => <span style={{ fg: theme.text.muted }}> · {text()}</span>}
              </Show>
            </text>
          </Match>
          <Match when={status() === "dismissed"}>
            <text fg={theme.text.muted}>Dismissed</text>
          </Match>
          <Match when={store.sending}>
            <text fg={theme.text.muted}>Sending…</text>
          </Match>
          <Match when={active()}>
            <text fg={theme.text.base} wrapMode="word">
              ⇥ <span style={{ fg: theme.text.muted }}>next</span> enter{" "}
              <span style={{ fg: theme.text.muted }}>select</span> esc{" "}
              <span style={{ fg: theme.text.muted }}>prompt</span>
              <Show when={dismissShortcut()}>
                {(key) => (
                  <>
                    {" "}
                    {key()} <span style={{ fg: theme.text.muted }}>dismiss</span>
                  </>
                )}
              </Show>
            </text>
          </Match>
          <Match when={interactive()}>
            <text fg={theme.text.muted}>Click to answer, or reply in the prompt</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}

/** A live widget's own description of itself for clients that cannot run it: its data's `alt`, if it has one. */
function liveAlt(data: unknown) {
  if (typeof data !== "object" || data === null || !("alt" in data) || typeof data.alt !== "string") return
  return `${data.alt} · Open this widget on desktop or mobile.`
}

// The interpreter counts lines in the whole program, prelude included; reports count them in the template source.
const preludeLines = program("").split("\n").length - 1

function stepPosition(message: string, lines: number) {
  const position = /\(line (\d+), col (\d+)\)$/.exec(message)
  if (!position) return { message }
  const line = Number(position[1]) - preludeLines
  const text = message.slice(0, position.index).trimEnd()
  return line < 1 || line > lines ? { message: text } : { message: text, line, column: Number(position[2]) }
}

function stepMessage(error: unknown) {
  if (error instanceof StepError)
    return error.kind === "timeout" ? "The widget took too long to respond" : error.message
  return errorMessage(error)
}

/** One line for a submitted value: top-level fields of an object, anything else as JSON. */
function summary(response: unknown) {
  if (response === undefined || response === null) return
  const text =
    typeof response === "object" && !Array.isArray(response)
      ? Object.entries(response)
          .map(([key, value]) => `${key}: ${typeof value === "string" && value ? value : JSON.stringify(value)}`)
          .join(" · ")
      : JSON.stringify(response)
  return text.length > 200 ? text.slice(0, 199) + "…" : text
}

/** A widget answer or message in the timeline, as one quiet line. */
export function WidgetNotice(props: { text: string }) {
  const theme = useTheme()
  return (
    <box paddingLeft={3} flexShrink={0}>
      <text fg={theme.text.muted} wrapMode="word">
        ◈ {props.text}
      </text>
    </box>
  )
}

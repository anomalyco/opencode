import { StepError, WidgetSession, type Node, type WidgetEvent } from "@opencode/widget"
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
import { useWidgetBackend, WidgetConflict, type WidgetMessageInfo, type WidgetResponse } from "./backend"
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
export function createWidgetFocus(widgets: Accessor<readonly WidgetMessageInfo[]>): WidgetFocus {
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

type Status = WidgetMessageInfo["status"]

/** A widget message in the timeline: loads its template program, runs steps and sends the response. */
export function WidgetMessage(props: { message: WidgetMessageInfo; sessionID: string; focus: WidgetFocus }) {
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
    sent?: Status
    response?: unknown
  }>({ sending: false })
  const [session, setSession] = createSignal<WidgetSession>()

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
      setStore({ view: undefined, failure: undefined, error: undefined })
      setSession(undefined)
      void backend
        .program(props.message.template)
        .then((program) => WidgetSession.start(program, props.message.data))
        .then((started) => {
          if (!current) return
          setSession(started)
          setStore("view", started.view)
        })
        .catch((error) => {
          if (current) setStore("failure", stepMessage(error))
        })
    }),
  )

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
        if ("submit" in output) return respond({ value: output.submit })
      })
      .catch((error) => {
        if (session() === current) setStore("error", stepMessage(error))
      })
  }

  function respond(response: WidgetResponse) {
    if (store.sending || status() !== "open") return
    setStore({ sending: true, error: undefined })
    return backend
      .respond({ sessionID: props.sessionID, messageID: props.message.id, response })
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

import { TextareaRenderable, TextAttributes } from "@opentui/core"
import type { TuiPlugin, TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { Show, createSignal, onCleanup } from "solid-js"
import type { BuiltinTuiPlugin } from "../builtins"
import { useTheme } from "../../context/theme"

const id = "side-question"
const cmd = {
  open: `${id}.open`,
  submit: `${id}.submit`,
  close: `${id}.close`,
}

type State = {
  visible: boolean
  loading: boolean
  question: string
  answer: string
  error: string
}

const initial: State = {
  visible: false,
  loading: false,
  question: "",
  answer: "",
  error: "",
}

function message(err: unknown) {
  if (err instanceof Error) return err.message
  return "Side question failed"
}

export function bindings(keys: TuiPluginApi["tuiConfig"]["keybinds"]) {
  return keys
    .gather(`${id}.submit`, ["input.submit", "prompt.submit"])
    .map((binding) => ({ ...binding, cmd: cmd.submit, desc: "Submit side question" }))
}

export function parse(input: string, session?: string) {
  const match = input.match(/^\/(?:btw|ask)(?:\s+([\s\S]*))?$/i)
  if (!match) return { type: "pass" as const }
  if (!session) return { type: "missing" as const }
  const question = match[1]?.trim()
  if (question) return { type: "ask" as const, question }
  if (/\s$/.test(input)) return { type: "empty" as const }
  return { type: "pass" as const }
}

function Input(props: {
  api: TuiPluginApi
  session: string
  state: State
  visible?: boolean
  disabled?: boolean
  submit?: () => void
  bind?: (ref: TuiPromptRef | undefined) => void
  set: (ref: TuiPromptRef | undefined) => void
}) {
  const bind = (ref: TuiPromptRef | undefined) => {
    props.set(ref)
    props.bind?.(ref)
  }
  onCleanup(() => bind(undefined))
  return (
    <box width="100%" flexDirection="column" flexShrink={0} gap={1}>
      <Panel state={props.state} />
      <props.api.ui.Prompt
        sessionID={props.session}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={props.submit}
        ref={bind}
        right={<props.api.ui.Slot name="session_prompt_right" session_id={props.session} />}
      />
    </box>
  )
}

function Panel(props: { state: State }) {
  const current = useTheme()
  const theme = () => current.theme
  return (
    <Show when={props.state.visible}>
      <box
        width="100%"
        maxHeight={14}
        flexShrink={0}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={theme().backgroundPanel}
        borderColor={props.state.error ? theme().error : theme().info}
        border={["left", "right", "top", "bottom"]}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme().textMuted}>/btw {props.state.question}</text>
        <Show when={props.state.loading}>
          <text fg={theme().info}>Thinking...</text>
        </Show>
        <Show when={props.state.error}>
          <text fg={theme().error}>{props.state.error}</text>
        </Show>
        <Show when={props.state.answer}>
          <scrollbox maxHeight={8} stickyScroll={true} stickyStart="bottom">
            <code
              filetype="markdown"
              content={props.state.answer}
              fg={theme().markdownText}
              syntaxStyle={current.syntax()}
              attributes={TextAttributes.NONE}
              conceal={true}
            />
          </scrollbox>
        </Show>
        <text fg={theme().textMuted}>{props.state.loading ? "esc to cancel" : "esc, enter, or space to dismiss"}</text>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  const [ref, setRef] = createSignal<TuiPromptRef>()
  const [state, setState] = createSignal(initial)
  let ctrl: AbortController | undefined

  const session = () => {
    const route = api.route.current
    if (route.name !== "session" || !route.params || typeof route.params.sessionID !== "string") return undefined
    return route.params.sessionID
  }
  const close = () => {
    ctrl?.abort()
    ctrl = undefined
    setState(initial)
  }
  const ask = (sessionID: string, question: string) => {
    ctrl?.abort()
    const next = new AbortController()
    ctrl = next
    setState({ visible: true, loading: true, question, answer: "", error: "" })
    void api.client.session
      .sideQuestion({ sessionID, question }, { signal: next.signal, throwOnError: true })
      .then((result) => {
        if (ctrl !== next) return
        setState({ visible: true, loading: false, question, answer: result.data, error: "" })
      })
      .catch((err: unknown) => {
        if (ctrl !== next || next.signal.aborted) return
        setState({ visible: true, loading: false, question, answer: "", error: message(err) })
      })
  }

  api.keymap.registerLayer({
    priority: 100,
    commands: [
      {
        name: cmd.open,
        title: "Ask a side question",
        desc: "Ask from the current context without interrupting the session",
        category: "Session",
        namespace: "palette",
        slashName: "btw",
        slashAliases: ["ask"],
        enabled: () => session() !== undefined,
        run() {
          const prompt = ref()
          if (!session() || !prompt) return false
          prompt.set({ input: "/btw ", parts: [] })
          prompt.focus()
          return true
        },
      },
      {
        name: cmd.submit,
        title: "Submit side question",
        hidden: true,
        run(ctx) {
          const prompt = ref()
          const sessionID = session()
          const input = prompt?.focused
            ? prompt.current.input
            : api.route.current.name === "home" && ctx.focused instanceof TextareaRenderable
              ? ctx.focused.plainText
              : undefined
          if (!input) return false
          const result = parse(input, sessionID)
          if (result.type === "pass") return false
          if (result.type === "missing") {
            api.ui.toast({ variant: "warning", message: "Open a session before asking a side question" })
            return true
          }
          if (result.type === "empty") {
            api.ui.toast({ variant: "warning", message: "Add a question after /btw" })
            return true
          }
          if (!prompt || !sessionID) return false
          prompt.reset()
          ask(sessionID, result.question)
          return true
        },
      },
      {
        name: cmd.close,
        title: "Dismiss side question",
        hidden: true,
        run() {
          if (!state().visible) return false
          close()
          return true
        },
      },
    ],
    bindings: [
      { key: "escape,enter,space", cmd: cmd.close, desc: "Dismiss side question" },
      ...bindings(api.tuiConfig.keybinds),
    ],
  })

  api.slots.register({
    order: 100,
    slots: {
      session_prompt(_ctx, props) {
        return (
          <Input
            api={api}
            session={props.session_id}
            state={state()}
            visible={props.visible}
            disabled={props.disabled}
            submit={props.on_submit}
            bind={props.ref}
            set={setRef}
          />
        )
      },
    },
  })

  api.lifecycle.onDispose(close)
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

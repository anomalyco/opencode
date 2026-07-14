import { TextAttributes } from "@opentui/core"
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

function Input(props: {
  api: TuiPluginApi
  session: string
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
    <props.api.ui.Prompt
      sessionID={props.session}
      visible={props.visible}
      disabled={props.disabled}
      onSubmit={props.submit}
      ref={bind}
      right={<props.api.ui.Slot name="session_prompt_right" session_id={props.session} />}
    />
  )
}

function Panel(props: { state: State }) {
  const current = useTheme()
  const theme = () => current.theme
  return (
    <Show when={props.state.visible}>
      <box
        position="absolute"
        zIndex={2000}
        left={2}
        right={2}
        bottom={4}
        maxHeight={14}
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
        run() {
          const prompt = ref()
          const sessionID = session()
          if (!prompt?.focused || !sessionID) return false
          const match = prompt.current.input.match(/^\/(?:btw|ask)(?:\s+([\s\S]*))?$/i)
          if (!match) return false
          const question = match[1]?.trim()
          if (!question) {
            if (!/\s$/.test(prompt.current.input)) return false
            api.ui.toast({ variant: "warning", message: "Add a question after /btw" })
            return true
          }
          prompt.reset()
          ask(sessionID, question)
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
      ...api.tuiConfig.keybinds
        .get("prompt.submit")
        .map((binding) => ({ ...binding, cmd: cmd.submit, desc: "Submit side question" })),
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
            visible={props.visible}
            disabled={props.disabled}
            submit={props.on_submit}
            bind={props.ref}
            set={setRef}
          />
        )
      },
      app() {
        return <Panel state={state()} />
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

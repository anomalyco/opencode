/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import { useDialog } from "../ui/dialog"
import { Spinner } from "./spinner"

type State =
  | { type: "ready"; active: "update" | "ignore" }
  | { type: "installing" }
  | { type: "restarting" }
  | { type: "failed"; message: string }

export function DialogUpdate(props: { version: string; install: () => Promise<void>; restart: () => Promise<void> }) {
  const dialog = useDialog()
  const theme = useTheme("elevated")
  const [state, setState] = createSignal<State>({ type: "ready", active: "update" })

  const install = async () => {
    setState({ type: "installing" })
    await props.install()
    setState({ type: "restarting" })
    await props.restart()
    dialog.clear()
  }

  const beginInstall = () => {
    if (state().type !== "ready") return
    void install().catch((error) => setState({ type: "failed", message: errorMessage(error) }))
  }

  const run = () => {
    const current = state()
    if (current.type !== "ready") return
    if (current.active === "ignore") return dialog.clear()
    beginInstall()
  }

  const toggle = () =>
    setState((current) =>
      current.type === "ready" ? { ...current, active: current.active === "update" ? "ignore" : "update" } : current,
    )

  const selected = (action: "update" | "ignore") => {
    const current = state()
    return current.type === "ready" && current.active === action
  }

  const failure = () => {
    const current = state()
    return current.type === "failed" ? current.message : ""
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: "Confirm update action",
        group: "Dialog",
        run: () => (state().type === "failed" ? dialog.clear() : run()),
      },
      {
        bind: "left",
        title: "Previous update action",
        group: "Dialog",
        run: toggle,
      },
      {
        bind: "right",
        title: "Next update action",
        group: "Dialog",
        run: toggle,
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          Update
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1}>
        <Switch>
          <Match when={state().type === "ready"}>
            <text fg={theme.text.subdued}>
              Update to v{props.version}? It will be applied in the background and active sessions will be restarted.
            </text>
          </Match>
          <Match when={state().type === "installing"}>
            <Spinner>Installing OpenCode {props.version}…</Spinner>
          </Match>
          <Match when={state().type === "restarting"}>
            <Spinner>Restarting the background service…</Spinner>
          </Match>
          <Match when={state().type === "failed"}>
            <text fg={theme.text.feedback.error.default}>{failure()}</text>
          </Match>
        </Switch>
      </box>
      <Show
        when={state().type === "ready"}
        fallback={
          <Show when={state().type === "failed"}>
            <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
              <box
                paddingLeft={3}
                paddingRight={3}
                backgroundColor={theme.background.action.primary.focused}
                onMouseUp={() => dialog.clear()}
              >
                <text fg={theme.text.action.primary.focused}>close</text>
              </box>
            </box>
          </Show>
        }
      >
        <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
          <For each={["ignore", "update"] as const}>
            {(action) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={selected(action) ? theme.background.action.primary.focused : undefined}
                onMouseUp={() => {
                  if (action === "ignore") return dialog.clear()
                  beginInstall()
                }}
              >
                <text fg={selected(action) ? theme.text.action.primary.focused : theme.text.subdued}>
                  {action === "update" ? "Update" : "Ignore"}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

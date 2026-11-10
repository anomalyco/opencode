import { createEffect, createMemo, createResource, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import type { UpdateState } from "../context/update-notification"
import { DialogButtons, DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { errorMessage } from "../util/error"
import { Spinner } from "./spinner"

export function DialogUpdate(props: {
  check?: (signal: AbortSignal) => Promise<string | undefined>
  state: () => UpdateState | undefined
  skip: () => void
  install: () => Promise<void>
  restart: () => void
}) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const [error, setError] = createSignal<string>()
  const [active, setActive] = createSignal(0)
  const controller = new AbortController()
  onCleanup(() => controller.abort())

  dialog.setCentered(true)

  const [check] = createResource(
    () => props.check,
    (check) =>
      check(controller.signal).catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
        return undefined
      }),
  )
  const state = createMemo(() => {
    const message = error()
    if (message) return { type: "check-failed" as const, message }
    const current = props.state()
    if (current?.type === "installing") return current
    if (check.loading) return { type: "checking" as const }
    const unavailable = check()
    if (unavailable) return { type: "unavailable" as const, message: unavailable }
    return current ?? { type: "current" as const }
  })
  const buttons = createMemo(() => {
    const type = state().type
    if (type === "installing") return []
    const confirm =
      type === "available"
        ? { label: "Update", run: props.install }
        : type === "installed"
          ? { label: "Restart", run: props.restart }
          : undefined
    return [
      {
        label: "Skip",
        run: () => {
          props.skip()
          dialog.clear()
        },
      },
      ...(confirm ? [confirm] : []),
    ]
  })

  createEffect(() => setActive(Math.max(0, buttons().length - 1)))

  const move = (step: number) => {
    const count = buttons().length
    if (count) setActive((value) => (value + step + count) % count)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Confirm update action", group: "Dialog", run: () => void buttons()[active()]?.run() },
      { bind: "left", title: "Previous update action", group: "Dialog", run: () => move(-1) },
      { bind: "shift+tab", title: "Previous update action", group: "Dialog", run: () => move(-1) },
      { bind: "right", title: "Next update action", group: "Dialog", run: () => move(1) },
      { bind: "tab", title: "Next update action", group: "Dialog", run: () => move(1) },
    ],
  }))

  return (
    <DialogLayout
      header={
        <DialogHeader
          title={
            state().type === "installing"
              ? "Updating OpenCode"
              : state().type === "available" || state().type === "failed"
                ? "Update available"
                : "Update"
          }
        />
      }
      buttons={
        <Show when={buttons().length > 0}>
          <DialogButtons
            buttons={buttons().map((button) => ({ label: button.label, run: () => void button.run() }))}
            active={active()}
            onActive={setActive}
          />
        </Show>
      }
    >
      <Show when={state()} keyed>
        {(current) => (
          <Switch>
            <Match when={current.type === "checking"}>
              <Spinner shimmer={theme.text.base}>Checking for updates…</Spinner>
            </Match>
            <Match when={current.type === "available"}>
              <text fg={theme.text.muted}>
                An update is available. After installing, you'll be prompted to restart OpenCode.
              </text>
            </Match>
            <Match when={current.type === "installing"}>
              <Spinner shimmer={theme.text.base}>
                {current.type === "installing" ? `Installing OpenCode ${current.version}…` : ""}
              </Spinner>
            </Match>
            <Match when={current.type === "installed"}>
              <text fg={theme.text.muted} wrapMode="word">
                Update successful! Restart closes OpenCode, then run opencode to use the new version.
              </text>
            </Match>
            <Match when={current.type === "current"}>
              <text fg={theme.text.muted}>OpenCode is already up to date.</text>
            </Match>
            <Match when={current.type === "unavailable"}>
              <text fg={theme.text.muted} wrapMode="word">
                {current.type === "unavailable" ? current.message : ""}
              </text>
            </Match>
            <Match when={current.type === "failed" || current.type === "check-failed"}>
              <text fg={theme.text.feedback.error.base}>
                {current.type === "failed" || current.type === "check-failed" ? current.message : ""}
              </text>
            </Match>
          </Switch>
        )}
      </Show>
    </DialogLayout>
  )
}

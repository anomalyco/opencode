import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "../context/theme"
import type { UpdateState, UpdateTarget } from "../context/update-notification"
import { useDialog } from "../ui/dialog"
import { useBindings } from "../keymap"
import { errorMessage } from "../util/error"
import { Spinner } from "./spinner"

type Version = { current: string; latest?: string }

// OpenCode 2 is always offered; the OpenCode 1 update only appears when a newer release exists.
export function updateTargets(version: Version | undefined): UpdateTarget[] {
  const latest = version?.latest && version.latest !== version.current ? version.latest : undefined
  if (!latest) return [{ type: "major" }]
  return [{ type: "major" }, { type: "latest", version: latest }]
}

export function DialogUpdate(props: {
  check: () => Promise<Version | undefined>
  state: () => UpdateState | undefined
  install: (target: UpdateTarget) => Promise<void>
  skip: (version: string) => void
  restart: () => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal<string>()
  const [active, setActive] = createSignal(0)
  const [check] = createResource(() =>
    props.check().catch((error: unknown) => {
      setError(errorMessage(error))
      return undefined
    }),
  )

  const latest = () => updateTargets(check()).find((target) => target.type === "latest")
  const state = createMemo(() => {
    const current = props.state()
    if (current?.type === "installing" || current?.type === "installed") return current
    if (check.loading) return { type: "checking" as const }
    if (current?.type === "failed") return current
    const message = error() ?? (check()?.latest ? undefined : "Couldn't check for updates.")
    if (message) return { type: "check-failed" as const, message }
    const target = latest()
    if (target) return { type: "available" as const, version: target.version }
    return { type: "current" as const }
  })
  const buttons = createMemo(() => {
    const current = state()
    if (current.type === "checking" || current.type === "installing") return []
    if (current.type === "installed") return [skip(), { label: "Restart", run: props.restart }]
    const target = latest()
    return [
      skip(),
      { label: "OpenCode 2", run: () => props.install({ type: "major" }) },
      ...(target ? [{ label: "Update", run: () => props.install(target) }] : []),
    ]
  })

  function skip() {
    return {
      label: "Skip",
      run: () => {
        const target = latest()
        if (target && props.state()?.type !== "installed") props.skip(target.version)
        dialog.clear()
      },
    }
  }

  createEffect(() => setActive(Math.max(0, buttons().length - 1)))

  const move = (offset: number) => {
    const count = buttons().length
    if (count) setActive((value) => (value + offset + count) % count)
  }

  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Confirm update action", group: "Dialog", cmd: () => void buttons()[active()]?.run() },
      { key: "left", desc: "Previous update action", group: "Dialog", cmd: () => move(-1) },
      { key: "shift+tab", desc: "Previous update action", group: "Dialog", cmd: () => move(-1) },
      { key: "right", desc: "Next update action", group: "Dialog", cmd: () => move(1) },
      { key: "tab", desc: "Next update action", group: "Dialog", cmd: () => move(1) },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {state().type === "installing"
            ? "Updating OpenCode"
            : state().type === "available" || state().type === "failed"
              ? "Update available"
              : "Update"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1} gap={1}>
        <Show when={state()} keyed>
          {(current) => (
            <Switch>
              <Match when={current.type === "checking"}>
                <Spinner color={theme.text}>Checking for updates…</Spinner>
              </Match>
              <Match when={current.type === "available"}>
                <text fg={theme.textMuted} wrapMode="word">
                  An update is available. After installing, you'll be prompted to restart OpenCode.
                </text>
              </Match>
              <Match when={current.type === "installing" && current} keyed>
                {(installing) => (
                  <Spinner color={theme.text}>
                    {installing.target.type === "major"
                      ? "Installing OpenCode 2…"
                      : `Installing OpenCode ${installing.target.version}…`}
                  </Spinner>
                )}
              </Match>
              <Match when={current.type === "installed" && current} keyed>
                {(installed) => (
                  <text fg={theme.textMuted} wrapMode="word">
                    {installed.target.type === "major"
                      ? "Update successful! A restart is required. Run `opencode` to start OpenCode 2."
                      : "Update successful! A restart is required."}
                  </text>
                )}
              </Match>
              <Match when={current.type === "current"}>
                <text fg={theme.textMuted}>OpenCode is already up to date.</text>
              </Match>
              <Match when={(current.type === "failed" || current.type === "check-failed") && current} keyed>
                {(failed) => (
                  <text fg={theme.error} wrapMode="word">
                    {failed.message}
                  </text>
                )}
              </Match>
            </Switch>
          )}
        </Show>
        <Show when={buttons().some((button) => button.label === "OpenCode 2")}>
          <text fg={theme.textMuted} wrapMode="word">
            OpenCode 2 is also available. Upgrading installs OpenCode 2 and removes OpenCode 1.
          </text>
        </Show>
      </box>
      <Show when={buttons().length > 0}>
        <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
          <For each={buttons()}>
            {(button, index) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={active() === index() ? theme.primary : undefined}
                onMouseUp={() => void button.run()}
              >
                <text fg={active() === index() ? theme.selectedListItemText : theme.textMuted}>{button.label}</text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "../context/theme"
import type { UpdateState, UpdateTarget } from "../context/update-notification"
import { useDialog } from "../ui/dialog"
import { useBindings } from "../keymap"
import { errorMessage } from "../util/error"
import { Spinner } from "./spinner"
import { openUrl } from "@opencode-ai/core/open"

export const V2_ANNOUNCEMENT_URL = "https://anoma.ly/notes/opencode-2-0"

type Version = { current: string; latest?: string }

// A newer OpenCode 1 release uses the normal update flow; OpenCode 2.0 is only offered when OpenCode 1 is current.
export function updateTarget(version: Version): UpdateTarget {
  if (version.latest && version.latest !== version.current) return { type: "latest", version: version.latest }
  return { type: "major" }
}

export function DialogUpdate(props: {
  check: () => Promise<Version | undefined>
  state: () => UpdateState | undefined
  install: (target: UpdateTarget) => Promise<void>
  skip: (version: string) => void
  dismiss: () => void
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

  const target = () => {
    const version = check()
    if (!version?.latest) return undefined
    return updateTarget(version)
  }
  const state = createMemo(() => {
    const current = props.state()
    if (current?.type === "installing" || current?.type === "installed") return current
    if (check.loading) return { type: "checking" as const }
    if (current?.type === "failed") return current
    const next = target()
    if (!next) return { type: "check-failed" as const, message: error() ?? "Couldn't check for updates." }
    if (next.type === "major") return { type: "major" as const }
    return { type: "available" as const, version: next.version }
  })
  const buttons = createMemo(() => {
    const current = state()
    if (current.type === "checking" || current.type === "installing") return []
    const next = target()
    const close = {
      label: next?.type === "major" ? "Dismiss" : "Skip",
      run: () => {
        if (current.type !== "installed" && next?.type === "major") props.dismiss()
        if (current.type !== "installed" && next?.type === "latest") props.skip(next.version)
        dialog.clear()
      },
    }
    if (current.type === "installed") return [close, { label: "Restart", run: props.restart }]
    if (!next) return [close]
    return [close, { label: next.type === "major" ? "Upgrade" : "Update", run: () => props.install(next) }]
  })

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
            : state().type === "available" || state().type === "major" || state().type === "failed"
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
                      ? "Installing OpenCode 2.0…"
                      : `Installing OpenCode ${installing.target.version}…`}
                  </Spinner>
                )}
              </Match>
              <Match when={current.type === "installed" && current} keyed>
                {(installed) => (
                  <text fg={theme.textMuted} wrapMode="word">
                    {installed.target.type === "major"
                      ? "Update successful! A restart is required. Run `opencode` to start OpenCode 2.0."
                      : "Update successful! A restart is required."}
                  </text>
                )}
              </Match>
              <Match when={current.type === "major"}>
                <box gap={1}>
                  <box>
                    <text fg={theme.textMuted} wrapMode="word">
                      OpenCode 2.0 is the next major release.
                    </text>
                    <text
                      fg={theme.textMuted}
                      wrapMode="word"
                      onMouseUp={() => {
                        openUrl(V2_ANNOUNCEMENT_URL).catch(() => {})
                      }}
                    >
                      Read more about it:{" "}
                      <a href={V2_ANNOUNCEMENT_URL} style={{ fg: theme.primary }}>
                        {V2_ANNOUNCEMENT_URL}
                      </a>
                    </text>
                  </box>
                  <text fg={theme.textMuted} wrapMode="word">
                    It contains some breaking changes.
                  </text>
                </box>
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

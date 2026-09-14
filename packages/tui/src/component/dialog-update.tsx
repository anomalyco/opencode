import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import type { UpdateState } from "../context/update-notification"
import { useDialog } from "../ui/dialog"
import { errorMessage } from "../util/error"
import { Spinner } from "./spinner"
import { useLanguage } from "../context/language"

export function DialogUpdate(props: {
  check?: (signal: AbortSignal) => Promise<string | undefined>
  state: () => UpdateState | undefined
  skip: () => void
  install: () => Promise<void>
  restart: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const theme = useTheme("elevated")
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
    if (check.loading) return { type: "checking" as const }
    const unavailable = check()
    if (unavailable) return { type: "unavailable" as const, message: unavailable }
    const message = error()
    if (message) return { type: "check-failed" as const, message }
    return props.state() ?? { type: "current" as const }
  })
  const buttons = createMemo(() => {
    const type = state().type
    if (type === "installing") return []
    const confirm =
      type === "available"
        ? { label: language.t("tui.dialogs.update"), run: props.install }
        : type === "installed"
          ? { label: language.t("tui.dialogs.restart"), run: props.restart }
          : undefined
    return [
      {
        label: language.t("tui.dialogs.skip"),
        run: () => {
          props.skip()
          dialog.clear()
        },
      },
      ...(confirm ? [confirm] : []),
    ]
  })

  createEffect(() => setActive(Math.max(0, buttons().length - 1)))

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: language.t("tui.dialogs.confirmUpdate"),
        group: language.t("tui.dialog"),
        run: () => void buttons()[active()]?.run(),
      },
      ...["left", "right", "tab", "shift+tab"].map((bind) => ({
        bind,
        title: language.t(
          bind === "left" || bind === "shift+tab" ? "tui.dialogs.previousUpdate" : "tui.dialogs.nextUpdate",
        ),
        group: language.t("tui.dialog"),
        run: () => {
          const count = buttons().length
          if (count) setActive((value) => (value + 1) % count)
        },
      })),
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          {state().type === "available" || state().type === "installing" || state().type === "failed"
            ? language.t("tui.dialogs.updateAvailable")
            : language.t("tui.dialogs.update")}
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1}>
        <Show when={state()} keyed>
          {(current) => (
            <Switch>
              <Match when={current.type === "checking"}>
                <Spinner shimmer={theme.text.default}>{language.t("tui.dialogs.checkingUpdates")}</Spinner>
              </Match>
              <Match when={current.type === "available"}>
                <text fg={theme.text.subdued}>{language.t("tui.dialogs.updateDescription")}</text>
              </Match>
              <Match when={current.type === "installing"}>
                <Spinner shimmer={theme.text.default}>
                  {current.type === "installing"
                    ? language.t("tui.dialogs.installing", { version: current.version })
                    : ""}
                </Spinner>
              </Match>
              <Match when={current.type === "installed"}>
                <text fg={theme.text.subdued} wrapMode="word">
                  {language.t("tui.dialogs.updateSuccess")}
                </text>
              </Match>
              <Match when={current.type === "current"}>
                <text fg={theme.text.subdued}>{language.t("tui.dialogs.upToDate")}</text>
              </Match>
              <Match when={current.type === "unavailable"}>
                <text fg={theme.text.subdued} wrapMode="word">
                  {current.type === "unavailable" ? current.message : ""}
                </text>
              </Match>
              <Match when={current.type === "failed" || current.type === "check-failed"}>
                <text fg={theme.text.feedback.error.default}>
                  {current.type === "failed" || current.type === "check-failed" ? current.message : ""}
                </text>
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
                backgroundColor={active() === index() ? theme.background.action.primary.focused : undefined}
                onMouseUp={() => void button.run()}
              >
                <text fg={active() === index() ? theme.text.action.primary.focused : theme.text.subdued}>
                  {button.label}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

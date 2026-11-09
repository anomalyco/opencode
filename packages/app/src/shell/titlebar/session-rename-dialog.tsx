import { createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import {
  createSessionRenameDialogState,
  selectSessionRenameDialogView,
  transitionSessionRenameDialog,
  type SessionRenameDialogEffect,
  type SessionRenameDialogEvent,
} from "./session-rename-dialog-machine"

export function SessionRenameDialog(props: { title: string; onRename: (title: string) => Promise<void> }) {
  const language = useLanguage()

  const dialog = useDialog()

  const layer = useDialogLayer()

  const [renameState, setRenameState] = createSignal(createSessionRenameDialogState(props.title))

  const view = createMemo(() => selectSessionRenameDialogView(renameState()))

  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  let input: HTMLInputElement | undefined

  const dispatch = (event: SessionRenameDialogEvent) =>
    untrack(() => {
      const previous = renameState()
      const next = transitionSessionRenameDialog(previous, event)

      if (next.state !== previous) setRenameState(next.state)
      next.effects.forEach((effect) => void Promise.try(() => run(effect)).catch(console.error))
    })

  const run = (effect: SessionRenameDialogEffect) => {
    if (effect.type === "input.select") return input?.select()

    // The input was disabled while saving; it is enabled again only once the update renders.
    if (effect.type === "input.focus")
      return queueMicrotask(() => {
        if (input?.isConnected && !input.disabled) input.focus()
      })

    if (effect.type === "timer.clear") {
      clearTimeout(timers.get(effect.attempt))
      timers.delete(effect.attempt)

      return
    }

    // By id: once this dialog is gone, or replaced through `show`, the close closes nothing else.
    if (effect.type === "dialog.close") return dialog.close(layer?.id)

    if (effect.type === "toast.failed") {
      const fallback = language.t("common.requestFailed")

      return showToast({ title: fallback, description: effect.error ? errorMessage(effect.error, fallback) : fallback })
    }

    timers.set(
      effect.attempt,
      setTimeout(() => dispatch({ type: "save.timed-out", attempt: effect.attempt }), effect.timeoutMs),
    )
    void Promise.try(() => props.onRename(effect.title)).then(
      () => dispatch({ type: "save.succeeded", attempt: effect.attempt, title: effect.title }),
      (error) => dispatch({ type: "save.failed", attempt: effect.attempt, error }),
    )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("command.session.rename")} />
      </DialogHeader>
      <form
        class="contents"
        onSubmit={(event) => {
          event.preventDefault()
          dispatch({ type: "submitted" })
        }}
      >
        <DialogBody class="px-4">
          <TextInput
            ref={(element) => (input = element)}
            appearance="large"
            class="!w-full self-stretch"
            aria-label={language.t("command.session.rename")}
            value={view().draft}
            disabled={view().inputDisabled}
            autofocus
            autocomplete="off"
            onFocus={() => dispatch({ type: "input.focused" })}
            onInput={(event) => dispatch({ type: "input.changed", value: event.currentTarget.value })}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={view().cancelDisabled} onClick={() => dispatch({ type: "cancelled" })}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant={view().saving ? "loading" : "contrast"} disabled={!view().canSubmit}>
            <Show when={view().saving}>
              <Loader class="size-3.5 shrink-0" />
            </Show>
            {language.t("common.save")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

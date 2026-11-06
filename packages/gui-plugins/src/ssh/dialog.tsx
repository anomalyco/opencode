import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Divider } from "@opencode/ui/divider"
import { TextInput } from "@opencode/ui/text-input"
import { useDialog } from "@opencode/ui/context/dialog"
import { uuid } from "@opencode/util/uuid"
import { createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js"
import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import type { SshConfig } from "./contract"
import {
  createSshDialogState,
  transitionSshDialog,
  viewSshDialog,
  type SshDialogEffect,
  type SshDialogEvent,
  type SshDialogSnapshot,
} from "./dialog-machine"
import { sshName } from "./name"
import type { SshController } from "./state"

export { default as css } from "./ssh.css?inline"

export function DialogSsh(props: {
  ssh: SshController
  config?: SshConfig
  connect?: boolean
  promptOnly?: boolean
  /** Runs with the server id once it connects. Only the palette entry point opens a project. */
  onOpenProject?: (id: string) => void
  onConnected?: () => void
}) {
  const dialog = useDialog()
  const plugin = usePlugin()
  const ssh = props.ssh
  // Entry-point behavior is fixed for the lifetime of this dialog.
  const openProject = props.onOpenProject
  const id = props.config?.id ?? uuid()
  let cancelButton: HTMLButtonElement | undefined

  // The machine state is immutable; each transition replaces it whole.
  const [dialogState, setDialogState] = createSignal(
    createSshDialogState({ id, config: props.config, promptOnly: props.promptOnly }),
  )

  const snapshot = createMemo(
    (): SshDialogSnapshot => ({
      item: ssh.item(id),
      submitting: ssh.submitting(id),
      error: ssh.error(id),
      answeredPrompt: ssh.answeredPrompt(id),
      activeAttempt: ssh.activeAttempt(id),
    }),
  )

  const view = createMemo(() => viewSshDialog(dialogState(), snapshot()))
  // One key per prompt, so typing a response never remounts and refocuses its field.
  const prompt = createMemo(() => view().prompt, undefined, { equals: (previous, next) => previous?.id === next?.id })

  const dispatch = (event: SshDialogEvent) => {
    const previous = untrack(dialogState)
    const next = transitionSshDialog(previous, event)

    if (next.state !== previous) setDialogState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: SshDialogEffect) => {
    if (effect.type === "connect") return ssh.connect(effect.config, { dialog: true, replace: effect.replace })

    if (effect.type === "respond") return ssh.respond(id, effect.prompt, effect.value)

    if (effect.type === "cancel") return ssh.cancel(id)
    dialog.close()

    if (openProject) queueMicrotask(() => openProject(id))

    if (props.onConnected) queueMicrotask(props.onConnected)
  }

  const submit = () => dispatch({ type: "submitted", snapshot: untrack(snapshot) })
  const respond = () => dispatch({ type: "responded", snapshot: untrack(snapshot) })

  // Follows the attempt in this window and main's state for the server.
  createKeyed(snapshot, (next) => dispatch({ type: "synced", snapshot: next }))

  // Never let a focused Continue button become Trust between SSH challenges.
  createKeyed(
    () => (prompt()?.confirm ? prompt() : undefined),
    () => queueMicrotask(() => cancelButton?.focus()),
  )
  onMount(() => {
    if (props.connect) submit()
  })
  onCleanup(() => dispatch({ type: "disposed" }))

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    submit()
  }

  return (
    <Dialog fit class="settings-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>
          {view().title === "connectTo" ? plugin.t("connectTo", { host: sshName(dialogState()) }) : plugin.t("add")}
        </DialogTitle>
      </DialogHeader>
      <Divider />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <Show when={view().showForm}>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-server-dialog-label" for="ssh-target">
                {plugin.t("target")}
              </label>
              <TextInput
                id="ssh-target"
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                dir="ltr"
                value={dialogState().target}
                autofocus
                placeholder={plugin.t("placeholder")}
                spellcheck={false}
                autocomplete="off"
                disabled={view().inputsDisabled}
                invalid={!!view().error}
                onInput={(event) => dispatch({ type: "target.changed", value: event.currentTarget.value })}
                onKeyDown={keyDown}
              />
            </div>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-server-dialog-label" for="ssh-name">
                {plugin.t("form.name")}
              </label>
              <TextInput
                id="ssh-name"
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                dir="auto"
                value={dialogState().name}
                placeholder={plugin.t("form.namePlaceholder")}
                disabled={view().inputsDisabled}
                onInput={(event) => dispatch({ type: "name.changed", value: event.currentTarget.value })}
                onKeyDown={keyDown}
              />
            </div>
          </Show>
          <Show when={view().incompatible}>
            <div class="flex w-full min-w-0 flex-col gap-2" role="status" aria-live="polite">
              <span class="text-14-medium text-v2-text-text-base">{plugin.t("stage.incompatible")}</span>
              <span class="text-13-regular text-v2-text-text-muted">{plugin.t("error.version")}</span>
            </div>
          </Show>
          <Show when={prompt()} keyed>
            {(prompt) => (
              <div class="flex w-full min-w-0 flex-col gap-2">
                <pre id="ssh-prompt" class="ssh-prompt" dir="auto">
                  {prompt.text}
                </pre>
                <Show when={!prompt.confirm}>
                  <TextInput
                    id="ssh-response"
                    aria-labelledby="ssh-prompt"
                    ref={(element) =>
                      queueMicrotask(() => {
                        if (element.isConnected) element.focus()
                      })
                    }
                    type="password"
                    appearance="large"
                    class="!w-full self-stretch"
                    autofocus
                    value={view().response}
                    autocomplete="off"
                    spellcheck={false}
                    disabled={view().waiting}
                    onInput={(event) =>
                      dispatch({ type: "response.changed", prompt: prompt.id, value: event.currentTarget.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.isComposing) {
                        event.preventDefault()
                        respond()
                      }
                    }}
                  />
                </Show>
              </div>
            )}
          </Show>
          <Show when={view().error}>
            {(error) => (
              <span class="settings-server-dialog-error !leading-[var(--line-height-compact)]" role="alert">
                {plugin.t(error())}
              </span>
            )}
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          ref={(element: HTMLButtonElement) => {
            cancelButton = element
          }}
          variant="neutral"
          onClick={() => dialog.close()}
        >
          {plugin.t("common.cancel")}
        </Button>
        <Button
          variant="contrast"
          disabled={view().primary.disabled}
          onClick={() => (view().primary.action === "respond" ? respond() : submit())}
        >
          {plugin.t(view().primary.label)}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

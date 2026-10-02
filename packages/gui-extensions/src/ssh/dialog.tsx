import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Divider } from "@opencode/ui/divider"
import { TextInput } from "@opencode/ui/text-input"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createMemo, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useExtension } from "../sdk"
import type { SshConfig, SshItem } from "./contract"
import { isSshConnecting, sshName } from "./name"
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
  const extension = useExtension()
  const ssh = props.ssh
  // Entry-point behavior is fixed for the lifetime of this dialog.
  const openProject = props.onOpenProject
  const id = props.config?.id ?? crypto.randomUUID()
  let cancelButton: HTMLButtonElement | undefined
  const [state, setState] = createStore({
    target: props.config?.target ?? "",
    name: props.config?.name ?? "",
    started: !!props.promptOnly,
    prompted: !!props.promptOnly,
    response: "",
    complete: false,
  })
  const item = createMemo(() => ssh.item(id))
  const error = createMemo(() => {
    if (ssh.error(id)) return extension.t("common.requestFailed")
    const error = item()?.error
    return error ? extension.t(`error.${error}`) : undefined
  })
  const busy = createMemo(
    () => ssh.submitting(id) || (state.started && !ssh.error(id) && isSshConnecting(item()?.stage ?? "connecting")),
  )
  const prompt = createMemo<SshItem["prompt"]>((previous) => item()?.prompt ?? (busy() ? previous : undefined))
  const waiting = () => busy() || ssh.answered(id)
  const start = (replace = false) => {
    if (busy() || !state.target.trim()) return
    setState({ started: true, prompted: !!prompt() })
    ssh.connect({ id, target: state.target, name: state.name }, { dialog: true, replace })
  }
  const respond = () => {
    const current = item()?.prompt
    if (!current || waiting() || (!current.confirm && !state.response)) return
    ssh.respond(id, current.id, current.confirm ? "yes" : state.response)
  }
  createEffect(() => {
    prompt()?.id
    setState("response", "")
    if (prompt()) setState("prompted", true)
    // Never let a focused Continue button become Trust between SSH challenges.
    if (prompt()?.confirm) queueMicrotask(() => cancelButton?.focus())
  })
  createEffect(() => {
    if (!state.started || item()?.stage !== "ready" || ssh.submitting(id) || state.complete) return
    setState("complete", true)
    dialog.close()
    if (openProject) queueMicrotask(() => openProject(id))
    if (props.onConnected) queueMicrotask(props.onConnected)
  })
  onMount(() => {
    if (props.connect) start()
  })
  onCleanup(() => {
    if (state.started && !state.complete) ssh.cancel(id)
  })
  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    if (prompt()) return
    start(item()?.stage === "incompatible")
  }
  return (
    <Dialog fit class="settings-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>
          {state.prompted || props.config ? extension.t("connectTo", { host: sshName(state) }) : extension.t("add")}
        </DialogTitle>
      </DialogHeader>
      <Divider />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <Show
            when={
              !props.promptOnly && item()?.stage !== "incompatible" && (!state.prompted || (!!error() && !prompt()))
            }
          >
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-server-dialog-label" for="ssh-target">
                {extension.t("target")}
              </label>
              <TextInput
                id="ssh-target"
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                dir="ltr"
                value={state.target}
                autofocus
                placeholder={extension.t("placeholder")}
                spellcheck={false}
                autocomplete="off"
                disabled={busy() || !!prompt()}
                invalid={!!error()}
                onInput={(event) => setState("target", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-server-dialog-label" for="ssh-name">
                {extension.t("form.name")}
              </label>
              <TextInput
                id="ssh-name"
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                dir="auto"
                value={state.name}
                placeholder={extension.t("form.namePlaceholder")}
                disabled={busy() || !!prompt()}
                onInput={(event) => setState("name", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
          </Show>
          <Show when={item()?.stage === "incompatible"}>
            <div class="flex w-full min-w-0 flex-col gap-2" role="status" aria-live="polite">
              <span class="text-14-medium text-v2-text-text-base">{extension.t("stage.incompatible")}</span>
              <span class="text-13-regular text-v2-text-text-muted">{extension.t("error.version")}</span>
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
                    value={state.response}
                    autocomplete="off"
                    spellcheck={false}
                    disabled={waiting()}
                    onInput={(event) => setState("response", event.currentTarget.value)}
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
          <Show when={item()?.stage !== "incompatible" && error()}>
            {(error) => (
              <span class="settings-server-dialog-error !leading-[var(--line-height-compact)]" role="alert">
                {error()}
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
          {extension.t("common.cancel")}
        </Button>
        <Show
          when={prompt()}
          fallback={
            <Button
              variant="contrast"
              disabled={busy() || !state.target.trim()}
              onClick={() => start(item()?.stage === "incompatible")}
            >
              {busy()
                ? extension.t("stage.connecting")
                : item()?.stage === "incompatible"
                  ? extension.t("update")
                  : props.config
                    ? extension.t("connect")
                    : extension.t("form.add")}
            </Button>
          }
        >
          {(prompt) => (
            <Button variant="contrast" disabled={waiting() || (!prompt().confirm && !state.response)} onClick={respond}>
              {waiting() ? extension.t("stage.connecting") : extension.t(prompt().confirm ? "trust" : "continue")}
            </Button>
          )}
        </Show>
      </DialogFooter>
    </Dialog>
  )
}

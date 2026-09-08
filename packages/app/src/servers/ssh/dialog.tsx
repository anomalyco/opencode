import { Button } from "@opencode-ai/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/dialog"
import { Divider } from "@opencode-ai/ui/divider"
import { TextInput } from "@opencode-ai/ui/text-input"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createMemo, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Effect, Fiber } from "effect"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { useSshServers } from "./context"
import type { SshConfig, SshItem } from "./types"
import { sshName } from "./name"
import { isSshConnecting } from "./status"
import "@/settings/settings.css"
import "./ssh.css"

export function useOpenSshProject() {
  const servers = useServers()
  const picker = useDirectoryPicker()
  const tabs = useTabs()
  const language = useLanguage()
  return (id: string) => {
    const server = servers.list.find((server) => server.type === "ssh" && server.id === id)
    if (!server) return
    picker({
      server,
      title: language.t("ssh.project", { host: server.displayName || (server.type === "ssh" ? server.host : "") }),
      onSelect: (value) => {
        const directory = Array.isArray(value) ? value[0] : value
        if (!directory) return
        const key = ServerConnection.key(server)
        servers.projects.forServer(key).open(directory)
        void tabs.newDraft({ server: key, directory })
      },
    })
  }
}

export function DialogSsh(props: {
  config?: SshConfig
  connect?: boolean
  promptOnly?: boolean
  openProject?: boolean
  onConnected?: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const ssh = useSshServers()
  // Entry-point behavior is fixed for the lifetime of this dialog. Settings
  // connects without needing the project/tab contexts used by the palette.
  const openProject = props.openProject ? useOpenSshProject() : undefined
  const id = props.config?.id ?? crypto.randomUUID()
  let cancelButton: HTMLButtonElement | undefined
  const [state, setState] = createStore({
    target: props.config?.target ?? "",
    name: props.config?.name ?? "",
    started: !!props.promptOnly,
    prompted: !!props.promptOnly,
    response: "",
    answered: "",
    submitting: false,
    complete: false,
    error: false,
  })
  let task: Fiber.Fiber<void> | undefined
  const runAction = (effect: Effect.Effect<unknown, unknown>) => {
    setState({ submitting: true, error: false })
    task = Effect.runFork(
      effect.pipe(
        Effect.asVoid,
        Effect.catch(() => Effect.sync(() => setState("error", true))),
        Effect.ensuring(Effect.sync(() => setState("submitting", false))),
      ),
    )
  }
  const item = createMemo(() => ssh.data?.servers.find((item) => item.config.id === id))
  const error = createMemo(() => {
    if (state.error) return language.t("common.requestFailed")
    const error = item()?.error
    return error ? language.t(`ssh.error.${error}`) : undefined
  })
  const busy = createMemo(
    () => state.submitting || (state.started && !state.error && isSshConnecting(item()?.stage ?? "connecting")),
  )
  const prompt = createMemo<SshItem["prompt"]>((previous) => item()?.prompt ?? (busy() ? previous : undefined))
  const waiting = () => busy() || (!state.error && state.answered === prompt()?.id)
  const start = (replace = false) => {
    const api = platform.sshServers
    if (!api || busy() || !state.target.trim()) return
    setState({ started: true, prompted: !!prompt() })
    runAction(
      Effect.gen(function* () {
        yield* Effect.tryPromise(() => api.start({ id, target: state.target, name: state.name, replace }))
        yield* Effect.tryPromise(() => ssh.refetch())
      }),
    )
  }
  const respond = () => {
    const current = item()?.prompt
    const api = platform.sshServers
    if (!current || waiting() || !api || (!current.confirm && !state.response)) return
    setState("answered", current.id)
    runAction(Effect.tryPromise(() => api.respond(id, current.id, current.confirm ? "yes" : state.response)))
  }
  createEffect(() => {
    prompt()?.id
    setState("response", "")
    if (prompt()) setState("prompted", true)
    // Never let a focused Continue button become Trust between SSH challenges.
    if (prompt()?.confirm) queueMicrotask(() => cancelButton?.focus())
  })
  createEffect(() => {
    if (!state.started || item()?.stage !== "ready" || state.submitting || state.complete) return
    setState("complete", true)
    dialog.close()
    if (openProject) queueMicrotask(() => openProject(id))
    if (props.onConnected) queueMicrotask(props.onConnected)
  })
  onMount(() => {
    if (props.connect) start()
  })
  onCleanup(() => {
    const api = platform.sshServers
    const cancel = state.started && !state.complete
    const forget = !props.config && !item()?.saved
    Effect.runFork(
      Effect.gen(function* () {
        if (task) yield* Fiber.interrupt(task)
        if (!cancel || !api) return
        yield* Effect.tryPromise(() => api.cancel(id))
        if (forget) yield* Effect.tryPromise(() => api.forget(id))
      }).pipe(Effect.ignore),
    )
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
          {state.prompted || props.config
            ? language.t("ssh.connectTo", { host: sshName(state) })
            : language.t("ssh.add")}
        </DialogTitle>
      </DialogHeader>
      <Divider />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <Show when={!props.promptOnly && (!state.prompted || (!!error() && !prompt()))}>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-server-dialog-label" for="ssh-target">
                {language.t("ssh.target")}
              </label>
              <TextInput
                id="ssh-target"
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                dir="ltr"
                value={state.target}
                autofocus
                placeholder={language.t("ssh.placeholder")}
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
                {language.t("dialog.server.add.name")}
              </label>
              <TextInput
                id="ssh-name"
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                dir="auto"
                value={state.name}
                placeholder={language.t("dialog.server.add.namePlaceholder")}
                disabled={busy() || !!prompt()}
                onInput={(event) => setState("name", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
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
          <Show when={error()}>
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
          {language.t("common.cancel")}
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
                ? language.t("ssh.stage.connecting")
                : item()?.stage === "incompatible"
                  ? language.t("ssh.update")
                  : props.config
                    ? language.t("ssh.connect")
                    : language.t("dialog.server.add.button")}
            </Button>
          }
        >
          {(prompt) => (
            <Button variant="contrast" disabled={waiting() || (!prompt().confirm && !state.response)} onClick={respond}>
              {waiting()
                ? language.t("ssh.stage.connecting")
                : language.t(prompt().confirm ? "ssh.trust" : "ssh.continue")}
            </Button>
          )}
        </Show>
      </DialogFooter>
    </Dialog>
  )
}

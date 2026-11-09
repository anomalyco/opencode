import { createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import { useQueryClient } from "@tanstack/solid-query"
import type { SessionInfo } from "@opencode/client/promise"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Button } from "@opencode/ui/button"
import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { Menu } from "@opencode/ui/menu"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { sessionLabel } from "@/session/title"
import { notifySessionTabsRemoved } from "./session-events"
import {
  createSessionRenameDialogState,
  selectSessionRenameDialogView,
  transitionSessionRenameDialog,
  type SessionRenameDialogEffect,
  type SessionRenameDialogEvent,
} from "./session-rename-dialog-machine"
import "./tab-nav.css"

export function ProjectSessionRow(props: {
  server: ServerConnection.Key
  session: SessionInfo
  openTab: boolean
  active: boolean
  onOpen: () => void
}) {
  const language = useLanguage()

  const global = useGlobal()

  const dialog = useDialog()

  const queryClient = useQueryClient()

  const connection = () => global.servers.list().find((conn) => ServerConnection.key(conn) === props.server)

  const ctx = () => global.serverCtx(props.server)

  const status = useSessionTabAvatarState(
    () => props.server,
    () => props.session.id,
    () => true,
    () => props.session,
  )

  // Refreshes the title even when the dialog already stopped waiting, so a late save still shows.
  const rename = async (title: string) => {
    const current = ctx()

    if (!current) throw new Error(language.t("common.requestFailed"))
    await current.sdk.api.session.update({ sessionID: props.session.id, title })
    current.data.session.remember({ ...(current.data.session.get(props.session.id) ?? props.session), title })
    current.data.session.invalidate(props.session.id)
    void current.data.session.sync(props.session.id).catch(() => undefined)
    void queryClient.invalidateQueries({ queryKey: ["home-sessions", connection()], exact: true })
  }

  function DeleteDialog() {
    const confirm = () => {
      const current = ctx()

      const server = props.server

      dialog.close()

      if (!current) return

      const ids = sessionTreeIDs(current.data.session.list(), props.session.id)

      const conn = connection()

      queryClient.setQueryData<SessionInfo[]>(["home-sessions", conn], (sessions) =>
        sessions?.filter((session) => !ids.includes(session.id)),
      )
      void current.data.session
        .remove(props.session.id)
        .then(() => {
          notifySessionTabsRemoved({ server, directory: props.session.location.directory, sessionIDs: ids })
        })
        .catch((cause) => {
          showToast({
            title: language.t("session.delete.failed.title"),
            description: errorMessage(cause, language.t("session.delete.failed.title")),
          })
        })
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: ["home-sessions", conn], exact: true })
        })
    }

    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: sessionLabel(props.session) })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" autofocus onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm}>
            {language.t("session.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="button"
        type="button"
        data-titlebar-tab-action
        data-state={props.active ? "pressed" : undefined}
        class="relative flex h-7 w-full shrink-0 items-center gap-2 rounded-[6px] ps-8 pe-2 text-start text-[13px] leading-[var(--line-height-compact)] font-medium focus-visible:outline-none"
        classList={{ "text-v2-text-text-base": props.active, "text-v2-text-text-faint": !props.active }}
        aria-current={props.active ? "page" : undefined}
        title={sessionLabel(props.session)}
        onClick={props.onOpen}
      >
        <Show when={props.openTab}>
          <span
            role="img"
            aria-label={language.t("sidebar.organize.openTab")}
            title={language.t("sidebar.organize.openTab")}
            class="absolute start-2 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center"
          >
            <span class="size-1 rounded-full bg-v2-icon-icon-faint" />
          </span>
        </Show>
        <span class="min-w-0 flex-1 truncate" dir="auto">
          {sessionLabel(props.session)}
        </span>
        <span class="flex size-4 shrink-0 items-center justify-center">
          <Show
            when={status.loading()}
            fallback={
              <Show when={status.unread() && !props.active}>
                <span class="size-1.5 rounded-full bg-v2-text-text-base" />
              </Show>
            }
          >
            <ActivityRing width={14} height={14} />
          </Show>
        </span>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content
          onCloseAutoFocus={(event) => {
            if (dialog.active) event.preventDefault()
          }}
        >
          <Menu.Item
            disabled={!ctx()}
            onSelect={() => dialog.show(() => <RenameDialog title={sessionLabel(props.session)} onRename={rename} />)}
          >
            {language.t("common.rename")}
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item data-variant="critical" disabled={!ctx()} onSelect={() => dialog.show(() => <DeleteDialog />)}>
            {language.t("common.delete")}…
          </Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

function RenameDialog(props: { title: string; onRename: (title: string) => Promise<void> }) {
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

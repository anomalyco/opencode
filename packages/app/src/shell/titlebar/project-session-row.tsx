import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useQueryClient } from "@tanstack/solid-query"
import type { SessionInfo } from "@opencode/client/promise"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
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

  const rename = (title: string) => {
    const current = ctx()

    if (!current) return Promise.resolve(false)

    return current.sdk.api.session
      .update({ sessionID: props.session.id, title })
      .then(() => {
        current.data.session.remember({ ...(current.data.session.get(props.session.id) ?? props.session), title })
        current.data.session.invalidate(props.session.id)
        void current.data.session.sync(props.session.id).catch(() => undefined)
        void queryClient.invalidateQueries({ queryKey: ["home-sessions", connection()], exact: true })

        return true
      })
      .catch((cause) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        })

        return false
      })
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

function RenameDialog(props: { title: string; onRename: (title: string) => Promise<boolean> }) {
  const language = useLanguage()

  const dialog = useDialog()

  const [state, setState] = createStore({ title: props.title, saving: false, selected: false })

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("command.session.rename")} />
      </DialogHeader>
      <form
        class="contents"
        onSubmit={async (event) => {
          event.preventDefault()
          const title = state.title.trim()

          if (!title || state.saving) return

          if (title === props.title) return dialog.close()

          setState("saving", true)

          if (await props.onRename(title)) return dialog.close()

          setState("saving", false)
        }}
      >
        <DialogBody class="px-4">
          <TextInput
            appearance="large"
            class="!w-full self-stretch"
            aria-label={language.t("command.session.rename")}
            value={state.title}
            disabled={state.saving}
            autofocus
            autocomplete="off"
            onFocus={(event) => {
              if (state.selected) return
              setState("selected", true)
              event.currentTarget.select()
            }}
            onInput={(event) => setState("title", event.currentTarget.value)}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={state.saving} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="contrast" disabled={!state.title.trim() || state.saving}>
            {language.t("common.save")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

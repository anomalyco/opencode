import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/core/util/path"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { createMemo, Match, onMount, Switch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { sessionTitle } from "@/utils/session-title"

export function DialogArchivedSessions(props: { directory?: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const [state, setState] = createStore({
    loading: true,
    sessions: [] as Session[],
    deleting: undefined as string | undefined,
    restoring: undefined as string | undefined,
  })

  const load = async () => {
    setState("loading", true)
    const sessions = await serverSDK()
      .client.experimental.session
      .list({ directory: props.directory, roots: true, archived: true, limit: 100 })
      .then((x) => (x.data ?? []).filter((session) => !!session.time?.archived) as Session[])
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("dialog.archivedSessions.loadFailed.title"),
          description: err instanceof Error ? err.message : String(err),
        })
        return []
      })
    setState({ loading: false, sessions })
  }

  onMount(() => {
    void load()
  })

  const restore = async (session: Session) => {
    setState("restoring", session.id)
    await serverSDK()
      .client.session
      // The server accepts null to restore archived sessions; the generated SDK still narrows it to number.
      .update({ sessionID: session.id, directory: session.directory, time: { archived: null as unknown as number } })
      .then((x) => {
        const restored = x.data
        const [, setDirectoryStore] = serverSync().child(session.directory)
        if (restored) {
          setDirectoryStore(
            "session",
            produce((draft) => {
              const index = draft.findIndex((item) => item.id === restored.id)
              if (index === -1) {
                draft.push(restored)
                return
              }
              draft[index] = restored
            }),
          )
        }
        setState("sessions", (items) => items.filter((item) => item.id !== session.id))
      })
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("dialog.archivedSessions.restoreFailed.title"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setState("restoring", undefined))
  }

  const remove = async (session: Session) => {
    setState("deleting", session.id)
    await serverSDK()
      .client.session
      .delete({ sessionID: session.id, directory: session.directory })
      .then(() => {
        setState("sessions", (items) => items.filter((item) => item.id !== session.id))
        const [, setDirectoryStore] = serverSync().child(session.directory)
        setDirectoryStore("session", (items) => items.filter((item) => item.id !== session.id))
      })
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("session.delete.failed.title"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setState("deleting", undefined))
  }

  const items = createMemo(() => state.sessions)

  return (
    <Dialog title={language.t("dialog.archivedSessions.title")} class="w-full max-w-[640px] mx-auto" transition>
      <div class="flex flex-col gap-3 px-3 pb-3">
        <Switch>
          <Match when={state.loading}>
            <div class="px-3 py-8 text-center text-14-regular text-text-weak">
              {language.t("common.loading")}
            </div>
          </Match>
          <Match when={items().length === 0}>
            <div class="px-3 py-8 text-center text-14-regular text-text-weak">
              {language.t("dialog.archivedSessions.empty")}
            </div>
          </Match>
          <Match when>
            <List
              search={{ placeholder: language.t("dialog.archivedSessions.search.placeholder"), autofocus: true }}
              emptyMessage={language.t("dialog.archivedSessions.empty")}
              key={(session) => session?.id}
              items={items}
              filterKeys={["title", "id", "directory"]}
            >
              {(session) => (
                <div class="w-full flex items-center gap-3 px-1.25">
                  <div class="min-w-0 flex-1 flex flex-col">
                    <span class="truncate">{sessionTitle(session.title)}</span>
                    <span class="text-12-regular text-text-weak truncate">
                      {getFilename(session.directory)} -{" "}
                      {new Date(session.time.archived ?? session.time.updated).toLocaleString()}
                    </span>
                  </div>
                  <div class="shrink-0 flex items-center gap-1">
                    <Tooltip value={language.t("dialog.archivedSessions.restore")} placement="top">
                      <IconButton
                        icon="reset"
                        variant="ghost"
                        class="size-7 rounded-md"
                        aria-label={language.t("dialog.archivedSessions.restore")}
                        disabled={state.restoring === session.id || state.deleting === session.id}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          void restore(session)
                        }}
                      />
                    </Tooltip>
                    <Tooltip value={language.t("dialog.archivedSessions.delete")} placement="top">
                      <IconButton
                        icon="trash"
                        variant="ghost"
                        class="size-7 rounded-md"
                        aria-label={language.t("dialog.archivedSessions.delete")}
                        disabled={state.restoring === session.id || state.deleting === session.id}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (
                            !window.confirm(
                              language.t("dialog.archivedSessions.delete.confirm", {
                                name: sessionTitle(session.title),
                              }),
                            )
                          )
                            return
                          void remove(session)
                        }}
                      />
                    </Tooltip>
                  </div>
                </div>
              )}
            </List>
          </Match>
        </Switch>
        <div class="flex justify-end gap-2 px-3">
          <Button variant="ghost" size="large" onClick={() => void load()}>
            {language.t("common.refresh")}
          </Button>
          <Button variant="primary" size="large" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

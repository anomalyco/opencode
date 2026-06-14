import { createEffect, createResource, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { type GlobalSession, type Session } from "@opencode-ai/sdk/v2/client"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { errorMessage } from "@/pages/layout/helpers"
import { showToast } from "@/utils/toast"
import { getRelativeTime } from "@/utils/time"
import { buildArchivedSessionEntries, type ArchivedEntry } from "./browse-archived"

// Allocated ONCE at module scope: a never-settling promise reused while the archived list loads so
// `<List>` stays in its loading state for the whole fetch instead of flashing the empty state.
// Returning a fresh `new Promise(() => {})` from `items()` on every keystroke would leak a promise
// per call; this single shared instance avoids that.
const loadingForever: Promise<ArchivedEntry<GlobalSession>[]> = new Promise(() => {})

// Discovery dialog for archived sessions. Archived sessions span every project, so the list is
// fetched GLOBALLY (no directory scope) and selecting a row unarchives it and navigates in one
// step via the shared `unarchiveSession` semantics passed from the layout.
export function DialogArchivedSessions(props: { onUnarchive: (session: Session) => Promise<void> }) {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()

  // Fetch the global archived list ONCE when the dialog opens, then filter client-side. Passing an
  // async fetch directly to `<List items>` would re-issue this cross-project query on every keystroke
  // (the list re-invokes `items` per filter change), so we cache it in a resource instead.
  const [archived, { refetch }] = createResource(async () => {
    // `archived` lives on the experimental list endpoint (`/experimental/session`), which is the
    // GLOBAL cross-project list — exactly what discovery needs since archived sessions span every
    // project. The non-experimental `session.list` is project-scoped and omits the archived filter.
    const response = await serverSDK.client.experimental.session.list({ archived: true, roots: true })
    return buildArchivedSessionEntries(response.data ?? [], language.t("command.session.new"))
  })

  // The SDK client is `throwOnError: true`, so a failed fetch errors the resource. Surface it via the
  // sibling unarchive toast pattern, and render an explicit in-dialog error state below so the empty
  // list never masquerades as "no archived sessions". Toast exactly once per distinct error: the
  // effect also re-runs when the locale signal changes (it reads `language.t`), so guard on the error
  // reference to avoid re-toasting on a language switch while the error is still set.
  let toastedError: unknown
  createEffect(() => {
    const err = archived.error
    if (!err) {
      toastedError = undefined
      return
    }
    if (toastedError === err) return
    toastedError = err
    showToast({
      title: language.t("common.requestFailed"),
      description: errorMessage(err, language.t("common.requestFailed")),
    })
  })

  // Cached accessor for `<List>`: returns the fetched entries. The error case never reaches here —
  // `<List>` only renders inside the `<Show when={!archived.error}>` below, so the dedicated error
  // state and the toast effect are the single error surface. While the cached fetch is still in
  // flight we return a pending promise instead of a synchronous `[]`, so `useFilteredList`'s
  // `grouped` resource stays in its loading state for the whole round-trip (mirroring how
  // `dialog-select-file` drives loading from an async `items`). A synchronous `[]` would resolve
  // `grouped` on the next microtask and flash the "No archived sessions" empty state mid-fetch. The
  // pending promise never settles on its own: once the resource resolves, `archived.latest` changes,
  // this accessor re-runs with the real entries, and `grouped` refetches — abandoning the stale
  // pending promise.
  const items = () => {
    if (archived.loading) return loadingForever
    return archived.latest ?? []
  }

  const handleSelect = (entry: ArchivedEntry<GlobalSession> | undefined) => {
    if (!entry) return
    dialog.close()
    // `unarchiveSession` clears the archived timestamp and navigates to the restored session on
    // success; it rejects on failure. Surface the error and stay put (no navigation) on failure,
    // mirroring the sibling unarchive call sites.
    props.onUnarchive(entry.session).catch((err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(err, language.t("common.requestFailed")),
      })
    })
  }

  return (
    <Dialog title={language.t("dialog.archivedSessions.title")} class="pt-3 pb-0 !max-h-[480px]" transition>
      <Show
        when={!archived.error}
        fallback={
          <div class="flex flex-col items-center gap-3 px-3 py-10 text-center">
            <Icon name="bubble-5" size="small" class="text-icon-weak" />
            <span class="text-14-regular text-text-strong">{language.t("common.requestFailed")}</span>
            <Button variant="secondary" size="small" onClick={() => void refetch()}>
              {language.t("common.retry")}
            </Button>
          </div>
        }
      >
        <List
          class="px-3"
          search={{ placeholder: language.t("palette.search.placeholder"), autofocus: true, hideIcon: true }}
          emptyMessage={language.t("dialog.archivedSessions.empty")}
          loadingMessage={language.t("common.loading")}
          items={items}
          key={(entry) => entry.id}
          filterKeys={["title", "directory"]}
          onSelect={handleSelect}
        >
          {(entry) => {
            const home = serverSync.data.path.home
            const directory = home ? entry.directory.replace(home, "~") : entry.directory
            return (
              <div class="w-full flex items-center justify-between rounded-md pl-1">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <Icon name="bubble-5" size="small" class="shrink-0 text-icon-weak" />
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-14-regular text-text-strong truncate">{entry.title}</span>
                    <span class="text-14-regular text-text-weak truncate">{directory}</span>
                  </div>
                </div>
                {/* Skip the relative time for an epoch-0 archived timestamp so it doesn't render as
                    a misleading 1970 date; the row still shows title + directory. */}
                <Show when={entry.archivedAt !== 0}>
                  <span class="text-12-regular text-text-weak whitespace-nowrap ml-2">
                    {getRelativeTime(new Date(entry.archivedAt).toISOString(), language.t)}
                  </span>
                </Show>
              </div>
            )
          }}
        </List>
      </Show>
    </Dialog>
  )
}

import { DiffChanges } from "@opencode/ui/diff-changes"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { createMemo, Match, onCleanup, Show, Switch } from "solid-js"
import { createKeyed, usePlugin, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import type Details from "./index"
import { Changes } from "@opencode/plugin/gui/review"
import { ReviewDetails } from "../review/contract"

export default function SessionLocationMenu(props: { session: MountedSession; screen: SessionScreen; shown: boolean }) {
  const ctx = usePlugin<typeof Details>()
  const changes = ctx.use(Changes)
  const details = ctx.use(ReviewDetails)

  const review = createMemo(() => {
    const live = changes()

    return live.status === "active" ? live.value : undefined
  })

  const service = createMemo(() => {
    const live = details()

    return live.status === "active" ? live.value : undefined
  })

  const status = () => service()?.view(props.session).status ?? "loading"

  const rows = createMemo(() => {
    const view = service()?.view(props.session)

    return view?.status === "ready" ? view.rows : undefined
  })

  // A failed load is never a clean working tree: the row says so, and picking it loads again in place.
  const select = () => {
    if (status() === "error") return service()?.retry(props.session)

    review()?.open(props.session)
  }

  // Keep uncommitted changes fresh only while the project menu is visible.
  createKeyed(changes, (service) =>
    createKeyed(
      () => props.shown && !!props.session.project?.vcs && props.screen,
      (screen) => onCleanup(service.watch(screen, "details")),
    ),
  )

  return (
    <Show when={review() && props.session.project?.vcs}>
      <Menu.Item closeOnSelect={status() !== "error"} onSelect={select}>
        <Icon name="review" class="text-v2-icon-icon-muted" />
        <span class="flex min-w-0 items-center gap-2">
          <Switch fallback={<span class="truncate text-v2-text-text-muted">{ctx.t("loadingChanges")}</span>}>
            <Match when={status() === "error"}>
              <span class="truncate text-v2-text-text-muted">{ctx.t("changesFailed")}</span>
              <span class="shrink-0 text-v2-text-text-muted">·</span>
              <span class="shrink-0">{ctx.t("retry")}</span>
            </Match>
            <Match when={status() === "offline"}>
              <span class="truncate text-v2-text-text-muted">{ctx.t("changesOffline")}</span>
            </Match>
            <Match when={rows()}>
              {(rows) => (
                <Show
                  when={rows().length > 0}
                  fallback={<span class="truncate text-v2-text-text-muted">{ctx.t("noChanges")}</span>}
                >
                  <span class="min-w-0 truncate">{ctx.plural("ui.sessionTurn.diffs.changed", rows().length)}</span>
                  <span class="shrink-0 text-v2-text-text-muted">·</span>
                  <DiffChanges appearance="standard" changes={[...rows()]} />
                </Show>
              )}
            </Match>
          </Switch>
        </span>
      </Menu.Item>
    </Show>
  )
}

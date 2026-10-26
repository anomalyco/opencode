import { DiffChanges } from "@opencode/ui/diff-changes"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { createMemo, onCleanup, Show } from "solid-js"
import { createKeyed, useExtension, type MountedSession, type SessionScreen } from "../sdk"
import type Details from "./index"

export default function SessionLocationMenu(props: { session: MountedSession; screen: SessionScreen; shown: boolean }) {
  const ctx = useExtension<typeof Details>()
  const changes = ctx.uses.changes

  const review = createMemo(() => {
    const live = changes()

    return live.status === "active" ? live.value : undefined
  })

  // Keep uncommitted changes fresh only while the project menu is visible.
  createKeyed(changes, (service) =>
    createKeyed(
      () => props.shown && !!props.session.project?.vcs && props.screen,
      (screen) => onCleanup(service.watch(screen, "details")),
    ),
  )

  return (
    <Show when={review() && props.session.project?.vcs}>
      <Menu.Item onSelect={() => review()?.open(props.session)}>
        <Icon name="review" class="text-v2-icon-icon-muted" />
        <span class="flex min-w-0 items-center gap-2">
          <Show
            when={review()?.details(props.session)}
            fallback={<span class="truncate text-v2-text-text-muted">{ctx.t("loadingChanges")}</span>}
          >
            {(diffs) => (
              <Show
                when={diffs().length > 0}
                fallback={<span class="truncate text-v2-text-text-muted">{ctx.t("noChanges")}</span>}
              >
                <span class="min-w-0 truncate">{ctx.plural("ui.sessionTurn.diffs.changed", diffs().length)}</span>
                <span class="shrink-0 text-v2-text-text-muted">·</span>
                <DiffChanges appearance="standard" changes={[...diffs()]} />
              </Show>
            )}
          </Show>
        </span>
      </Menu.Item>
    </Show>
  )
}

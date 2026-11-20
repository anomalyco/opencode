import { createSignal, onCleanup, Show } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { displayName } from "@opencode/ui/project-avatar"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"

/** A session row's second line when List shows metadata: its project and branch, as the old Inbox rows had. */
export function SessionDetail(props: { server: string; session: SessionInfo | undefined }) {
  const global = useGlobal()
  const ctx = () => global.serverCtx(ServerConnection.Key.make(props.server))

  const project = () => {
    const session = props.session

    if (!session) return

    return displayName(ctx()?.projects.forSession(session) ?? { worktree: session.location.directory })
  }

  const branch = () => {
    const session = props.session

    if (!session) return

    return ctx()?.data.location.vcs.info(session.location)?.branch.current ?? undefined
  }

  return (
    <>
      <span dir="auto" class="min-w-0 truncate">
        {project()}
      </span>
      <Show when={branch()}>
        {(name) => (
          <span class="flex min-w-0 shrink items-center gap-1 text-v2-text-text-faint">
            <Icon name="branch" class="shrink-0 text-v2-icon-icon-muted" />
            <span dir="auto" class="min-w-0 truncate">
              {name()}
            </span>
          </span>
        )}
      </Show>
    </>
  )
}

/** How long ago a time was, compactly ("now", "5m", "2h", "3d"), as the old Inbox rows showed it. */
export function sessionAge(language: ReturnType<typeof useLanguage>, now: number, time: number) {
  const seconds = Math.max(0, Math.floor((now - time) / 1000))

  if (seconds < 60) return language.t("sidebar.inbox.time.now")

  if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

  if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

  return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
}

/** The current time, ticking once a minute. */
export function createMinuteClock() {
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 60_000)

  onCleanup(() => clearInterval(timer))

  return now
}

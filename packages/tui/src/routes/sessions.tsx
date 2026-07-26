import { createMemo, createResource, onCleanup } from "solid-js"
import path from "path"
import type { GlobalSession } from "@opencode-ai/sdk/v2"
import { DialogSelect } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useEvent } from "../context/event"
import { Locale } from "../util/locale"
import { createDebouncedSignal } from "../util/signal"

export function createSessionsListQuery(input: { search?: string }) {
  const search = input.search?.trim()
  return {
    roots: true,
    limit: search ? 30 : 100,
    ...(search ? { search } : {}),
  }
}

export function sessionsSessionOrigin(session: Pick<GlobalSession, "directory" | "project">) {
  const name = session.project?.name
  if (name) return name
  const worktree = session.project?.worktree ?? session.directory
  return worktree ? path.basename(worktree) : ""
}

export function Sessions() {
  const route = useRoute()
  const sdk = useSDK()
  const event = useEvent()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [sessions, { refetch }] = createResource(
    () => search(),
    (query) =>
      sdk.globalClient.experimental.session
        .list(createSessionsListQuery({ search: query }))
        .then((result) => result.data ?? []),
  )

  onCleanup(event.on("session.deleted", () => refetch()))

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return (sessions() ?? []).toSorted((a, b) => b.time.updated - a.time.updated).map((session) => {
      const label = new Date(session.time.updated).toDateString()
      const origin = sessionsSessionOrigin(session)
      return {
        title: session.title,
        value: session.id,
        category: label === today ? "Today" : label,
        footer: origin ? Locale.truncate(origin, 20) : "",
      }
    })
  })

  function open(sessionID: string) {
    route.navigate({ type: "session", sessionID })
  }

  return (
    <DialogSelect
      title="All Sessions"
      placeholder="Search sessions across all projects"
      options={options()}
      skipFilter={true}
      preserveSelection={true}
      onFilter={setSearch}
      onSelect={(option) => open(option.value)}
      actions={[
        {
          command: "sessions.open",
          title: "open",
          onTrigger: (option) => open(option.value),
        },
      ]}
      bindings={[{ key: "escape", desc: "Back to home", group: "Dialog", cmd: () => route.navigate({ type: "home" }) }]}
      footerHints={[
        { title: "open", label: "→" },
        { title: "back", label: "esc" },
      ]}
    />
  )
}

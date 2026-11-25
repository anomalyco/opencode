import { displayName } from "@opencode/ui/project-avatar"
import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { formatServerError } from "@/runtime/server/errors"
import { sessionLabel } from "@/session/title"
import { showToast } from "@/shell/notifications/toast"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { compareAutomations, type AutomationFilter, triggerLabel } from "./format"
import { useAutomationSource, type AutomationEntry } from "./source"

export function createAutomationsController() {
  const source = useAutomationSource()
  const tabs = useTabs()
  const layout = useLayout()
  const language = useLanguage()
  const cache = useQueryClient()

  const [state, set] = createStore<{ filter: AutomationFilter; query: string; key?: string }>({
    filter: "all",
    query: "",
  })

  const entries = createMemo(() =>
    source
      .entries()
      .map((item) => {
        const row = item.row

        // Sessions may move or be deleted. Neither the creator nor the recipient owns placement.
        const project = item.ctx.projects
          .list()
          .find(
            (project) =>
              project.id === row.projectID && (row.projectID !== "global" || project.worktree === row.directory),
          )

        const name = (id: string) => {
          const session = item.ctx.data.session.get(id)

          return session ? sessionLabel(session) : id
        }

        return {
          ...item,
          project,
          projectName: project ? displayName(project) : row.projectID,
          creator: row.sessionID && name(row.sessionID),
          recipient: row.action.type === "prompt" && row.action.to.session ? name(row.action.to.session) : undefined,
          trigger: triggerLabel(row.trigger, language.t),
        }
      })
      .toSorted((a, b) => compareAutomations(a.row, b.row)),
  )

  const counts = createMemo(() =>
    entries().reduce(
      (sum, { row }) => {
        sum.all++
        sum[row.status]++

        return sum
      },
      { all: 0, active: 0, paused: 0, done: 0 },
    ),
  )

  const filtered = createMemo(() => {
    const needle = state.query.trim().toLowerCase()

    return entries().filter(
      ({ row, trigger, projectName, creator, recipient, serverLabel }) =>
        (state.filter === "all" || state.filter === row.status) &&
        [
          row.name,
          row.id,
          trigger,
          projectName,
          row.directory,
          creator,
          recipient,
          serverLabel,
          row.trigger.type === "event" && row.trigger.server,
          row.action.type === "prompt" && row.action.prompt,
          row.action.type === "code" && row.action.code,
          row.action.type === "shell" && row.action.command,
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    )
  })

  const selected = createMemo(() => filtered().find((item) => item.key === state.key) ?? filtered()[0])
  // Pin even the default selection: pausing it may reorder the list, but must not move its inspector.
  createEffect(() => set("key", selected()?.key))
  createEffect(() => {
    const entry = selected()

    if (entry) void entry.ctx.data.location.command.sync({ directory: entry.row.directory }).catch(() => undefined)
  })

  const draftTarget = createMemo(() => {
    const entry = selected()

    if (entry) {
      const directory = entry.row.directory

      if (entry.ctx.data.location.command.list({ directory })?.some((command) => command.name === "automation"))
        return { server: entry.server, directory }

      return
    }

    const preferred = layout.home.selection().server ?? tabs.lastTarget()?.server
    const target = source.enabled().find((entry) => entry.server === preferred) ?? source.enabled()[0]

    if (target) return { server: target.server, directory: target.directories[0]! }
  })

  const change = useMutation(() => ({
    mutationFn: async (input: { entry: AutomationEntry; operation: "pause" | "resume" | "delete" }) => {
      await input.entry.ctx.sdk.api.experimental.automation[input.operation]({ automationID: input.entry.row.id })
    },
    onSuccess: (_, { entry }) =>
      cache.invalidateQueries({ queryKey: [entry.ctx.sdk.scope, "automations"], exact: true }),
    onError: (error) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t),
      })
    },
  }))

  return {
    ...source,
    entries,
    counts,
    filtered,
    selected,
    draftTarget,
    language,
    state,
    setFilter: (filter: AutomationFilter) => set("filter", filter),
    setQuery: (query: string) => set("query", query),
    select: (key: string) => set("key", key),
    busy: () => change.isPending,
    update: (entry: AutomationEntry, operation: "pause" | "resume" | "delete") => {
      if (!change.isPending) change.mutate({ entry, operation })
    },
    openSession(entry: AutomationEntry, sessionId: string) {
      const tab = tabs.addSessionTab({ server: entry.server, sessionId })
      tabs.rememberSessionRoute(tab, sessionId)
      void startTransition(() => tabs.select(tab))
    },
    openNewAutomation(prompt = "/automation ") {
      const target = draftTarget()

      if (target) void tabs.newDraft({ ...target, worktree: target.directory }, prompt)
    },
  }
}

export type AutomationItem = ReturnType<ReturnType<typeof createAutomationsController>["entries"]>[number]

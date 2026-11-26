import type { AutomationInfo } from "@opencode/client/promise"
import { createSimpleContext } from "@opencode/ui/context"
import { useQueries } from "@tanstack/solid-query"
import { createEffect, createMemo } from "solid-js"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useSettings } from "@/settings/model"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"

export const { use: useAutomationSource, provider: AutomationSourceProvider } = createSimpleContext({
  name: "AutomationSource",
  init: () => {
    const global = useGlobal()
    const servers = useServers()
    const layout = useLayout()
    const tabs = useTabs()
    const settings = useSettings()

    // With the setting off, nothing is synced or polled, so every entry point stays hidden.
    const connections = createMemo(() =>
      (settings.general.automations() ? servers.visible : []).flatMap((conn) => {
        const server = ServerConnection.key(conn)
        const ctx = global.serverCtx(server)

        if (!ctx || ctx.sdk.connection.status() !== "connected") return []
        const selected = layout.home.selection()
        const last = tabs.lastTarget()
        const route = layout.route()
        const open = route.type === "automations"

        const draft =
          route.type === "draft"
            ? tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)
            : undefined

        const active =
          route.type === "session" && route.server === server
            ? ctx.data.session.get(route.sessionId)?.location.directory
            : draft?.type === "draft" && draft.server === server
              ? draft.directory
              : undefined

        const directories = [
          ...new Set(
            [
              active,
              selected.server === server ? selected.directory : undefined,
              last?.server === server ? last.directory : undefined,
              // Each folder asked about is a location the server sets up. Outside the view, ask only
              // about the ones already open; the view itself also checks every tab and used project.
              ...(open
                ? [
                    ...tabs.store.flatMap((tab) =>
                      tab.server !== server
                        ? []
                        : tab.type === "draft"
                          ? [tab.directory]
                          : [ctx.data.session.get(tab.routeSessionId ?? tab.sessionId)?.location.directory],
                    ),
                    ...ctx.projects.used().map((p) => p.worktree),
                  ]
                : []),
            ].filter((directory): directory is string => !!directory),
          ),
        ]

        if (!directories.length && ctx.sync.data.path.home) directories.push(ctx.sync.data.path.home)

        return [{ server, ctx, directories, serverLabel: servers.label(conn) }]
      }),
    )

    // The server registers /automation only where the effective flag is on. The shared catalog also
    // handles command.updated after config changes. Older servers without the command stay hidden.
    createEffect(() => {
      for (const { ctx, directories } of connections()) {
        for (const directory of directories) void ctx.data.location.command.sync({ directory }).catch(() => undefined)
      }
    })

    const enabled = createMemo(() =>
      connections().flatMap((item) => {
        const directories = item.directories.filter((directory) =>
          item.ctx.data.location.command.list({ directory })?.some((command) => command.name === "automation"),
        )

        return directories.length ? [{ ...item, directories }] : []
      }),
    )

    // Automations are global per server; the server only drops rows whose folder turned them off.
    // Fetch it once per server, not once per project, and never use an empty list as a capability
    // signal: an empty server keeps polling only while an open folder offers /automation.
    const queries = useQueries(() => ({
      queries: connections().map((item) => {
        const open = layout.route().type === "automations"
        const offered = enabled().some((target) => target.server === item.server)
        const interval = open ? 5_000 : 30_000

        return {
          queryKey: [item.ctx.sdk.scope, "automations"] as const,
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            item.ctx.sdk.api.experimental.automation.list(undefined, { signal }),
          select: (rows: AutomationInfo[]) => () => rows,
          retry: false,
          refetchInterval: (query: { state: { data?: AutomationInfo[] } }) =>
            query.state.data?.length || offered ? interval : false,
        }
      }),
    }))

    const entries = createMemo(() =>
      connections().flatMap((item, index) => {
        const query = queries[index]

        if (!query?.isSuccess) return []

        return (query.data?.() ?? []).map((row) => ({ ...item, row, key: `${item.server}\0${row.id}` }))
      }),
    )

    return {
      enabled,
      entries,
      available: () => entries().length > 0 || enabled().length > 0,
      multiServer: () => connections().length > 1,
      loading: () => queries.some((query) => query.isPending),
      failed: () =>
        queries.some(
          (query, index) => query.isError && enabled().some((target) => target.server === connections()[index]?.server),
        ),
      active: createMemo(() => entries().filter((entry) => entry.row.status === "active").length),
    }
  },
})

export type AutomationEntry = ReturnType<ReturnType<typeof useAutomationSource>["entries"]>[number]

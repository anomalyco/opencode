import { createEffect, createMemo, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Select } from "@opencode-ai/ui/select"
import { showToast } from "@opencode-ai/ui/toast"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { LinearSyncHistory, useSyncHistory } from "@/components/linear-sync-history"
import { useLanguage } from "@/context/language"

// Workspace-scoped Linear binding (ADR-0004). The user selects a team and
// project from dropdowns populated via Linear MCP's list_teams and
// list_projects tools. The actual UUIDs (teamId, projectId) are stored
// in the binding — never slugs parsed from a URL.
type Binding = {
  teamId: string
  teamName: string
  projectId: string
  projectName?: string
  projectUrl?: string
}

type LinearTeam = { id: string; name: string; key?: string }
type LinearProject = { id: string; name: string; state?: string }

/**
 * SidebarLinear — Linear MCP integration panel.
 *
 * Renders only when the Linear MCP server is connected. Provides:
 *   - "Pull from Linear" — snapshot-import active Linear issues into the local IssueTable
 *   - "Push to Linear" — write locally-modified issues back to Linear (updates, not creates)
 *   - Linear management — team + project selectors populated via Linear MCP's
 *     list_teams and list_projects tools. The actual UUIDs are stored in the
 *     binding, never slugs parsed from a URL.
 *
 * Per ADR-0004: team/project binding is workspace-scoped, stored in
 * <workspace>/.opencode/linear-binding.json.
 */
export const SidebarLinear = (props: { directory: Accessor<string> }): JSX.Element => {
  const serverSync = useServerSync()
  const sdk = useServerSDK()
  const language = useLanguage()
  const [state, setState] = createStore({
    historyShown: false,
    mgmtShown: false,
    binding: null as Binding | null,
    bindingLoading: false,
    teams: [] as LinearTeam[],
    teamsLoading: false,
    projects: [] as LinearProject[],
    projectsLoading: false,
    selectedTeam: null as LinearTeam | null,
    selectedProject: null as LinearProject | null,
    saving: false,
  })
  const syncHist = useSyncHistory()

  const mcpStatus = createMemo(() => {
    const [store] = serverSync().child(props.directory(), { bootstrap: false })
    const mcpList = store.mcp ?? {}
    const linearMcp = mcpList["linear"]
    return linearMcp?.status === "connected"
  })

  // Trigger bootstrap so store.mcp gets populated.
  createEffect(() => {
    const directory = props.directory()
    if (!directory) return
    serverSync().child(directory, { bootstrap: true })
  })

  const configured = createMemo(() => !!state.binding?.teamId && !!state.binding?.projectId)

  const loadBinding = async () => {
    setState("bindingLoading", true)
    await sdk()
      .client.issue.linearBindingGet({ directory: props.directory() })
      .then((res: { error?: unknown; data?: unknown }) => {
        if (res.error || !res.data) {
          setState("binding", null)
          return
        }
        setState("binding", (res.data as unknown as Binding | null) ?? null)
      })
      .catch(() => {
        setState("binding", null)
      })
      .finally(() => {
        setState("bindingLoading", false)
      })
  }
  void loadBinding()

  // Management: team + project selectors. Teams are loaded from list_teams
  // when the management panel opens. Projects are loaded from list_projects
  // (filtered by the selected team) when a team is selected. The actual
  // UUIDs are stored in the binding.
  const loadTeams = async () => {
    if (state.teamsLoading) return
    setState("teamsLoading", true)
    await sdk()
      .client.issue.linearTeams({ directory: props.directory() })
      .then((res) => {
        if (!res.error && res.data) {
          setState(
            "teams",
            (res.data as unknown as LinearTeam[]).filter((t) => !!t.id && !!t.name),
          )
        }
      })
      .catch(() => {
        // keep empty list
      })
      .finally(() => {
        setState("teamsLoading", false)
      })
  }

  const loadProjects = async (teamId: string) => {
    if (state.projectsLoading) return
    setState("projectsLoading", true)
    await sdk()
      .client.issue.linearProjects({ directory: props.directory(), team: teamId })
      .then((res) => {
        if (!res.error && res.data) {
          setState(
            "projects",
            (res.data as unknown as LinearProject[]).filter((p) => !!p.id && !!p.name),
          )
        }
      })
      .catch(() => {
        // keep empty list
      })
      .finally(() => {
        setState("projectsLoading", false)
      })
  }

  const syncFromBinding = () => {
    const b = state.binding
    if (!b) {
      setState("selectedTeam", null)
      setState("selectedProject", null)
      return
    }
    setState("selectedTeam", { id: b.teamId, name: b.teamName })
    setState("selectedProject", { id: b.projectId, name: b.projectName ?? "" })
  }

  const onSelectTeam = (team: LinearTeam | undefined) => {
    const t = team ?? null
    setState("selectedTeam", t)
    setState("selectedProject", null)
    setState("projects", [])
    if (t) void loadProjects(t.id)
  }

  const handleSaveBinding = async () => {
    if (state.saving) return
    const team = state.selectedTeam
    const project = state.selectedProject
    if (!team) {
      showToast({ variant: "error", title: language.t("sidebar.linear.management.teamRequired") })
      return
    }
    if (!project) {
      showToast({ variant: "error", title: language.t("sidebar.linear.management.projectRequired") })
      return
    }
    setState("saving", true)
    await sdk()
      .client.issue.linearBindingSet({
        directory: props.directory(),
        teamId: team.id,
        teamName: team.name,
        projectId: project.id,
        projectName: project.name,
      })
      .then((res: { error?: unknown; data?: unknown }) => {
        if (res.error || !res.data) {
          const msg = (res.error as { message?: string })?.message ?? language.t("sidebar.linear.management.saveFailed")
          showToast({ variant: "error", title: msg })
          return
        }

        const newBinding = (res.data as unknown as Binding | null) ?? null
        setState("binding", newBinding)
        showToast({ variant: "success", title: language.t("sidebar.linear.management.saved") })
        setState("mgmtShown", false)
        serverSync().todo.refresh(props.directory())
      })
      .catch((e: unknown) => {
        const msg = (e as { message?: string })?.message ?? language.t("sidebar.linear.management.saveFailed")
        showToast({ variant: "error", title: msg })
      })
      .finally(() => {
        setState("saving", false)
      })
  }

  const isSyncing = syncHist.isSyncing
  const syncType = syncHist.syncType

  // When the management panel opens, sync the selectors from the current
  // binding and lazy-load the team list (if not already loaded).
  createEffect(() => {
    if (!state.mgmtShown) return
    syncFromBinding()
    if (state.teams.length === 0) void loadTeams()
  })

  const handlePull = async () => {
    if (isSyncing()) return
    syncHist.setSyncType("pull")
    syncHist.setIsSyncing(true)

    const res = await sdk()
      .client.issue.syncPull({ directory: props.directory() })
      .catch((e: unknown) => ({ error: e, data: undefined as never }))
      .finally(() => {
        syncHist.setIsSyncing(false)
        syncHist.setSyncType(null)
      })

    if (res.error) {
      syncHist.record({
        type: "pull",
        outcomes: { moved: 0, updated: 0, skipped: 0, deleted: 0, failed: 1 },
        status: "error",
        error: String(res.error),
      })
      const err = res.error as { message?: string; error?: string }
      const msg =
        err?.message ?? (typeof err?.error === "string" ? err.error : null) ?? language.t("sidebar.linear.pullFailed")
      showToast({ variant: "error", title: msg })
      return
    }

    const data = res.data as
      | { pulled: number; updated: number; skipped: number; deleted: number; failed: number }
      | undefined
    const pulled = data?.pulled ?? 0
    const updated = data?.updated ?? 0
    const skipped = data?.skipped ?? 0
    const deleted = data?.deleted ?? 0
    const failed = data?.failed ?? 0

    serverSync().todo.refresh(props.directory())

    // Per-outcome recording (ADR-0002 D9 / Amendment 2026-07-19): the entry
    // tracks each outcome separately so the UI can render "↑N ✓M ·K ✗F"
    // instead of a single opaque count. `moved` carries `pulled` for pull.
    syncHist.record({
      type: "pull",
      outcomes: { moved: pulled, updated, skipped, deleted, failed },
      status: failed > 0 ? "error" : "success",
    })

    if (failed > 0) {
      showToast({
        variant: "error",
        title: language.t("sidebar.linear.pullPartialFailed", { count: failed }),
      })
      return
    }
    const summary = language.t("sidebar.linear.pullSuccess", {
      pulled,
      updated,
      skipped,
      deleted,
    })
    showToast({ variant: "success", title: summary })
  }

  const handleSync = async () => {
    if (isSyncing()) return
    syncHist.setSyncType("push")
    syncHist.setIsSyncing(true)

    const res = await sdk()
      .client.issue.syncPush({ directory: props.directory() })
      .catch((e: unknown) => ({ error: e, data: undefined as never }))
      .finally(() => {
        syncHist.setIsSyncing(false)
        syncHist.setSyncType(null)
      })

    if (res.error) {
      syncHist.record({
        type: "push",
        outcomes: { moved: 0, updated: 0, skipped: 0, deleted: 0, failed: 1 },
        status: "error",
        error: String(res.error),
      })
      const err = res.error as { message?: string; error?: string }
      const msg =
        err?.message ?? (typeof err?.error === "string" ? err.error : null) ?? language.t("sidebar.linear.pushFailed")
      showToast({ variant: "error", title: msg })
      return
    }

    const data = res.data as
      | { pushed: number; failed: number; errors?: Array<{ id: string; message: string }> }
      | undefined
    const pushed = data?.pushed ?? 0
    const failed = data?.failed ?? 0

    serverSync().todo.refresh(props.directory())

    // Per-outcome recording (ADR-0002 D9 / Amendment 2026-07-19). For push,
    // `moved` carries `pushed`; `updated`/`skipped`/`deleted` are always 0.
    syncHist.record({
      type: "push",
      outcomes: { moved: pushed, updated: 0, skipped: 0, deleted: 0, failed },
      status: failed > 0 ? "error" : "success",
    })

    if (failed > 0) {
      const firstError = data?.errors?.[0]?.message ?? ""
      showToast({
        variant: "error",
        title: language.t("sidebar.linear.pushPartialFailed", { count: failed }),
        description: firstError || undefined,
      })
      return
    }
    if (pushed > 0) {
      showToast({
        variant: "success",
        title: language.t("sidebar.linear.pushSuccess", { count: pushed }),
      })
      return
    }
    showToast({ variant: "success", title: language.t("sidebar.linear.pushNothing") })
  }

  return (
    <Show when={mcpStatus()}>
      <div
        class="shrink-0 px-3 py-3 border-t border-border-weak-base"
        data-component="sidebar-linear"
        aria-label={language.t("sidebar.linear.title")}
      >
        {/* Section header — icon, title, connected pill, action buttons. */}
        <div class="flex items-center gap-2 mb-2">
          <Icon name="branch" size="small" class="text-icon-base shrink-0" />
          <span class="text-14-medium text-text-strong flex-1 min-w-0 truncate whitespace-nowrap">
            {language.t("sidebar.linear.title")}
          </span>
          <Show when={configured()}>
            <span
              class="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-11-medium bg-surface-success-base text-text-success shrink-0"
              aria-live="polite"
            >
              <span class="size-1.5 rounded-full bg-surface-success-strong shrink-0" />
              <span class="whitespace-nowrap">{language.t("sidebar.linear.connected")}</span>
            </span>
          </Show>
          <button
            type="button"
            class="flex items-center justify-center size-5 rounded hover:bg-surface-raised-base-hover text-text-weak disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            onClick={() => {
              if (!state.mgmtShown) syncFromBinding()
              setState("mgmtShown", (prev) => !prev)
            }}
            disabled={isSyncing()}
            aria-label={language.t("sidebar.linear.management")}
            aria-expanded={state.mgmtShown}
            title={language.t("sidebar.linear.management")}
          >
            <Icon name="settings-gear" size="small" />
          </button>
          <button
            type="button"
            class="flex items-center justify-center size-5 rounded hover:bg-surface-raised-base-hover text-text-weak disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            onClick={() => setState("historyShown", (prev) => !prev)}
            disabled={isSyncing()}
            aria-label={language.t("sidebar.linear.toggleHistory")}
            aria-expanded={state.historyShown}
          >
            <Icon name={state.historyShown ? "chevron-down" : "chevron-right"} size="small" />
          </button>
        </div>

        {/* Management section — team + project selectors.
            Teams are fetched via list_teams MCP tool; projects are fetched
            via list_projects filtered by the selected team. The actual
            UUIDs are stored in the binding. */}
        <Show when={state.mgmtShown}>
          <div class="border-t border-border-weak-base pt-2 mt-1 mb-2">
            <div class="flex flex-col gap-2">
              <div class="flex flex-col gap-1">
                <label class="text-11-medium text-text-weak">{language.t("sidebar.linear.field.team")}</label>
                <Show
                  when={!state.teamsLoading || state.teams.length > 0}
                  fallback={
                    <div class="flex items-center gap-1.5 text-11-regular text-text-weaker px-2 py-1.5 rounded-md border border-border-base bg-surface-base">
                      <Spinner class="size-3" />
                      {language.t("sidebar.linear.field.team.loading")}
                    </div>
                  }
                >
                  <Select
                    options={state.teams}
                    current={state.selectedTeam ?? undefined}
                    value={(t) => t.id}
                    label={(t) => t.name}
                    onSelect={(t) => onSelectTeam(t)}
                    variant="secondary"
                    size="normal"
                    class="w-full"
                    placeholder={language.t("sidebar.linear.field.team.placeholder")}
                  />
                </Show>
              </div>

              <div class="flex flex-col gap-1">
                <label class="text-11-medium text-text-weak">{language.t("sidebar.linear.field.project")}</label>
                <Show
                  when={state.selectedTeam}
                  fallback={
                    <div class="text-11-regular text-text-weaker px-2 py-1.5 rounded-md border border-border-base bg-surface-base">
                      {language.t("sidebar.linear.field.project.selectTeamFirst")}
                    </div>
                  }
                >
                  <Show
                    when={!state.projectsLoading || state.projects.length > 0}
                    fallback={
                      <div class="flex items-center gap-1.5 text-11-regular text-text-weaker px-2 py-1.5 rounded-md border border-border-base bg-surface-base">
                        <Spinner class="size-3" />
                        {language.t("sidebar.linear.field.project.loading")}
                      </div>
                    }
                  >
                    <Select
                      options={state.projects}
                      current={state.selectedProject ?? undefined}
                      value={(p) => p.id}
                      label={(p) => p.name}
                      onSelect={(p) => setState("selectedProject", p ?? null)}
                      variant="secondary"
                      size="normal"
                      class="w-full"
                      placeholder={language.t("sidebar.linear.field.project.placeholder")}
                    />
                  </Show>
                </Show>
              </div>

              <Button size="small" variant="primary" onClick={handleSaveBinding} disabled={state.saving}>
                <Show when={state.saving} fallback={language.t("sidebar.linear.management.save")}>
                  <span class="flex items-center gap-1.5">
                    <Spinner class="size-3" />
                    <span>{language.t("sidebar.linear.management.save")}</span>
                  </span>
                </Show>
              </Button>
            </div>
          </div>
        </Show>

        <Show
          when={configured()}
          fallback={
            <div class="flex flex-col gap-1 py-1">
              <div class="text-12-regular text-text-base">{language.t("sidebar.linear.notConfigured")}</div>
              <div class="text-11-regular text-text-weak">{language.t("sidebar.linear.notConfiguredHint")}</div>
            </div>
          }
        >
          {/* Action row — push and pull buttons share the row width equally.
              Only the triggered button shows a spinner (no text); the other
              button is merely disabled and keeps its label. */}
          <div class="flex items-center gap-2 pt-1" role="group" aria-label={language.t("sidebar.linear.actions")}>
            <Button
              class="flex-1"
              size="small"
              variant="primary"
              icon="arrow-up"
              onClick={handleSync}
              disabled={isSyncing()}
              aria-label={language.t("sidebar.linear.push")}
              title={language.t("sidebar.linear.push")}
            >
              <Show when={isSyncing() && syncType() === "push"} fallback={language.t("sidebar.linear.push")}>
                <Spinner class="size-3" />
              </Show>
            </Button>
            <Button
              class="flex-1"
              size="small"
              variant="secondary"
              icon="arrow-down-to-line"
              onClick={handlePull}
              disabled={isSyncing()}
              aria-label={language.t("sidebar.linear.pull")}
              title={language.t("sidebar.linear.pull")}
            >
              <Show when={isSyncing() && syncType() === "pull"} fallback={language.t("sidebar.linear.pull")}>
                <Spinner class="size-3" />
              </Show>
            </Button>
          </div>

          <Show when={state.historyShown}>
            <div class="border-t border-border-weak-base pt-2 mt-2">
              <LinearSyncHistory />
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  )
}

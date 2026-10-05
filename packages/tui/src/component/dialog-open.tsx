import { batch, createEffect, createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"
import type { OpenCodeEvent, SessionInfo } from "@opencode/client"
import path from "path"
import { useTerminalDimensions } from "@opentui/solid"
import { dialogWidth, useDialog } from "../ui/dialog"
import { DialogSelect, dialogSelectContentWidth, type DialogSelectRef } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useRoute } from "../context/route"
import { locationKey, useData } from "../context/data"
import { useClient } from "../context/client"
import { useLocation } from "../context/location"
import { useSessionTabs } from "../context/session-tabs"
import { useTheme } from "../context/theme"
import { Keymap } from "../context/keymap"
import { Locale } from "../util/locale"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "../context/runtime"
import { truncateFilePath } from "../ui/file-path"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { stringWidth } from "../util/string-width"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { sessionStatusGutter } from "./dialog-session-list"
import { Spinner } from "./spinner"
import { projectName } from "../util/project"

const RECENT_LIMIT = 8
export const DialogOpenKey = Symbol("DialogOpen")

type OpenTarget =
  | { type: "session"; sessionID: string }
  | { type: "project"; directory: string; projectID?: string }

type OpenView = { type: "projects" } | { type: "worktrees"; projectID: string }

type OpenSelection = { view: OpenView; filter: string; selected?: OpenTarget }

export function DialogOpen(props: { sessions: SessionInfo[]; onLoad: (sessions: SessionInfo[]) => void }) {
  const dialog = useDialog()
  const route = useRoute()
  const data = useData()
  const client = useClient()
  const location = useLocation()
  const sessionTabs = useSessionTabs()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const paths = useTuiPaths()
  const dimensions = useTerminalDimensions()
  const shortcuts = Keymap.useShortcuts()
  const [filter, setFilter] = createSignal("")
  const [selectionMoved, setSelectionMoved] = createSignal(false)
  let closed = false
  onCleanup(() => {
    closed = true
  })
  const [recent] = createResource(() => {
    // A late read must not overwrite deletion or placement facts observed in flight.
    const changed = new Map<string, Extract<OpenCodeEvent, { type: "session.deleted" | "session.moved" }>>()
    const unsubscribe = client.event.listen((message) => {
      const event = message.details
      if (event.type === "session.deleted" || event.type === "session.moved") changed.set(event.data.sessionID, event)
    })
    onCleanup(unsubscribe)
    return client.api.session
      .list({ limit: 50, order: "desc", parentID: null })
      .then((response) => {
        if (!closed)
          props.onLoad(
            response.data.flatMap((session) => {
              const event = changed.get(session.id)
              if (!event) return [session]
              if (event.type === "session.deleted") return []
              return [moveOpenSession(props.sessions.find((entry) => entry.id === session.id) ?? session, event)]
            }),
          )
        return true
      })
      .catch(() => false)
      .finally(unsubscribe)
  })
  const [projects] = createResource(() =>
    data.project.sync().then(
      () => true,
      () => false,
    ),
  )
  const [view, setView] = createSignal<OpenView>({ type: "projects" })
  const projectID = () => {
    const current = view()
    return current.type === "worktrees" ? current.projectID : undefined
  }
  const [focus, setFocus] = createSignal<OpenTarget>()
  const [creation, setCreation] = createSignal<OpenSelection>()
  const [creating, setCreating] = createSignal(false)
  let projectsSelection: OpenSelection | undefined
  let select: DialogSelectRef<OpenTarget> | undefined
  let pending: OpenSelection | undefined
  function snapshot(): OpenSelection {
    return { view: view(), filter: select?.filter ?? "", selected: select?.selected?.value }
  }
  function restore(next: OpenSelection) {
    batch(() => {
      setView(next.view)
      setSelectionMoved(false)
      setFocus(next.selected)
      select?.setFilter(next.filter)
    })
    if (next.selected) select?.moveTo(next.selected)
  }
  function back() {
    if (projectsSelection) restore(projectsSelection)
  }
  function newWorktree() {
    if (!projectID()) return
    setCreation(snapshot())
  }
  function cancelCreation() {
    pending = creation()
    setCreation(undefined)
  }
  const [worktrees, worktreeActions] = createResource(projectID, (projectID) =>
    client.api.worktree.list({ projectID }).catch((error: unknown) => {
      toast.show({ title: "Loading worktrees failed", message: errorMessage(error), variant: "error" })
      return []
    }),
  )

  const refreshed = new Set<string>()
  createEffect(() => {
    const id = projectID()
    if (!id || worktrees.latest === undefined || refreshed.has(id)) return
    refreshed.add(id)
    void client.api.worktree.refresh({ projectID: id }).catch(() => undefined)
  })
  onCleanup(
    client.event.on("worktree.updated", (event) => {
      if (event.data.projectID === projectID()) void worktreeActions.refetch()
    }),
  )

  const [matched] = createResource(
    () => {
      const value = filter().trim()
      return /^ses_[0-9A-Za-z]{26}$/.test(value) ? value : undefined
    },
    (sessionID) =>
      client.api.session
        .get({ sessionID })
        .then((session) => (session.id === sessionID ? session : undefined))
        .catch(() => undefined),
  )

  const openTabs = createMemo(
    () => new Set(sessionTabs.enabled() ? sessionTabs.tabs().map((tab) => tab.sessionID) : []),
  )
  const currentSessionID = createMemo(() =>
    route.data.type === "session" ? data.session.root(route.data.sessionID) : undefined,
  )
  const attention = (sessionID: string) => sessionTabs.status(sessionID).attention
  const sessions = createMemo(() => {
    const seen = new Set<string>()
    const match = matched()
    const list = [...data.session.list(), ...props.sessions, ...(match ? [match] : [])].filter((session) => {
      if (session.parentID || seen.has(session.id)) return false
      seen.add(session.id)
      return true
    })
    const attentionByID = new Map(list.map((session) => [session.id, Boolean(attention(session.id))]))
    return list.toSorted((a, b) => {
      const attentionA = attentionByID.get(a.id) ?? false
      const attentionB = attentionByID.get(b.id) ?? false
      if (attentionA !== attentionB) return attentionA ? -1 : 1
      return b.time.updated - a.time.updated
    })
  })

  createEffect(() => {
    const knownByID = new Map(props.sessions.map((session) => [session.id, session]))
    const active = data.session.active()
    new Map(
      [
        location.ref ?? data.location.default(),
        ...active
          .map((id) => data.session.get(id)?.location ?? knownByID.get(id)?.location)
          .filter((target) => target !== undefined),
      ].map((target) => [locationKey(target), target]),
    ).forEach((target) => {
      void data.session.permission.syncLocation(target).catch(() => undefined)
      void data.session.form.sync("global", target).catch(() => undefined)
    })
    new Set(
      [
        ...data.session.permission.sessions(),
        ...data.session.form.sessions(),
        ...(recent() === true ? active : []),
      ].map((id) => data.session.root(id)),
    ).forEach((rootID) => {
      if (!knownByID.has(rootID) && !data.session.get(rootID)) {
        void data.session.sync(rootID).catch(() => undefined)
      }
    })
  })

  const options = createMemo(() => {
    const tabs = openTabs()
    const currentID = currentSessionID()
    // With an empty query the menu shows what is not already one keystroke away: open tabs are
    // visible in the strip, so recents exclude them unless a background session is awaiting input.
    // Typing widens the pool to every session so matching a loaded tab by name still switches to it.
    const candidates = sessions().filter(
      (session) => !tabs.has(session.id) || (attention(session.id) && session.id !== currentID),
    )
    const attentionCount = candidates.filter((session) => attention(session.id)).length
    const recent = filter().trim() ? sessions() : candidates.slice(0, Math.max(RECENT_LIMIT, attentionCount))
    const sessionOptions = recent.map((session) => {
      const project = data.project.get(session.projectID)
      const name = projectName(project)
      const basename = path.basename(session.location.directory)
      const label =
        name && session.location.directory !== project?.canonical && name.toLowerCase() !== basename.toLowerCase()
          ? `${name} · ${basename}`
          : name || basename
      const state = attention(session.id)
      const running =
        !state &&
        (data.session.status(session.id) === "running" ||
          data.session.family(session.id).some((id) => data.session.status(id) === "running"))
      return {
        title: withTimestampedFallback(session),
        searchText: `${session.id} ${session.location.directory}`,
        value: { type: "session", sessionID: session.id } as OpenTarget,
        category: "Sessions",
        footer: `${label ? `${Locale.truncate(label, 30)} · ` : ""}${timeAgo(session.time.updated)}`,
        onSelect: () => location.set(session.location),
        gutter: sessionStatusGutter(
          theme,
          state,
          running,
          tabs.has(session.id) ? () => <text fg={theme.hue.accent[200]}>▪</text> : undefined,
        ),
      }
    })

    const current = location.ref ?? data.location.default()
    const projectOptions = data.project
      .list()
      .filter((project) => project.canonical !== "/")
      // Historical project identities can share a checkout. The list is newest-active first.
      .filter((project, index, projects) => projects.findIndex((item) => item.canonical === project.canonical) === index)
      .map((project) => ({ directory: project.canonical, project }))
      .map((item) => {
        const title =
          item.directory === item.project?.canonical
            ? (projectName(item.project) ?? path.basename(item.directory))
            : path.basename(item.directory)
        const footer = abbreviateHome(item.directory, paths.home)
        const git = item.project?.vcs === "git"
        const width =
          dialogSelectContentWidth(Math.min(dialogWidth("large"), dimensions().width - 2)) -
          stringWidth(title) -
          (git ? 2 : 0)
        return {
          title,
          footer: `${truncateFilePath(footer, width)}${git ? " →" : ""}`,
          searchText: `${footer} ${projectName(item.project) ?? ""}`,
          value: {
            type: "project",
            directory: item.directory,
            ...(git ? { projectID: item.project!.id } : {}),
          } as OpenTarget,
          category: "Projects",
          gutter:
            item.directory === current.directory ||
            item.directory === location.current?.project.canonical
              ? () => <text fg={theme.text.formfield.selected}>●</text>
              : undefined,
        }
      })

    return [...sessionOptions, ...projectOptions]
  })

  const worktreeOptions = createMemo(() => {
    const id = projectID()
    if (!id) return []
    const project = data.project.get(id)
    if (!project) return []
    const current = location.ref ?? data.location.default()
    const directories = [
      project.canonical,
      ...(worktrees.loading ? [] : (worktrees() ?? [])).map((worktree) => worktree.directory),
    ]
    const width = Math.max(
      0,
      dialogSelectContentWidth(Math.min(dialogWidth("large"), dimensions().width - 2)) -
        Math.max(
          ...directories.map((directory) =>
            stringWidth(
              directory === project.canonical
                ? (projectName(project) ?? path.basename(directory))
                : path.basename(directory),
            ),
          ),
        ),
    )
    return directories
      .filter((directory, index) => directories.indexOf(directory) === index)
      .toSorted((a, b) => {
        if (a === project.canonical) return -1
        if (b === project.canonical) return 1
        if (a === current.directory) return -1
        if (b === current.directory) return 1
        return 0
      })
      .map((directory) => {
        const title =
          directory === project.canonical
            ? (projectName(project) ?? path.basename(directory))
            : path.basename(directory)
        const footer = truncateFilePath(abbreviateHome(directory, paths.home), width)
        return {
          title,
          footer: footer + " ".repeat(Math.max(0, width - stringWidth(footer))),
          value: { type: "project", directory } as OpenTarget,
          gutter:
            directory === current.directory ? () => <text fg={theme.text.formfield.selected}>●</text> : undefined,
        }
      })
  })

  return (
    <box>
      <Show
        when={creation()}
        fallback={
          <DialogSelect
            ref={(value) => {
              select = value
              dialog.setSize("large")
              if (!pending) return
              const previous = pending
              pending = undefined
              restore(previous)
            }}
            title={projectID() ? `${projectName(data.project.get(projectID()!)) ?? "Project"} / Worktrees` : "Open"}
            placeholder={projectID() ? "Search worktrees…" : "Search sessions and projects…"}
            options={projectID() ? worktreeOptions() : options()}
            current={
              currentSessionID() ? ({ type: "session", sessionID: currentSessionID()! } as OpenTarget) : undefined
            }
            focusTarget={focus()}
            focusCurrent={focus() !== undefined}
            sectionNavigation={true}
            preserveSelection={selectionMoved()}
            onMove={() => {
              setSelectionMoved(true)
            }}
            onCancel={view().type === "projects" ? undefined : back}
            onFilter={setFilter}
            emptyView={
              <Show when={!recent.loading && !projects.loading}>
                <box paddingLeft={4} paddingRight={4}>
                  <text fg={theme.text.muted}>No recent sessions or projects</text>
                </box>
              </Show>
            }
            footer={
              <Show
                when={
                  projectID()
                    ? worktrees.loading
                    : recent.loading || projects.loading || recent() === false || projects() === false
                }
              >
                <box>
                  <Show when={projectID() && worktrees.loading}>
                    <Spinner color={theme.text.muted}>Loading worktrees…</Spinner>
                  </Show>
                  <Show when={!projectID() && (recent.loading || projects.loading)}>
                    <Spinner color={theme.text.muted}>Refreshing sessions and projects…</Spinner>
                  </Show>
                  <Show when={!projectID() && (recent() === false || projects() === false)}>
                    <text fg={theme.text.feedback.error.base}>
                      Could not refresh{" "}
                      {recent() === false ? (projects() === false ? "sessions and projects" : "sessions") : "projects"}.
                    </text>
                  </Show>
                </box>
              </Show>
            }
            bindings={[
              ...(!projectID()
                ? [
                    {
                      bind: "right",
                      title: "Show project worktrees",
                      group: "Dialog",
                      run: () => {
                        const target = select?.selected?.value
                        if (target?.type !== "project" || !target.projectID) return
                        projectsSelection = snapshot()
                        restore({
                          view: { type: "worktrees", projectID: target.projectID },
                          filter: "",
                          selected: {
                            type: "project",
                            directory: target.directory,
                          },
                        })
                      },
                    },
                  ]
                : []),
              ...(projectID()
                ? [
                    {
                      bind: "left",
                      title: "Return to projects",
                      group: "Dialog",
                      run: back,
                    },
                    { bind: "ctrl+n", title: "New worktree", group: "Dialog", run: newWorktree },
                  ]
                : []),
            ]}
            footerHints={[...(projectID() ? [{ title: "new worktree", label: "ctrl+n" }] : [])]}
            noMatchView={
              <box paddingLeft={4} paddingRight={4}>
                <text fg={theme.text.muted}>
                  {projectID()
                    ? worktrees.loading
                      ? "Loading worktrees…"
                      : "No matching worktrees"
                    : recent.loading || projects.loading || matched.loading
                      ? "Searching sessions and projects…"
                      : shortcuts.get("session.list")
                        ? `No matches · search all sessions with ${shortcuts.get("session.list")}`
                        : "No matches"}
                </text>
              </box>
            }
            onSelect={(option) => {
              dialog.clear()
              if (option.value.type === "session") {
                route.navigate({ type: "session", sessionID: option.value.sessionID })
                return
              }
              const target = {
                directory: option.value.directory,
              }
              route.navigate({ type: "home", location: target })
              location.set(target)
            }}
          />
        }
      >
        <DialogPrompt
          size="large"
          title={`${projectName(data.project.get(projectID()!)) ?? "Project"} / New worktree`}
          placeholder="Worktree name (optional)"
          description={() => <text fg={theme.text.muted}>Leave blank for a random name.</text>}
          busy={creating()}
          busyText="Creating worktree…"
          onCancel={cancelCreation}
          onConfirm={(value) => {
            const id = projectID()!
            const previous = creation()
            setCreating(true)
            void client.api.worktree
              .create({
                projectID: id,
                ...(value.trim() ? { name: value.trim() } : {}),
              })
              .then((created) => {
                if (closed || creation() !== previous) return
                const target = {
                  directory: created.directory,
                }
                dialog.clear()
                route.navigate({ type: "home", location: target })
                location.set(target)
              })
              .catch((error: unknown) =>
                toast.show({ title: "Creating worktree failed", message: errorMessage(error), variant: "error" }),
              )
              .finally(() => setCreating(false))
          }}
        />
      </Show>
    </box>
  )
}

export function moveOpenSession(session: SessionInfo, event: Extract<OpenCodeEvent, { type: "session.moved" }>) {
  return {
    ...session,
    location: event.data.location,
    projectID: event.data.projectID ?? session.projectID,
    subpath: event.data.subpath,
    time: { ...session.time, updated: Math.max(session.time.updated, event.created) },
  }
}

function timeAgo(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(days / 365)}y`
}

import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { batch, createMemo, createSignal, For, Show } from "solid-js"
import { DialogOpen, moveOpenSession } from "../../../component/dialog-open"
import { DialogSessionList } from "../../../component/dialog-session-list"
import { DialogSelect } from "../../../ui/dialog-select"
import { Locale } from "../../../util/locale"
import type { Story } from "./index"
import { StoryFooter } from "./footer"
import {
  PROJECT_LIST_ALIAS_PAIR,
  PROJECT_LIST_DELETED_ID,
  PROJECT_LIST_FALLBACK_DIRECTORIES,
  PROJECT_LIST_MOVED_DESTINATION,
  PROJECT_LIST_MOVED_ID,
  PROJECT_LIST_PROJECTS,
  PROJECT_LIST_QUERY_ERROR,
  PROJECT_LIST_RECENTS,
  PROJECT_LIST_SCOPES,
} from "./dialog-project-list.fixtures"

const FILTER_PRESETS = ["", "review", "tabs"] as const
const VIEWS = ["open", "sessions"] as const
type ProjectListView = (typeof VIEWS)[number]

function DialogProjectListStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  // Theme constraint: derive everything from the dialog surface, never raw theme tokens.
  const surface = props.context.theme.surface("dialog")
  const narrow = () => dimensions().width < 80

  // Local-only state: signals only, no storage, no client writes.
  const [scopeIndex, setScopeIndex] = createSignal(0)
  const [view, setView] = createSignal<ProjectListView>("open")
  const [filterIndex, setFilterIndex] = createSignal(0)
  const [queryError, setQueryError] = createSignal(false)
  const [deletedOn, setDeletedOn] = createSignal(true)
  const [movedOn, setMovedOn] = createSignal(true)
  const [note, setNote] = createSignal("local fixtures only · no db writes")

  const scope = () => PROJECT_LIST_SCOPES[scopeIndex() % PROJECT_LIST_SCOPES.length]!
  const filter = () => FILTER_PRESETS[filterIndex() % FILTER_PRESETS.length]!

  const openSessions = createMemo(() => {
    let sessions = [...PROJECT_LIST_RECENTS]
    if (deletedOn()) sessions = sessions.filter((session) => session.id !== PROJECT_LIST_DELETED_ID)
    if (movedOn()) {
      sessions = sessions.map((session) =>
        session.id === PROJECT_LIST_MOVED_ID
          ? moveOpenSession(session, {
              type: "session.moved",
              data: {
                sessionID: PROJECT_LIST_MOVED_ID,
                location: { directory: PROJECT_LIST_MOVED_DESTINATION.directory },
                projectID: PROJECT_LIST_MOVED_DESTINATION.projectID,
              },
            } as never)
          : session,
      )
    }
    const current = scope()
    if (current.id === "project") sessions = sessions.filter((session) => session.projectID === "proj-opencode")
    if (current.id === "cwd") sessions = sessions.filter((session) => session.location.directory === "/home/kit/code/opencode")
    const needle = filter().toLowerCase()
    if (needle) sessions = sessions.filter((session) => (session.title ?? "").toLowerCase().includes(needle))
    return sessions
  })

  const projectOptions = createMemo(() => {
    if (queryError()) return PROJECT_LIST_FALLBACK_DIRECTORIES.map((directory) => ({ directory, fallback: true as const }))
    const needle = filter().toLowerCase()
    return PROJECT_LIST_PROJECTS.filter((project) =>
      needle ? `${project.canonical} ${project.name ?? ""}`.toLowerCase().includes(needle) : true,
    ).map((project) => ({ directory: project.canonical, name: project.name, fallback: false as const }))
  })

  const options = createMemo(() => {
    const sessionOptions = openSessions().map((session) => ({
      title: Locale.truncate(session.title ?? "untitled", 40),
      searchText: `${session.id} ${session.location.directory}`,
      value: session.id,
      category: "Sessions",
      footer: Locale.truncate(`${session.location.directory.split("/").pop()} · ${Locale.duration(Date.now() - session.time.updated)}`, 32),
    }))
    if (view() === "sessions") return sessionOptions
    const projectRows = projectOptions().map((item) => ({
      title: Locale.truncate(item.directory.split("/").pop() ?? item.directory, 32),
      searchText: item.directory,
      value: `project:${item.directory}`,
      category: "Projects",
      footer: Locale.truncateMiddle(item.directory, 40),
    }))
    const aliasRow = {
      title: Locale.truncate(PROJECT_LIST_ALIAS_PAIR.posix.split("/").pop() ?? "opencode", 32),
      searchText: `${PROJECT_LIST_ALIAS_PAIR.windows} ${PROJECT_LIST_ALIAS_PAIR.posix}`,
      value: `project:${PROJECT_LIST_ALIAS_PAIR.posix}`,
      category: "Projects",
      footer: Locale.truncateMiddle(`${PROJECT_LIST_ALIAS_PAIR.windows} ⇄ ${PROJECT_LIST_ALIAS_PAIR.posix}`, 40),
    }
    return [...sessionOptions, ...projectRows, aliasRow]
  })

  const status = createMemo(() => {
    const parts = [
      `${Locale.number(openSessions().length)} sessions`,
      `${Locale.number(projectOptions().length)} projects`,
      scope().label,
      view(),
      deletedOn() ? "deleted applied" : "deleted off",
      movedOn() ? "moved applied" : "moved off",
    ]
    if (queryError()) parts.push("query error → fallback")
    return parts.join(" · ")
  })

  const reset = () => {
    batch(() => {
      setScopeIndex(0)
      setView("open")
      setFilterIndex(0)
      setQueryError(false)
      setDeletedOn(true)
      setMovedOn(true)
      setNote("local fixtures only · no db writes")
    })
  }

  const openLive = () => {
    if (view() === "open") {
      props.context.ui.dialog.show(() => (
        <DialogOpen sessions={[...PROJECT_LIST_RECENTS]} onLoad={() => setNote("live DialogOpen read only · fixture prop")} />
      ))
      return
    }
    props.context.ui.dialog.show(() => <DialogSessionList />)
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "ctrl+a",
        title: "Cycle scope",
        group: "Storybook",
        run: () => {
          setScopeIndex((value) => (value + 1) % PROJECT_LIST_SCOPES.length)
          setNote(`scope → ${PROJECT_LIST_SCOPES[scopeIndex() % PROJECT_LIST_SCOPES.length]!.label}`)
        },
      },
      {
        bind: "/",
        title: "Cycle filter preset",
        group: "Storybook",
        run: () => {
          setFilterIndex((value) => (value + 1) % FILTER_PRESETS.length)
          setNote(`filter → ${FILTER_PRESETS[filterIndex() % FILTER_PRESETS.length]! || "empty"}`)
        },
      },
      {
        bind: "e",
        title: "Toggle query error / fallback",
        group: "Storybook",
        run: () => {
          setQueryError((value) => !value)
          setNote(queryError() ? PROJECT_LIST_QUERY_ERROR : "query ok · project.list order")
        },
      },
      {
        bind: "r",
        title: "Reset local fixtures",
        group: "Storybook",
        run: reset,
      },
      {
        bind: "v",
        title: "Toggle open / sessions view",
        group: "Storybook",
        run: () => {
          setView((value) => (value === "open" ? "sessions" : "open"))
          setNote(`view → ${view()}`)
        },
      },
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={surface.background.base}
    >
      <box paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="column" flexShrink={0}>
        <text fg={surface.text.base}>
          {view() === "open" ? "Open" : "Sessions"} · {scope().label} · {narrow() ? "narrow" : "wide"}
        </text>
        <text fg={surface.text.muted}>
          {Locale.truncate(status(), Math.max(20, dimensions().width - 4))}
        </text>
        <Show when={queryError()}>
          <text fg={surface.text.feedback.error.base}>{Locale.truncate(PROJECT_LIST_QUERY_ERROR, 80)}</text>
        </Show>
      </box>
      <box flexGrow={1} minHeight={0} flexDirection={narrow() ? "column" : "row"}>
        <box flexGrow={1} minHeight={0} minWidth={0} flexDirection="column">
          {/* REAL shared primitive used by both production dialogs; fully fixture-driven and local-only. */}
          <DialogSelect
            title={view() === "open" ? "Open (fixture)" : "Sessions (fixture)"}
            placeholder={view() === "open" ? "Search sessions and projects…" : "Search sessions…"}
            options={options()}
            onSelect={(option) => setNote(`selected ${Locale.truncate(String(option.value), 48)}`)}
            footerHints={[{ title: "live dialog", label: "click below", side: "right" }]}
            emptyView={
              <box paddingLeft={4} paddingRight={4}>
                <text fg={surface.text.muted}>No recent sessions or projects</text>
              </box>
            }
            noMatchView={
              <box paddingLeft={4} paddingRight={4}>
                <text fg={surface.text.muted}>No matches</text>
              </box>
            }
          />
        </box>
        <box
          width={narrow() ? "100%" : 38}
          flexShrink={0}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="column"
        >
          <text fg={surface.text.base}>fixtures</text>
          <text fg={surface.text.muted}>{Locale.number(PROJECT_LIST_RECENTS.length)} recents · limit 8</text>
          <text fg={surface.text.muted}>
            {deletedOn() ? "−" : "+"} {Locale.truncate(PROJECT_LIST_DELETED_ID.slice(-6), 12)} deleted
          </text>
          <text fg={surface.text.muted}>
            {movedOn() ? "→" : "·"} {Locale.truncate(PROJECT_LIST_MOVED_ID.slice(-6), 12)} moved
          </text>
          <text fg={surface.text.muted}>
            db-only {Locale.truncateMiddle("/home/kit/code/opencode-db-only", 30)}
          </text>
          <text fg={surface.text.muted}>{Locale.truncateMiddle(PROJECT_LIST_ALIAS_PAIR.windows, 34)}</text>
          <text fg={surface.text.muted}>{Locale.truncateMiddle(PROJECT_LIST_ALIAS_PAIR.posix, 34)}</text>
          <box height={1} />
          <text fg={surface.text.base} onMouseUp={openLive}>
            open live {view() === "open" ? "DialogOpen" : "DialogSessionList"}
          </text>
          <text fg={surface.text.muted}>read only · no writes</text>
          <box height={1} />
          <For each={PROJECT_LIST_SCOPES}>
            {(item, index) => (
              <text fg={index() === scopeIndex() % PROJECT_LIST_SCOPES.length ? surface.text.base : surface.text.muted}>
                {index() === scopeIndex() % PROJECT_LIST_SCOPES.length ? "● " : "○ "}
                {item.label}
              </text>
            )}
          </For>
        </box>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / project list"
        details={[view(), scope().label, narrow() ? `${dimensions().width} narrow` : `${dimensions().width} wide`]}
        status={status()}
        message={note()}
        controls={[
          { shortcut: "ctrl+a", label: "scope" },
          { shortcut: "/", label: "filter" },
          { shortcut: "e", label: "error/fallback" },
          { shortcut: "r", label: "reset" },
          { shortcut: "v", label: "open/sessions" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const dialogProjectListStory: Story = {
  id: "dialog-project-list",
  title: "Project list",
  render: (context) => <DialogProjectListStory context={context} />,
}

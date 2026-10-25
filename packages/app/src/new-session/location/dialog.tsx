import { Badge } from "@opencode/ui/badge"
import { Dialog, DialogBody } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import {
  displayName,
  getProjectAvatarGenerated,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { TextInput } from "@opencode/ui/text-input"
import { createTypeahead } from "@opencode/ui/typeahead"
import { getFilename } from "@opencode/util/path"
import { createEffect, createMemo, createResource, For, type JSX, Match, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import type { PromptProject, PromptProjectController, PromptServer } from "@/new-session/project/selector"
import type { NewSessionWorkspaceController } from "@/new-session/workspace/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { workspaceSelectionDirectories } from "@/workspaces/paths"
import "@/shell/commands/dialog.css"
import "@/shell/palette-menu.css"
import "./dialog.css"

type LocationEntry =
  | { id: string; type: "project"; project: PromptProject }
  | { id: string; type: "add" }
  | { id: string; type: "server"; server: PromptServer }
  | { id: string; type: "workspace"; value: string; directory: string }

/**
 * Opens the new-session location dialog: one project list across every ready server, → on a Git project lists where
 * the session can run, and → on "Add project" picks the server when there are several. Search projects passes
 * `projectsOnly` for just the project list: no "Add project", no worktrees and no key hints, like the other palettes.
 */
export function useNewSessionLocationDialog(input: {
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
  onDone: () => void
}) {
  const dialog = useDialog()

  return (options?: { onWorkspace?: (value: string) => void; projectsOnly?: boolean }) => {
    void dialog.show(
      () => (
        <NewSessionLocationDialog
          project={input.project}
          workspace={input.workspace}
          onWorkspace={options?.onWorkspace}
          projectsOnly={options?.projectsOnly}
        />
      ),
      input.onDone,
    )
  }
}

function NewSessionLocationDialog(props: {
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
  onWorkspace?: (value: string) => void
  projectsOnly?: boolean
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const global = useGlobal()
  const servers = useServers()
  const serverSDK = useServerSDK()
  const [store, setStore] = createStore<{
    drilled?: PromptProject
    /** Picking the server to add a project to. */
    picking?: boolean
    query: string
    /** The projects view to restore when stepping back out of a project or the server step. */
    back?: { query: string; active: string }
  }>({ query: "" })

  const connection = (project: PromptProject) =>
    project.server ? servers.list.find((item) => ServerConnection.key(item) === project.server!.key) : serverSDK.server

  const context = (project: PromptProject) => {
    const target = connection(project)

    return target ? global.ensureServerCtx(target) : undefined
  }

  const [listed, listedActions] = createResource(
    () => store.drilled,
    async (project) => ({
      projectID: project.id,
      items:
        (await context(project)
          ?.sdk.api.worktree.list({ projectID: project.id! })
          .catch(() => undefined)) ??
        project.worktrees ??
        [],
    }),
  )
  // `latest` only skips Suspense once the resource has resolved at least once. Before that it behaves like a plain
  // read, which suspends the dialog and makes it flash on the first drill into a project.
  const listedItems = (project: PromptProject) => {
    if (listed.state !== "ready" && listed.state !== "refreshing") return project.worktrees ?? []
    const loaded = listed.latest

    return loaded?.projectID === project.id ? loaded.items : (project.worktrees ?? [])
  }

  onCleanup(
    serverSDK.event.listen((event) => {
      if (event.type === "worktree.updated" && event.data.projectID === store.drilled?.id) void listedActions.refetch()
    }),
  )

  const matches = (...values: (string | undefined)[]) => {
    const query = store.query.trim().toLowerCase()

    return !query || values.some((value) => value?.toLowerCase().includes(query))
  }

  const addEntry: LocationEntry = { id: "add", type: "add" }

  // Remote projects also match their server's name, which their tag shows. "Add project" is pinned above the list but
  // navigates last, so the first project stays the opening row and ArrowUp from it wraps to "Add project" above.
  const projectEntries = createMemo<LocationEntry[]>(() => [
    ...props.project
      .projects()
      .filter((project) => matches(displayName(project), project.worktree, tagged(project.server)?.name))
      .map((project) => ({ id: projectEntryID(project), type: "project" as const, project })),
    ...(props.projectsOnly ? [] : [addEntry]),
  ])

  const serverEntries = createMemo<LocationEntry[]>(() =>
    props.project
      .servers()
      .filter((server) => matches(server.name))
      .map((server) => ({ id: `server:${server.key}`, type: "server" as const, server })),
  )

  const workspaceEntries = createMemo<LocationEntry[]>(() => {
    const project = store.drilled

    if (!project) return []
    const directories = workspaceSelectionDirectories(project, listedItems(project))

    return [
      { id: "main", type: "workspace" as const, value: "main", directory: project.worktree },
      { id: "create", type: "workspace" as const, value: "create", directory: project.worktree },
      ...directories.map((directory) => ({
        id: `worktree:${directory}`,
        type: "workspace" as const,
        value: directory,
        directory,
      })),
    ].filter((entry) => matches(workspaceTitle(project, entry.value), entry.directory))
  })

  const entries = () => {
    if (store.drilled) return workspaceEntries()

    if (store.picking) return serverEntries()

    return projectEntries()
  }

  const pinned = () => !props.projectsOnly && !store.drilled && !store.picking

  const drillable = (project: PromptProject) => !props.projectsOnly && !!project.id && project.vcs === "git"

  const listEntries = () => entries().filter((entry) => entry.type !== "add")

  const title = () => {
    if (store.drilled) return language.t("session.new.workspace.runIn")

    if (store.picking) return language.t("session.new.location.servers")

    return language.t("home.projects")
  }

  const placeholder = () => {
    if (store.drilled) return language.t("session.new.workspace.search.placeholder")

    if (store.picking) return language.t("session.new.location.servers.search")

    return language.t("session.new.project.search")
  }

  const choosesServer = () => props.project.servers().length > 1

  // Every step opens on its first row; the user's choice holds while it stays in the results.
  const typeahead = createTypeahead<LocationEntry>({
    items: entries,
    key: (entry) => entry.id,
    onSelect: choose,
  })

  const activeEntry = typeahead.activeItem

  let resultsRef: HTMLDivElement | undefined
  let inputRef: HTMLInputElement | undefined

  createEffect(() => {
    if (!activeEntry()) return
    const frame = requestAnimationFrame(() =>
      resultsRef?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" }),
    )
    onCleanup(() => cancelAnimationFrame(frame))
  })

  function workspaceTitle(project: PromptProject, value: string) {
    if (value === "main") return getFilename(project.worktree)

    if (value === "create") return language.t("workspace.new")

    return getFilename(value)
  }

  function drill(project: PromptProject) {
    setStore({ drilled: project, query: "", back: { query: store.query, active: projectEntryID(project) } })
    inputRef?.focus()
  }

  function pick() {
    setStore({ picking: true, query: "", back: { query: store.query, active: "add" } })
    inputRef?.focus()
  }

  function back() {
    const active = store.back?.active
    setStore({ drilled: undefined, picking: undefined, query: store.back?.query ?? "", back: undefined })
    typeahead.setActive(active)
    inputRef?.focus()
  }

  function choose(entry: LocationEntry | undefined) {
    if (!entry) return

    if (entry.type === "add" && choosesServer()) {
      pick()

      return
    }

    if (entry.type === "add") {
      dialog.close()
      props.project.add()

      return
    }

    if (entry.type === "server") {
      dialog.close()
      props.project.add(entry.server.key)

      return
    }

    if (entry.type === "project") {
      props.project.select(entry.project)
      dialog.close()

      return
    }

    const project = store.drilled

    if (!project) return

    if (props.project.isSelected(project)) props.workspace.selection.set(entry.value)

    if (!props.project.isSelected(project)) props.project.select(project, entry.value)
    props.onWorkspace?.(entry.value)
    dialog.close()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const target = event.currentTarget as HTMLInputElement
    const atEnd = target.selectionStart === target.value.length && target.selectionEnd === target.value.length
    const atStart = target.selectionStart === 0 && target.selectionEnd === 0
    const active = activeEntry()

    if (event.key === "ArrowRight" && atEnd && active?.type === "project" && drillable(active.project)) {
      event.preventDefault()
      drill(active.project)

      return
    }

    if (event.key === "ArrowRight" && atEnd && active?.type === "add" && choosesServer()) {
      event.preventDefault()
      pick()

      return
    }

    if (
      (store.drilled || store.picking) &&
      ((event.key === "ArrowLeft" && atStart) || (event.key === "Backspace" && !target.value))
    ) {
      event.preventDefault()
      back()

      return
    }

    typeahead.onKeyDown(event)
  }

  const option = (entry: LocationEntry) => (
    <button
      type="button"
      id={typeahead.optionID(entry)}
      class="command-palette-row palette-menu-row"
      role="option"
      aria-selected={activeEntry()?.id === entry.id}
      data-active={activeEntry()?.id === entry.id ? "" : undefined}
      onMouseMove={(event) => {
        // Ignore hover from a static cursor when keyboard scrolling moves rows underneath it.
        if (event.movementX === 0 && event.movementY === 0) return
        typeahead.setActive(entry.id)
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => choose(entry)}
    >
      <Switch>
        <Match when={entry.type === "project" && entry}>
          {(item) => (
            <ProjectRow
              project={item().project}
              path={item().project.worktree}
              onDrill={drillable(item().project) ? () => drill(item().project) : undefined}
              drillLabel={language.t("session.new.location.worktrees")}
            />
          )}
        </Match>
        <Match when={entry.type === "add"}>
          <div class="command-palette-row-main">
            <Icon name="plus" class="command-palette-row-icon" />
            <div class="command-palette-row-text">
              <span class="command-palette-title palette-menu-title">{language.t("session.new.project.add")}</span>
            </div>
          </div>
          <Show when={choosesServer()}>
            <DrillButton label={language.t("session.new.location.servers")} onDrill={pick} />
          </Show>
        </Match>
        <Match when={entry.type === "server" && entry}>
          {(item) => (
            <div class="command-palette-row-main">
              <Icon name={serverIcon(item().server)} class="command-palette-row-icon" />
              <div class="command-palette-row-text">
                <span class="command-palette-title palette-menu-title">{item().server.name}</span>
                <Show when={item().server.hint}>
                  {(hint) => <span class="command-palette-description">{hint()}</span>}
                </Show>
              </div>
            </div>
          )}
        </Match>
        <Match when={entry.type === "workspace" && store.drilled && entry}>
          {(item) => (
            <WorkspaceRow
              title={workspaceTitle(store.drilled!, item().value)}
              value={item().value}
              description={
                item().value === "create" ? language.t("session.new.workspace.new.tooltip") : item().directory
              }
            />
          )}
        </Match>
      </Switch>
    </button>
  )

  return (
    <Dialog class="command-palette" size="large">
      <DialogBody class="command-palette-body">
        <div class="palette-menu-search">
          <TextInput
            ref={inputRef}
            value={store.query}
            autofocus
            autocomplete="off"
            spellcheck={false}
            appearance="large"
            aria-label={placeholder()}
            placeholder={placeholder()}
            leadingIcon={
              <Switch fallback={<Icon name="magnifying-glass" />}>
                <Match when={store.drilled}>
                  {(project) => (
                    <BackChip label={language.t("session.new.location.back")} onBack={back}>
                      <ProjectAvatar
                        class="shrink-0"
                        fallback={displayName(project())}
                        src={getProjectAvatarSource(project().id, project().icon)}
                        variant={getProjectAvatarVariant(project().icon?.color)}
                        generated={getProjectAvatarGenerated(project())}
                      />
                      <span class="min-w-0 truncate">{displayName(project())}</span>
                      <ServerTag server={project().server} />
                    </BackChip>
                  )}
                </Match>
                <Match when={store.picking}>
                  <BackChip label={language.t("session.new.location.back")} onBack={back}>
                    <Icon name="plus" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    <span class="min-w-0 truncate">{language.t("session.new.project.add")}</span>
                  </BackChip>
                </Match>
              </Switch>
            }
            role="combobox"
            aria-expanded="true"
            aria-controls={typeahead.listID}
            aria-activedescendant={typeahead.activeID()}
            onInput={(event) => setStore("query", event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div id={typeahead.listID} class="new-session-location-list" role="listbox">
          <Show when={pinned()}>
            <div class="new-session-location-pinned">{option(addEntry)}</div>
          </Show>
          <div class="command-palette-scroll" data-scrollable ref={(el) => (resultsRef = el)}>
            <div class="command-palette-results">
              <Show
                when={listEntries().length > 0}
                fallback={
                  // The worktree list may still be loading; hold the row's height without flashing a label.
                  <div class="command-palette-state" classList={{ invisible: !!store.drilled && listed.loading }}>
                    {language.t("palette.empty")}
                  </div>
                }
              >
                <div class="command-palette-group">
                  <div class="command-palette-group-title">{title()}</div>
                  <For each={listEntries()}>{option}</For>
                </div>
              </Show>
            </div>
          </div>
        </div>
        <Show when={!props.projectsOnly}>
          <div class="new-session-location-hints">
            <span>
              <Keybind keys={["↵"]} variant="neutral" />
              {language.t("session.new.location.select")}
            </span>
            <Show
              when={store.drilled || store.picking}
              fallback={
                <span>
                  <Keybind keys={["→"]} variant="neutral" />
                  {activeEntry()?.type === "add" && choosesServer()
                    ? language.t("session.new.location.servers")
                    : language.t("session.new.location.worktrees")}
                </span>
              }
            >
              <span>
                <Keybind keys={["←"]} variant="neutral" />
                {language.t("session.new.location.back")}
              </span>
            </Show>
          </div>
        </Show>
      </DialogBody>
    </Dialog>
  )
}

function ProjectRow(props: { project: PromptProject; path: string; onDrill?: () => void; drillLabel: string }) {
  return (
    <>
      <div class="command-palette-row-main">
        <ProjectAvatar
          class="shrink-0"
          fallback={displayName(props.project)}
          src={getProjectAvatarSource(props.project.id, props.project.icon)}
          variant={getProjectAvatarVariant(props.project.icon?.color)}
          generated={getProjectAvatarGenerated(props.project)}
        />
        <div class="command-palette-row-text">
          <span class="new-session-location-name">
            <span class="command-palette-title palette-menu-title">{displayName(props.project)}</span>
            <ServerTag server={props.project.server} />
          </span>
          <span class="command-palette-description" dir="ltr">
            {props.path}
          </span>
        </div>
      </div>
      <Show when={props.onDrill}>{(onDrill) => <DrillButton label={props.drillLabel} onDrill={onDrill()} />}</Show>
    </>
  )
}

function DrillButton(props: { label: string; onDrill: () => void }) {
  return (
    <span
      role="button"
      aria-label={props.label}
      class="new-session-location-drill"
      onClick={(event) => {
        event.stopPropagation()
        props.onDrill()
      }}
    >
      <Icon name="chevron-right" size="small" />
    </span>
  )
}

// The negative start margin cancels the chip's padding, so its icon sits where the search icon would and lines up with
// the row icons, leaving the chip the same 6px inset from the field on every side.
function BackChip(props: { label: string; onBack: () => void; children: JSX.Element }) {
  return (
    <button
      type="button"
      class="-ms-1.5 flex h-6 max-w-[280px] items-center gap-1.5 rounded-sm bg-v2-background-bg-base px-1.5 text-13-medium text-v2-text-text-base shadow-[var(--v2-elevation-raised)]"
      aria-label={props.label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onBack}
    >
      {props.children}
    </button>
  )
}

/** The server a project lives on; projects on the current server have none. */
function ServerTag(props: { server?: PromptServer }) {
  return (
    <Show when={tagged(props.server)}>
      {(server) => (
        <Badge class="new-session-location-tag" variant="subtle" title={server().label}>
          <Icon name={serverIcon(server())} size="small" />
          <span>{server().name}</span>
        </Badge>
      )}
    </Show>
  )
}

function WorkspaceRow(props: { title: string; value: string; description: string }) {
  return (
    <>
      <div class="command-palette-row-main">
        <Icon
          name={props.value === "main" ? "monitor" : props.value === "create" ? "plus" : "outline-worktree"}
          class="command-palette-row-icon"
          classList={{ "!text-v2-icon-icon-accent": props.value !== "main" && props.value !== "create" }}
        />
        <div class="command-palette-row-text">
          <span class="command-palette-title palette-menu-title">{props.title}</span>
          <span class="command-palette-description" dir="ltr">
            {props.description}
          </span>
        </div>
      </div>
    </>
  )
}

function projectEntryID(project: PromptProject) {
  return `project:${project.server?.key ?? ""}:${project.worktree}`
}

function tagged(server?: PromptServer) {
  return server?.kind === "current" ? undefined : server
}

function serverIcon(server: PromptServer) {
  if (server.kind === "current") return "monitor"

  return server.kind === "extension" ? "terminal" : "globe"
}

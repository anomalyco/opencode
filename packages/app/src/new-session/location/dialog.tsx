import { Badge } from "@opencode/ui/badge"
import { Dialog, DialogBody } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import {
  displayName,
  getProjectAvatarGenerated,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { TextInput } from "@opencode/ui/text-input"
import { createTypeahead } from "@opencode/ui/typeahead"
import { createEventListener } from "@solid-primitives/event-listener"
import { getFilename } from "@opencode/util/path"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
  untrack,
} from "solid-js"
import type { PromptProject, PromptProjectController, PromptServer } from "@/new-session/project/selector"
import type { NewSessionWorkspaceController } from "@/new-session/workspace/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useCommand } from "@/shell/commands/command"
import { workspaceSelectionDirectories } from "@/workspaces/paths"
import {
  BRANCH_PRELOAD_TIMEOUT_MS,
  INITIAL_BRANCH_PICKER_STATE,
  selectBranchBusy,
  selectBranchInitial,
  transitionBranchPicker,
  type BranchPickerEffect,
  type BranchPickerEvent,
} from "@/new-session/workspace/branch-machine"
import "@/shell/commands/dialog.css"
import "@/shell/palette-menu.css"
import "./dialog.css"
import {
  createLocationDialogState,
  locationDialogView,
  projectEntryID,
  transitionLocationDialog,
  type LocationDialogEvent,
  type LocationEntry,
} from "./machine"

/**
 * Opens the new-session location dialog: added projects across ready servers, a separate list of other server projects,
 * and the worktree destinations for each Git project. Adding a project picks the server when there are several.
 */
export function useNewSessionLocationDialog(input: {
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
  onDone: () => void
}) {
  const dialog = useDialog()

  /** Pass `project` to open straight on that project's worktree step; stepping back still reaches the projects. */
  return (options?: {
    project?: PromptProject
    step?: "worktrees" | "branches"
    base?: string
    onWorkspace?: (value: string) => void
  }) => {
    void dialog.show(
      () => (
        <NewSessionLocationDialog
          project={input.project}
          workspace={input.workspace}
          drilled={options?.project}
          step={options?.step}
          base={options?.base}
          onWorkspace={options?.onWorkspace}
        />
      ),
      input.onDone,
    )
  }
}

function NewSessionLocationDialog(props: {
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
  drilled?: PromptProject
  step?: "worktrees" | "branches"
  base?: string
  onWorkspace?: (value: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const command = useCommand()
  const global = useGlobal()
  const servers = useServers()
  const serverSDK = useServerSDK()
  const data = useData()

  const [step, setStep] = createSignal(
    createLocationDialogState(props.drilled, {
      step: props.step === "branches" ? "branches" : undefined,
      base: props.base,
    }),
  )

  const view = createMemo(() => locationDialogView(step()))
  const drilled = createMemo(() => view().drilled)

  const connection = (project: PromptProject) =>
    project.server ? servers.list.find((item) => ServerConnection.key(item) === project.server!.key) : serverSDK.server

  const context = (project: PromptProject) => {
    const target = connection(project)

    return target ? global.serverCtx(ServerConnection.key(target)) : undefined
  }

  const [listed, listedActions] = createResource(drilled, async (project) => ({
    projectID: project.id,
    items:
      (await context(project)
        ?.sdk.api.worktree.list({ projectID: project.id! })
        .catch(() => undefined)) ??
      project.worktrees ??
      [],
  }))

  // `latest` only skips Suspense once the resource has resolved at least once. Before that it behaves like a plain
  // read, which suspends the dialog and makes it flash on the first drill into a project.
  const listedItems = (project: PromptProject) => {
    if (listed.state !== "ready" && listed.state !== "refreshing") return project.worktrees ?? []
    const loaded = listed.latest

    return loaded?.projectID === project.id ? loaded.items : (project.worktrees ?? [])
  }

  onCleanup(
    serverSDK.event.listen((event) => {
      if (event.type === "worktree.updated" && event.data.projectID === drilled()?.id) void listedActions.refetch()
    }),
  )

  const matches = (...values: (string | undefined)[]) => {
    const query = step().query.trim().toLowerCase()

    return !query || values.some((value) => value?.toLowerCase().includes(query))
  }

  // Only the current server's checkouts have a synced branch.
  const checkout = (project: PromptProject) =>
    tagged(project.server) ? undefined : data.location.vcs.info({ directory: project.worktree })?.branch.current

  const projectBranch = (project: PromptProject) =>
    context(project)?.data.location.vcs.info({ directory: project.worktree })?.branch.current

  const baseBranch = (project: PromptProject) => {
    const state = step()

    return (state.type === "worktrees" ? state.base : undefined) ?? projectBranch(project)
  }

  // Load the drilled project's branch for its base-branch row; the worktree step can show it before a list loads.
  createEffect(() => {
    const project = drilled()
    const target = project && context(project)

    if (!project?.id || !target) return
    void target.data.location.vcs.sync({ directory: project.worktree }).catch(() => undefined)
  })

  const [picker, setPicker] = createSignal(INITIAL_BRANCH_PICKER_STATE)

  const requests = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const dispatchPicker = (event: BranchPickerEvent) =>
    untrack(() => {
      const next = transitionBranchPicker(picker(), event)
      setPicker(next.state)
      next.effects.forEach(runPicker)
    })

  const runPicker = (effect: BranchPickerEffect) => {
    if (effect.type === "focus.composer" || effect.type === "branch.choose") return

    if (effect.type === "branches.abort") {
      const request = requests.get(effect.attempt)
      requests.delete(effect.attempt)
      clearTimeout(request?.timer)
      request?.controller.abort()

      return
    }

    const state = step()
    const target = state.type === "branches" ? context(state.project) : undefined
    const directory = state.type === "branches" ? state.project.worktree : undefined

    if (!target || !directory) return

    const attempt = effect.attempt
    const controller = new AbortController()
    const timer = setTimeout(() => dispatchPicker({ type: "branches.timed-out", attempt }), BRANCH_PRELOAD_TIMEOUT_MS)
    requests.set(attempt, { controller, timer })
    target.sdk.api.vcs.branch
      .list({ location: { directory }, search: "", limit: 50 }, { signal: controller.signal })
      .then(
        (response) => settlePicker(attempt, controller, { type: "branches.loaded", attempt, items: response.data }),
        () => settlePicker(attempt, controller, { type: "branches.failed", attempt }),
      )
  }

  const settlePicker = (attempt: number, controller: AbortController, event: BranchPickerEvent) => {
    if (controller.signal.aborted) return
    clearTimeout(requests.get(attempt)?.timer)
    requests.delete(attempt)
    dispatchPicker(event)
  }

  // The branch step is always open; entering it preloads the list and leaving drops any request.
  createEffect(() => {
    const state = step()
    dispatchPicker({
      type: "target.changed",
      directory: state.type === "branches" ? state.project.worktree : undefined,
    })
  })

  createEffect(() => {
    if (step().type !== "branches") return
    dispatchPicker({ type: "open.change", open: true })
  })

  // A query searches the drilled project on the server; the previous search aborts as soon as it changes.
  createEffect(() => {
    const state = step()

    if (state.type !== "branches") return
    const target = context(state.project)

    if (!target) return

    const controller = new AbortController()
    onCleanup(() => controller.abort())
    target.sdk.api.vcs.branch
      .list(
        { location: { directory: state.project.worktree }, search: state.query, limit: 50 },
        { signal: controller.signal },
      )
      .then(
        (response) => {
          if (controller.signal.aborted) return
          dispatchPicker({ type: "branches.synced", directory: state.project.worktree, items: response.data })
        },
        () => undefined,
      )
  })

  onCleanup(() => dispatchPicker({ type: "disposed" }))

  const otherCount = createMemo(() => props.project.projects().filter((project) => !project.used).length)

  const projectEntries = createMemo<LocationEntry[]>(() => {
    const others = step().type === "others"
    const query = step().query.trim()

    return [
      ...props.project
        .projects()
        .filter((project) => (others ? !project.used : project.used || !!query))
        // Remote projects also match their server's name, which their tag shows.
        .filter((project) => matches(displayName(project), project.worktree, tagged(project.server)?.name))
        .map((project) => ({ id: projectEntryID(project), type: "project" as const, project })),
      ...(!others
        ? [
            ...(!query && otherCount() ? [{ id: "other", type: "other" as const }] : []),
            { id: "add", type: "add" as const },
          ]
        : []),
    ]
  })

  const firstOther = createMemo(
    () => projectEntries().find((entry) => entry.type === "project" && !entry.project.used)?.id,
  )

  const serverEntries = createMemo<LocationEntry[]>(() =>
    props.project
      .servers()
      .filter((server) => matches(server.name))
      .map((server) => ({ id: `server:${server.key}`, type: "server" as const, server })),
  )

  const workspaceEntries = createMemo<LocationEntry[]>(() => {
    const project = drilled()

    if (!project) return []
    const directories = workspaceSelectionDirectories(project, listedItems(project))

    return (
      [
        { id: "main", type: "workspace" as const, project, value: "main", directory: project.worktree },
        { id: "create", type: "workspace" as const, project, value: "create", directory: project.worktree },
        ...(project.vcs === "git" ? [{ id: "base", type: "base" as const, project, directory: project.worktree }] : []),
        ...directories.map((directory) => ({
          id: `worktree:${directory}`,
          type: "workspace" as const,
          project,
          value: directory,
          directory,
        })),
      ] satisfies LocationEntry[]
    ).filter((entry) =>
      entry.type === "base"
        ? matches(baseBranch(project) ?? language.t("session.location.noBranch"), entry.directory)
        : matches(
            workspaceTitle(project, entry.value),
            entry.directory,
            entry.value === "main" ? checkout(project) : undefined,
          ),
    )
  })

  const branchEntries = createMemo<LocationEntry[]>(() => {
    const initial = selectBranchInitial(picker())

    if (!initial) return []

    return initial.items
      .filter((branch) => matches(branch))
      .map((branch) => ({ id: `branch:${branch}`, type: "branch" as const, branch }))
  })

  const entries = () => {
    const type = step().type

    if (type === "worktrees") return workspaceEntries()

    if (type === "branches") return branchEntries()

    if (type === "servers") return serverEntries()

    return projectEntries()
  }

  const drillable = (project: PromptProject) => !!project.id && project.vcs === "git"

  const title = () => {
    const key = view().titleKey

    return key ? language.t(key) : undefined
  }

  const placeholder = () => language.t(view().placeholderKey)

  const choosesServer = () => props.project.servers().length > 1
  command.register("new-session-location", () => [
    {
      id: "project.open",
      title: language.t("command.project.open"),
      category: language.t("command.category.project"),
      keybind: "mod+o",
      onSelect: () => choose({ id: "add", type: "add" }),
    },
  ])
  createEventListener(document, "keydown", (event) => {
    if (event.isComposing || !command.matches("project.open", event)) return
    event.preventDefault()
    event.stopPropagation()
    command.trigger("project.open", "keybind")
  })

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
    if (value === "main") return displayName(project)

    if (value === "create") return language.t("workspace.new")

    return getFilename(value)
  }

  function dispatch(event: LocationDialogEvent) {
    const next = transitionLocationDialog(step(), event)
    setStep(next.state)
    next.effects.forEach((effect) => {
      if (effect.type === "focus") {
        typeahead.setActive(effect.active)
        inputRef?.focus()

        return
      }

      if (effect.type === "project.add") {
        dialog.close()
        props.project.add(effect.server)

        return
      }

      if (effect.type === "project.select") {
        props.project.select(effect.project)
        dialog.close()

        return
      }

      if (effect.type === "workspace.select") {
        if (props.project.isSelected(effect.project)) props.workspace.selection.set(effect.value)

        if (!props.project.isSelected(effect.project)) props.project.select(effect.project, effect.value)

        if (effect.branch) props.workspace.selection.branch(effect.branch)
        props.onWorkspace?.(effect.value)
      }

      dialog.close()
    })

    return next
  }

  function choose(entry: LocationEntry | undefined) {
    if (!entry) return
    dispatch({ type: "chosen", entry, active: activeEntry()?.id, choosesServer: choosesServer() })
  }

  const drill = (project: PromptProject) => dispatch({ type: "drilled", project })

  const back = () => dispatch({ type: "back" })

  const handleKeyDown = (event: KeyboardEvent) => {
    // SAFETY: this handler is only attached to the search TextInput's <input>, so currentTarget is that element.
    const target = event.currentTarget as HTMLInputElement
    const active = activeEntry()

    const next = dispatch({
      type: "key.down",
      key: event.key,
      direction: language.direction(),
      atStart: target.selectionStart === 0 && target.selectionEnd === 0,
      atEnd: target.selectionStart === target.value.length && target.selectionEnd === target.value.length,
      active,
      choosesServer: choosesServer(),
      drillable: active?.type === "project" && drillable(active.project),
    })

    if (!next.handled) return typeahead.onKeyDown(event)
    event.preventDefault()

    if (next.stop) event.stopPropagation()
  }

  return (
    <Dialog class="command-palette new-session-location" size="large">
      <DialogBody class="command-palette-body">
        <div class="palette-menu-search">
          <TextInput
            ref={inputRef}
            value={step().query}
            autofocus
            autocomplete="off"
            spellcheck={false}
            appearance="large"
            aria-label={placeholder()}
            placeholder={placeholder()}
            leadingIcon={<Icon name="magnifying-glass" />}
            role="combobox"
            aria-expanded="true"
            aria-busy={step().type === "branches" && selectBranchBusy(picker()) ? "true" : undefined}
            data-owns-escape={view().ownsEscape ? "" : undefined}
            aria-controls={typeahead.listID}
            aria-activedescendant={typeahead.activeID()}
            onInput={(event) => dispatch({ type: "query.changed", query: event.currentTarget.value })}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div class="new-session-location-divider" aria-hidden="true" />
        <MenuScroll
          class="min-h-0 flex-1"
          viewportClass="command-palette-scroll"
          viewportRef={(el) => (resultsRef = el)}
        >
          <div id={typeahead.listID} class="command-palette-results" role="listbox">
            <div class="command-palette-group">
              <Show when={title()}>
                {(value) => (
                  <button
                    type="button"
                    class="command-palette-group-title new-session-location-back"
                    aria-label={language.t("session.new.location.back")}
                    onClick={back}
                  >
                    {value()}
                  </button>
                )}
              </Show>
              <Show
                when={entries().length > 0}
                fallback={
                  // The worktree list may still be loading; hold the row's height without flashing a label.
                  <div
                    class="command-palette-state"
                    classList={{
                      invisible:
                        (!!drilled() && listed.loading) || (step().type === "branches" && selectBranchBusy(picker())),
                    }}
                  >
                    {language.t("palette.empty")}
                  </div>
                }
              >
                <For each={entries()}>
                  {(entry, index) => (
                    <>
                      <Show when={view().otherGroupHeader && entry.id === firstOther()}>
                        <div class="command-palette-group-title">
                          {language.t("session.new.location.otherProjects")}
                        </div>
                      </Show>
                      <Show
                        when={
                          index() > 0 &&
                          (entry.type === "add" ||
                            (entry.type === "workspace" &&
                              entry.value !== "main" &&
                              entry.value !== "create" &&
                              ["main", "create", "base"].includes(entries()[index() - 1]!.id)))
                        }
                      >
                        <div class="new-session-location-action-divider" role="separator" />
                      </Show>
                      <button
                        type="button"
                        id={typeahead.optionID(entry)}
                        class="command-palette-row palette-menu-row"
                        data-size="compact"
                        classList={{
                          "new-session-location-option": entry.type === "other" || entry.type === "add",
                          "new-session-location-workspace": entry.type === "workspace",
                        }}
                        role="option"
                        aria-selected={activeEntry()?.id === entry.id}
                        data-active={activeEntry()?.id === entry.id ? "" : undefined}
                        onMouseMove={(event) => {
                          // Ignore hover from a static cursor when keyboard scrolling moves rows underneath it.
                          if (event.movementX === 0 && event.movementY === 0) return
                          typeahead.setActive(entry.id)
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                        onFocus={() => typeahead.setActive(entry.id)}
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
                          <Match when={entry.type === "other"}>
                            <div class="command-palette-row-main new-session-location-other">
                              <Icon name="menu" class="command-palette-row-icon" />
                              <span class="command-palette-title palette-menu-title">
                                {language.t("session.new.location.otherProjects")}
                              </span>
                              <span class="new-session-location-count">{otherCount()}</span>
                            </div>
                            <DrillButton
                              label={language.t("session.new.location.otherProjects")}
                              onDrill={() => choose(entry)}
                            />
                          </Match>
                          <Match when={entry.type === "add"}>
                            <div class="command-palette-row-main">
                              <Icon name="plus" class="command-palette-row-icon" />
                              <div class="command-palette-row-text">
                                <span class="command-palette-title palette-menu-title">
                                  {language.t("session.new.project.add")}
                                </span>
                              </div>
                            </div>
                            <Show when={command.keybindParts("project.open").length}>
                              <Keybind keys={command.keybindParts("project.open")} variant="neutral" class="shrink-0" />
                            </Show>
                            <Show when={choosesServer()}>
                              <DrillButton
                                label={language.t("session.new.location.servers")}
                                onDrill={() => choose(entry)}
                              />
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
                          <Match when={entry.type === "base" && entry}>
                            {(item) => (
                              <div class="command-palette-row-main">
                                <Icon name="branch" class="command-palette-row-icon" />
                                <div class="command-palette-row-text">
                                  <span class="command-palette-title palette-menu-title">
                                    {language.t("session.new.workspace.fromBranch", {
                                      branch: baseBranch(item().project) ?? language.t("session.location.noBranch"),
                                    })}
                                  </span>
                                  <span class="command-palette-description">
                                    {language.t("command.session.branch.choose")}
                                  </span>
                                </div>
                                <Show when={command.keybindParts("session.branch.choose").length}>
                                  <Keybind
                                    keys={command.keybindParts("session.branch.choose")}
                                    variant="neutral"
                                    class="shrink-0"
                                  />
                                </Show>
                              </div>
                            )}
                          </Match>
                          <Match when={entry.type === "branch" && entry}>
                            {(item) => (
                              <div class="command-palette-row-main">
                                <Icon name="branch-out" class="command-palette-row-icon" />
                                <div class="command-palette-row-text">
                                  <span class="command-palette-title palette-menu-title" dir="auto">
                                    {item().branch}
                                  </span>
                                </div>
                              </div>
                            )}
                          </Match>
                          <Match when={entry.type === "workspace" && entry}>
                            {(item) => (
                              <Show
                                when={item().value === "main"}
                                fallback={
                                  <WorkspaceRow
                                    title={workspaceTitle(item().project, item().value)}
                                    value={item().value}
                                    description={
                                      item().value === "create"
                                        ? language.t("session.new.workspace.new.tooltip")
                                        : item().directory
                                    }
                                  />
                                }
                              >
                                <ProjectRow
                                  project={item().project}
                                  branch={checkout(item().project)}
                                  path={item().directory}
                                  drillLabel={language.t("session.new.location.worktrees")}
                                />
                              </Show>
                            )}
                          </Match>
                        </Switch>
                      </button>
                    </>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </MenuScroll>
      </DialogBody>
    </Dialog>
  )
}

function ProjectRow(props: {
  project: PromptProject
  branch?: string
  path: string
  onDrill?: () => void
  drillLabel: string
}) {
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
            <Show when={props.branch}>
              {(branch) => (
                <span class="new-session-location-branch">
                  <Icon name="branch" size="small" />
                  <span dir="auto">{branch()}</span>
                </span>
              )}
            </Show>
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
      <Icon name="chevron-right" />
    </span>
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

function workspaceIcon(value: string) {
  if (value === "main") return "monitor"

  if (value === "create") return "plus"

  return "outline-worktree"
}

function WorkspaceRow(props: { title: string; value: string; description: string }) {
  return (
    <>
      <div class="command-palette-row-main">
        <Icon name={workspaceIcon(props.value)} class="command-palette-row-icon" />
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

function tagged(server?: PromptServer) {
  return server?.kind === "current" ? undefined : server
}

function serverIcon(server: PromptServer) {
  if (server.kind === "current") return "monitor"

  return server.kind === "plugin" ? "terminal" : "globe"
}

import type { PromptProject, PromptServer } from "@/new-session/project/selector"

export type LocationEntry =
  | { readonly id: string; readonly type: "project"; readonly project: PromptProject }
  | { readonly id: string; readonly type: "add" }
  | { readonly id: string; readonly type: "other" }
  | { readonly id: string; readonly type: "server"; readonly server: PromptServer }
  | {
      readonly id: string
      readonly type: "workspace"
      readonly project: PromptProject
      readonly value: string
      readonly directory: string
    }
  /** The base-branch row of the worktree step; choosing it opens the branch list. */
  | { readonly id: string; readonly type: "base"; readonly project: PromptProject; readonly directory: string }
  | { readonly id: string; readonly type: "branch"; readonly branch: string }

/** A step to return to, with the row that was active on it. */
export type LocationHistoryItem =
  | { readonly type: "projects"; readonly query: string; readonly active: string | undefined }
  | { readonly type: "others"; readonly query: string; readonly active: string | undefined }
  | {
      readonly type: "worktrees"
      readonly project: PromptProject
      readonly direct: boolean
      readonly query: string
      readonly active: string | undefined
      readonly base: string | undefined
    }
  | {
      readonly type: "branches"
      readonly project: PromptProject
      readonly direct: boolean
      readonly query: string
      readonly active: string | undefined
    }

// One step of the location dialog. `history` holds the steps to step back through, so a step entered from any other
// step returns to it intact. `direct` marks a step the dialog opened on, where Escape closes the dialog.
export type LocationDialogState =
  | { readonly type: "projects"; readonly query: string; readonly history: readonly LocationHistoryItem[] }
  | { readonly type: "others"; readonly query: string; readonly history: readonly LocationHistoryItem[] }
  | { readonly type: "servers"; readonly query: string; readonly history: readonly LocationHistoryItem[] }
  | {
      readonly type: "worktrees"
      readonly project: PromptProject
      readonly direct: boolean
      readonly query: string
      readonly history: readonly LocationHistoryItem[]
      /** A base branch chosen for the new worktree; omitted means the project root's current branch. */
      readonly base: string | undefined
    }
  | {
      readonly type: "branches"
      readonly project: PromptProject
      readonly direct: boolean
      readonly query: string
      readonly history: readonly LocationHistoryItem[]
    }

export type LocationDialogEvent =
  | { readonly type: "query.changed"; readonly query: string }
  | { readonly type: "drilled"; readonly project: PromptProject }
  | { readonly type: "branch.chosen"; readonly branch: string }
  /** `active` is the row active on the current step, restored when the user steps back to it. */
  | {
      readonly type: "chosen"
      readonly entry: LocationEntry
      readonly active: string | undefined
      readonly choosesServer: boolean
    }
  | { readonly type: "back" }
  | {
      readonly type: "key.down"
      readonly key: string
      readonly direction: "ltr" | "rtl"
      readonly atStart: boolean
      readonly atEnd: boolean
      readonly active: LocationEntry | undefined
      readonly choosesServer: boolean
      readonly drillable: boolean
    }

export type LocationDialogEffect =
  | { readonly type: "focus"; readonly active: string | undefined }
  | { readonly type: "project.add"; readonly server?: string }
  | { readonly type: "project.select"; readonly project: PromptProject }
  | {
      readonly type: "workspace.select"
      readonly project: PromptProject
      readonly value: string
      readonly branch?: string
    }
  | { readonly type: "close" }

export type LocationDialogTransition = {
  readonly state: LocationDialogState
  readonly effects: readonly LocationDialogEffect[]
  /** The key belongs to the dialog: prevent its default, and stop it too when `stop` is set. */
  readonly handled: boolean
  readonly stop: boolean
}

export function createLocationDialogState(
  drilled?: PromptProject,
  options?: { readonly step?: "branches"; readonly base?: string },
): LocationDialogState {
  if (!drilled) return { type: "projects", query: "", history: [] }

  const history = [{ type: "projects", query: "", active: projectEntryID(drilled) }] as const

  if (options?.step === "branches") return { type: "branches", project: drilled, direct: true, query: "", history }

  return {
    type: "worktrees",
    project: drilled,
    direct: true,
    query: "",
    history,
    base: options?.base,
  }
}

export function transitionLocationDialog(
  state: LocationDialogState,
  event: LocationDialogEvent,
): LocationDialogTransition {
  if (event.type === "query.changed")
    return event.query === state.query ? same(state) : to({ ...state, query: event.query })

  if (event.type === "drilled") {
    if (state.type !== "projects" && state.type !== "others") return same(state)

    return enter(state, projectEntryID(event.project), {
      type: "worktrees",
      project: event.project,
      direct: false,
      query: "",
      base: undefined,
    })
  }

  if (event.type === "branch.chosen") return chooseBranch(state, event.branch)

  if (event.type === "chosen") return choose(state, event)

  if (event.type === "back") return back(state)

  return key(state, event)
}

function choose(
  state: LocationDialogState,
  event: Extract<LocationDialogEvent, { type: "chosen" }>,
): LocationDialogTransition {
  const entry = event.entry

  if (entry.type === "add" && !event.choosesServer) return to(state, [{ type: "project.add" }])

  // Picking a server again from the server step keeps its search and the way back.
  if (entry.type === "add")
    return state.type === "servers" ? same(state) : enter(state, event.active, { type: "servers", query: "" })

  if (entry.type === "other")
    return state.type === "projects" ? enter(state, "other", { type: "others", query: "" }) : same(state)

  if (entry.type === "server") return to(state, [{ type: "project.add", server: entry.server.key }])

  if (entry.type === "project") return to(state, [{ type: "project.select", project: entry.project }])

  if (entry.type === "base")
    return state.type === "worktrees"
      ? enter(state, entry.id, { type: "branches", project: entry.project, direct: false, query: "" })
      : same(state)

  if (entry.type === "branch") return chooseBranch(state, entry.branch)

  return to(state, [
    {
      type: "workspace.select",
      project: entry.project,
      value: entry.value,
      branch: entry.value === "create" && state.type === "worktrees" ? state.base : undefined,
    },
  ])
}

function chooseBranch(state: LocationDialogState, branch: string): LocationDialogTransition {
  if (state.type !== "branches") return same(state)

  const previous = state.history.at(-1)

  // Choosing a base branch returns to the worktree step it came from, with the branch selected there.
  if (previous?.type === "worktrees")
    return to(
      {
        type: "worktrees",
        project: previous.project,
        direct: previous.direct,
        query: previous.query,
        history: state.history.slice(0, -1),
        base: branch,
      },
      [{ type: "focus", active: previous.active }],
    )

  return to(
    {
      type: "worktrees",
      project: state.project,
      direct: state.direct,
      query: "",
      history: state.history,
      base: branch,
    },
    [{ type: "focus", active: undefined }],
  )
}

function back(state: LocationDialogState): LocationDialogTransition {
  const top = state.history.at(-1)

  if (!top) return same(state)
  const history = state.history.slice(0, -1)
  const effects = [{ type: "focus", active: top.active }] as const

  if (top.type === "worktrees")
    return to(
      {
        type: "worktrees",
        project: top.project,
        direct: top.direct,
        query: top.query,
        history,
        base: top.base,
      },
      effects,
    )

  if (top.type === "branches")
    return to({ type: "branches", project: top.project, direct: top.direct, query: top.query, history }, effects)

  return to({ type: top.type, query: top.query, history }, effects)
}

function key(state: LocationDialogState, event: Extract<LocationDialogEvent, { type: "key.down" }>) {
  const forward = event.direction === "rtl" ? "ArrowLeft" : "ArrowRight"
  const backward = event.direction === "rtl" ? "ArrowRight" : "ArrowLeft"
  const active = event.active

  if (event.key === forward && event.atEnd && active?.type === "project" && event.drillable)
    return handled(transitionLocationDialog(state, { type: "drilled", project: active.project }), false)

  if (event.key === forward && event.atEnd && active?.type === "add" && event.choosesServer)
    return handled(choose(state, { type: "chosen", entry: active, active: active.id, choosesServer: true }), false)

  if (event.key === forward && event.atEnd && active?.type === "other" && state.type === "projects")
    return handled(choose(state, { type: "chosen", entry: active, active: active.id, choosesServer: false }), false)

  if (event.key === forward && event.atEnd && active?.type === "base")
    return handled(choose(state, { type: "chosen", entry: active, active: active.id, choosesServer: false }), false)

  if (state.type === "projects") return same(state)

  if (event.key === "Escape" && (state.type === "worktrees" || state.type === "branches") && state.direct)
    return handled(to(state, [{ type: "close" }]), true)

  if (
    (event.key === backward && event.atStart) ||
    (event.key === "Backspace" && !state.query) ||
    event.key === "Escape"
  )
    return handled(back(state), true)

  return same(state)
}

export function locationDialogView(state: LocationDialogState) {
  switch (state.type) {
    case "projects":
      return {
        drilled: undefined,
        titleKey: undefined,
        placeholderKey: "session.new.project.search",
        ownsEscape: false,
        otherGroupHeader: !!state.query.trim(),
      } as const
    case "others":
      return {
        drilled: undefined,
        titleKey: "session.new.location.otherProjects",
        placeholderKey: "session.new.project.search",
        ownsEscape: true,
        otherGroupHeader: false,
      } as const
    case "servers":
      return {
        drilled: undefined,
        titleKey: "session.new.location.servers",
        placeholderKey: "session.new.location.servers.search",
        ownsEscape: true,
        otherGroupHeader: false,
      } as const
    case "worktrees":
      return {
        drilled: state.project,
        titleKey: "session.new.workspace.runIn",
        placeholderKey: "session.new.workspace.search.placeholder",
        ownsEscape: true,
        otherGroupHeader: false,
      } as const
    case "branches":
      return {
        drilled: state.project,
        titleKey: "session.new.workspace.runIn",
        placeholderKey: "session.new.workspace.branch.search.placeholder",
        ownsEscape: true,
        otherGroupHeader: false,
      } as const
  }
}

export function projectEntryID(project: PromptProject) {
  return `project:${project.server?.key ?? ""}:${project.worktree}`
}

// Leaves the current step for `next`, remembering the current step and its active row to return to.
function enter(
  state: LocationDialogState,
  active: string | undefined,
  next:
    | { type: "others" | "servers"; query: string }
    | { type: "worktrees"; project: PromptProject; direct: boolean; query: string; base: string | undefined }
    | { type: "branches"; project: PromptProject; direct: boolean; query: string },
): LocationDialogTransition {
  const frame = historyFrame(state, active)

  return to({ ...next, history: [...state.history, frame] }, [{ type: "focus", active: undefined }])
}

// Leaves the current step for `next`, remembering the current step and its active row to return to.
function historyFrame(state: LocationDialogState, active: string | undefined): LocationHistoryItem {
  if (state.type === "worktrees")
    return {
      type: "worktrees",
      project: state.project,
      direct: state.direct,
      query: state.query,
      active,
      base: state.base,
    }

  if (state.type === "branches")
    return {
      type: "branches",
      project: state.project,
      direct: state.direct,
      query: state.query,
      active,
    }

  return { type: state.type === "others" ? "others" : "projects", query: state.query, active }
}

function to(state: LocationDialogState, effects: readonly LocationDialogEffect[] = []): LocationDialogTransition {
  return { state, effects, handled: false, stop: false }
}

function same(state: LocationDialogState): LocationDialogTransition {
  return { state, effects: [], handled: false, stop: false }
}

function handled(transition: LocationDialogTransition, stop: boolean): LocationDialogTransition {
  return { ...transition, handled: true, stop }
}

import type { ProjectUpdateInput } from "@opencode/client/promise"
import { getFilename } from "@opencode/util/path"

/** How long one save may take before its request is aborted and the queue moves on. */
export const PROJECT_SAVE_TIMEOUT_MS = 15_000

export type ProjectPatch = Pick<ProjectUpdateInput, "name" | "icon" | "commands">

/** A patch being built one field at a time. */
type PatchDraft = { -readonly [K in keyof ProjectPatch]: ProjectPatch[K] }

export type ProjectField = "name" | "icon" | "startup"

export type ProjectTarget = { readonly id: string | undefined; readonly worktree: string }

/** The project as the settings page receives it. */
export type ProjectSnapshot = ProjectTarget & {
  readonly name: string | undefined
  readonly color: string | undefined
  readonly iconOverride: string | undefined
  readonly startup: string | undefined
}

type IconValue = { readonly color: string; readonly override: string }

/** Field values to save. A write holds only the fields it changes, so later writes merge into one per field. */
export type ProjectWrite = {
  readonly name?: string
  readonly icon?: IconValue
  readonly startup?: string
}

type ProjectSaved = { readonly name: string; readonly icon: IconValue; readonly startup: string }

type ProjectDraft = {
  readonly name: string
  readonly color: string
  readonly iconOverride: string
  readonly startup: string
}

type ProjectSettingsBase = {
  readonly target: ProjectTarget
  readonly folderName: string
  readonly saved: ProjectSaved
  /** What the fields show, saved or not. */
  readonly draft: ProjectDraft
  /** Fields whose last save failed: they show an error and a retry until edited, retried or saved. */
  readonly failed: readonly ProjectField[]
  readonly dragOver: boolean
  /** The image being read for the icon; a read that finishes after another starts, or after a clear, is dropped. */
  readonly reading: number | undefined
  readonly attempt: number
}

export type ProjectSettingsState =
  | (ProjectSettingsBase & { readonly status: "idle" })
  /** One save is in flight; later commits wait in `pending`, merged per field. */
  | (ProjectSettingsBase & {
      readonly status: "saving"
      readonly saveAttempt: number
      readonly active: ProjectWrite
      readonly pending: ProjectWrite | undefined
    })
  | { readonly status: "disposed" }

export type ProjectSettingsEvent =
  | { readonly type: "project.synced"; readonly project: ProjectSnapshot }
  | { readonly type: "name.edited"; readonly value: string }
  | { readonly type: "name.committed" }
  | { readonly type: "startup.edited"; readonly value: string }
  | { readonly type: "startup.committed" }
  | { readonly type: "color.selected"; readonly color: string | undefined }
  | { readonly type: "icon.cleared" }
  | { readonly type: "icon.drag-over" }
  | { readonly type: "icon.drag-left" }
  | { readonly type: "icon.file-selected"; readonly file: File }
  | { readonly type: "icon.file-loaded"; readonly attempt: number; readonly dataUrl: string }
  | { readonly type: "icon.file-failed"; readonly attempt: number }
  | { readonly type: "field.retried"; readonly field: ProjectField }
  | { readonly type: "save.succeeded"; readonly saveAttempt: number }
  | { readonly type: "save.failed"; readonly saveAttempt: number; readonly error: string }
  | { readonly type: "save.timed-out"; readonly saveAttempt: number; readonly error: string }
  | { readonly type: "disposed" }

export type ProjectSettingsEffect =
  | {
      readonly type: "run-save"
      readonly saveAttempt: number
      readonly target: ProjectTarget
      readonly patch: ProjectPatch
    }
  /** The page closed with commits still queued: send them once the save in flight settles. */
  | { readonly type: "flush"; readonly target: ProjectTarget; readonly patch: ProjectPatch }
  | { readonly type: "read-icon"; readonly attempt: number; readonly file: File }
  | { readonly type: "abort-icon-read" }
  | { readonly type: "toast-error"; readonly error: string }

export type ProjectSettingsTransition = {
  readonly state: ProjectSettingsState
  readonly effects: readonly ProjectSettingsEffect[]
}

type Live = Exclude<ProjectSettingsState, { status: "disposed" }>

const FIELDS: readonly ProjectField[] = ["name", "icon", "startup"]

const NONE: readonly ProjectSettingsEffect[] = []

export function createProjectSettingsState(project: ProjectSnapshot, attempt = 0): ProjectSettingsState {
  const folderName = getFilename(project.worktree)
  const startup = project.startup ?? ""

  return {
    status: "idle",
    target: { id: project.id, worktree: project.worktree },
    folderName,
    saved: {
      name: project.name ?? "",
      icon: { color: project.color ?? "", override: project.iconOverride ?? "" },
      startup: startup.trim(),
    },
    draft: {
      name: project.name || folderName,
      color: project.color ?? "",
      iconOverride: project.iconOverride ?? "",
      startup,
    },
    failed: [],
    dragOver: false,
    reading: undefined,
    attempt,
  }
}

export function transitionProjectSettings(
  state: ProjectSettingsState,
  event: ProjectSettingsEvent,
): ProjectSettingsTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  const abortRead: readonly ProjectSettingsEffect[] = state.reading === undefined ? NONE : [{ type: "abort-icon-read" }]

  switch (event.type) {
    case "disposed": {
      const flush: readonly ProjectSettingsEffect[] =
        state.status === "saving" && state.pending
          ? [{ type: "flush", target: state.target, patch: patchOf(state.pending) }]
          : NONE

      return { state: { status: "disposed" }, effects: [...abortRead, ...flush] }
    }

    case "project.synced":
      if (event.project.id === state.target.id && event.project.worktree === state.target.worktree)
        return { state, effects: NONE }

      // Another project: saves already sent finish against the project they were sent for, but their results are stale.
      return { state: createProjectSettingsState(event.project, state.attempt + 1), effects: abortRead }
    case "name.edited":
      if (event.value === state.draft.name) return { state, effects: NONE }

      return edited(state, "name", { ...state.draft, name: event.value })
    case "startup.edited":
      if (event.value === state.draft.startup) return { state, effects: NONE }

      return edited(state, "startup", { ...state.draft, startup: event.value })
    case "name.committed":
      return enqueue(state, draftWrite(state, "name"))
    case "startup.committed":
      return enqueue(state, draftWrite(state, "startup"))
    case "color.selected": {
      const next = { ...state, draft: { ...state.draft, color: event.color ?? "" } }

      return enqueue(next, draftWrite(next, "icon"))
    }

    case "icon.cleared": {
      if (!state.draft.iconOverride && state.reading === undefined) return { state, effects: NONE }
      const next = { ...state, draft: { ...state.draft, iconOverride: "" }, reading: undefined }
      const result = enqueue(next, draftWrite(next, "icon"))

      return { state: result.state, effects: [...abortRead, ...result.effects] }
    }

    case "icon.drag-over":
      if (state.dragOver) return { state, effects: NONE }

      return { state: { ...state, dragOver: true }, effects: NONE }
    case "icon.drag-left":
      if (!state.dragOver) return { state, effects: NONE }

      return { state: { ...state, dragOver: false }, effects: NONE }
    case "icon.file-selected": {
      if (!event.file.type.startsWith("image/"))
        return { state: state.dragOver ? { ...state, dragOver: false } : state, effects: NONE }
      const attempt = state.attempt + 1

      return {
        state: { ...state, attempt, dragOver: false, reading: attempt },
        effects: [...abortRead, { type: "read-icon", attempt, file: event.file }],
      }
    }

    case "icon.file-loaded": {
      if (state.reading !== event.attempt) return { state, effects: NONE }
      const next = { ...state, draft: { ...state.draft, iconOverride: event.dataUrl }, reading: undefined }

      return enqueue(next, draftWrite(next, "icon"))
    }

    case "icon.file-failed":
      if (state.reading !== event.attempt) return { state, effects: NONE }

      return { state: { ...state, reading: undefined }, effects: NONE }
    case "field.retried":
      if (!state.failed.includes(event.field)) return { state, effects: NONE }

      return enqueue(state, draftWrite(state, event.field))
    case "save.succeeded":
      if (state.status !== "saving" || state.saveAttempt !== event.saveAttempt) return { state, effects: NONE }

      return advance({ ...state, saved: { ...state.saved, ...state.active } }, state.pending)
    case "save.failed":
    case "save.timed-out": {
      if (state.status !== "saving" || state.saveAttempt !== event.saveAttempt) return { state, effects: NONE }

      // A field committed again meanwhile is already queued, and one edited back to its saved value has nothing to retry.
      const failed = FIELDS.filter(
        (field) =>
          state.failed.includes(field) ||
          (state.active[field] !== undefined &&
            state.pending?.[field] === undefined &&
            !same(field, draftWrite(state, field), state.saved)),
      )

      const result = advance({ ...state, failed }, state.pending)

      return { state: result.state, effects: [{ type: "toast-error", error: event.error }, ...result.effects] }
    }
  }
}

export type ProjectSettingsView = {
  readonly busy: boolean
  readonly folderName: string
  readonly name: string
  readonly color: string | undefined
  readonly iconOverride: string | undefined
  readonly startup: string
  readonly dragOver: boolean
  readonly failed: Readonly<Record<ProjectField, boolean>>
}

const DISPOSED_VIEW: ProjectSettingsView = {
  busy: false,
  folderName: "",
  name: "",
  color: undefined,
  iconOverride: undefined,
  startup: "",
  dragOver: false,
  failed: { name: false, icon: false, startup: false },
}

export function selectProjectSettingsView(state: ProjectSettingsState): ProjectSettingsView {
  if (state.status === "disposed") return DISPOSED_VIEW

  return {
    busy: state.status === "saving",
    folderName: state.folderName,
    name: state.draft.name,
    color: state.draft.color || undefined,
    iconOverride: state.draft.iconOverride || undefined,
    startup: state.draft.startup,
    dragOver: state.dragOver,
    failed: {
      name: state.failed.includes("name"),
      icon: state.failed.includes("icon"),
      startup: state.failed.includes("startup"),
    },
  }
}

function edited(state: Live, field: ProjectField, draft: ProjectDraft): ProjectSettingsTransition {
  return { state: { ...state, draft, failed: state.failed.filter((item) => item !== field) }, effects: NONE }
}

/** Queues the fields of `write` that change what the server will hold, or that failed and are sent again. */
function enqueue(state: Live, write: ProjectWrite): ProjectSettingsTransition {
  const fields = FIELDS.filter(
    (field) => write[field] !== undefined && (state.failed.includes(field) || !same(field, write, projected(state))),
  )

  if (fields.length === 0) return { state, effects: NONE }
  const changes: ProjectWrite = Object.fromEntries(fields.map((field) => [field, write[field]]))
  const failed = state.failed.filter((field) => !fields.includes(field))

  if (state.status === "saving")
    return { state: { ...state, failed, pending: { ...state.pending, ...changes } }, effects: NONE }

  return start({ ...state, failed }, changes)
}

/** Every save ends here, whatever its outcome, so the queue always moves on. */
function advance(state: Live, pending: ProjectWrite | undefined): ProjectSettingsTransition {
  if (pending) return start(state, pending)

  return {
    state: {
      status: "idle",
      target: state.target,
      folderName: state.folderName,
      saved: state.saved,
      draft: state.draft,
      failed: state.failed,
      dragOver: state.dragOver,
      reading: state.reading,
      attempt: state.attempt,
    },
    effects: NONE,
  }
}

function start(state: Live, write: ProjectWrite): ProjectSettingsTransition {
  const saveAttempt = state.attempt + 1

  return {
    state: { ...state, status: "saving", attempt: saveAttempt, saveAttempt, active: write, pending: undefined },
    effects: [{ type: "run-save", saveAttempt, target: state.target, patch: patchOf(write) }],
  }
}

/** What the server will hold once every queued save lands. */
function projected(state: Live): ProjectSaved {
  if (state.status !== "saving") return state.saved

  return { ...state.saved, ...state.active, ...state.pending }
}

function draftWrite(state: Live, field: ProjectField): ProjectWrite {
  if (field === "icon") return { icon: { color: state.draft.color, override: state.draft.iconOverride } }

  if (field === "startup") return { startup: state.draft.startup.trim() }

  const name = state.draft.name.trim()

  return { name: name === state.folderName ? "" : name }
}

/** Whether `a` and `b` hold the same value for `field`. */
function same(field: ProjectField, a: ProjectWrite, b: ProjectWrite) {
  if (field !== "icon") return a[field] === b[field]

  return a.icon?.color === b.icon?.color && a.icon?.override === b.icon?.override
}

/** A patch carries only the fields written, so a local project's metadata keeps the rest. */
function patchOf(write: ProjectWrite): ProjectPatch {
  const patch: PatchDraft = {}

  if (write.name !== undefined) patch.name = write.name

  if (write.icon) patch.icon = write.icon

  if (write.startup !== undefined) patch.commands = { start: write.startup }

  return patch
}

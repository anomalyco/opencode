import { getFilename } from "@opencode/util/path"
import {
  pickerFileSearchQuery,
  pickerParent,
  pickerRelativePath,
  resolvePickerTarget,
  type PickerPolicy,
} from "./domain"

/** Bounded fallback so a hung location or listing request cannot leave the picker loading forever. */
export const PICKER_LOAD_TIMEOUT_MS = 30_000

export type PickerNode = { readonly name: string; readonly type: "file" | "directory" }

/** One folder's listing inside the current root, keyed by its tree path without a trailing slash ("" is the root). */
export type PickerDirState =
  | { readonly status: "loading"; readonly attempt: number; readonly priority: "user" | "background" }
  | { readonly status: "ready" }
  | { readonly status: "failed" }

/** A chosen folder inside the root. Its ancestors list and expand in order from `index`, then it is selected. */
export type PickerReveal = {
  readonly target: string
  readonly relative: string
  readonly index: number
  readonly fromInput: boolean
}

/** The root to open, and the child of it to select once it lists. */
export type PickerTarget = { readonly root: string; readonly selectChild?: string }

/**
 * The folder browser. `issued` numbers every location and listing request, so a result for an earlier root, reveal or
 * location request never matches a later one. Without a dialog location, `locating` is the attempt of the fallback
 * `location.get()` request and `pending` the root to open once it resolves; the resolved directory then travels with
 * every phase as `locationDirectory`.
 */
export type PickerTreeState =
  | {
      readonly status: "booting"
      readonly issued: number
      readonly locating?: number
      readonly locationDirectory?: string
      readonly pending?: PickerTarget
    }
  | {
      readonly status: "loading"
      readonly issued: number
      readonly attempt: number
      readonly root: string
      readonly selectChild?: string
      readonly locationDirectory?: string
    }
  | {
      readonly status: "ready"
      readonly issued: number
      readonly root: string
      readonly selected: string
      readonly dirs: Readonly<Record<string, PickerDirState>>
      readonly entries: Readonly<Record<string, true>>
      readonly gitRepos: Readonly<Record<string, true>>
      readonly reveal?: PickerReveal
      readonly locationDirectory?: string
    }
  | { readonly status: "error"; readonly issued: number; readonly root: string; readonly locationDirectory?: string }
  | { readonly status: "disposed" }

/** `fallback` is the base for relative paths before a root opens; `located` says whether a server location exists. */
type PickerNavigation = {
  readonly path: string
  readonly home: string
  readonly fallback: string
  readonly located: boolean
}

export type PickerTreeEvent =
  | { readonly type: "location.requested" }
  | { readonly type: "location.resolved"; readonly attempt: number; readonly directory: string | undefined }
  | { readonly type: "location.failed"; readonly attempt: number }
  | { readonly type: "location.timed-out"; readonly attempt: number }
  | ({ readonly type: "navigate" } & PickerNavigation)
  | ({ readonly type: "directory.chosen"; readonly fromInput: boolean } & PickerNavigation)
  | { readonly type: "file.chosen"; readonly absolute: string; readonly home: string }
  | { readonly type: "selection.cleared" }
  | { readonly type: "tree.selected"; readonly path: string | undefined }
  | { readonly type: "dir.expanded"; readonly dir: string }
  | {
      readonly type: "dir.loaded"
      readonly dir: string
      readonly attempt: number
      readonly nodes: readonly PickerNode[]
    }
  | { readonly type: "dir.failed"; readonly dir: string; readonly attempt: number }
  | { readonly type: "dir.timed-out"; readonly dir: string; readonly attempt: number }
  | { readonly type: "disposed" }

export type PickerTreeEffect =
  | { readonly type: "resolve-location"; readonly attempt: number; readonly timeoutMs: number }
  | {
      readonly type: "list"
      readonly root: string
      readonly dir: string
      readonly attempt: number
      readonly priority: "user" | "background"
      readonly timeoutMs: number
    }
  | { readonly type: "promote"; readonly attempt: number }
  | { readonly type: "queue.reset" }
  | { readonly type: "tree.reset" }
  | { readonly type: "tree.add"; readonly paths: readonly string[] }
  | { readonly type: "tree.expand"; readonly dir: string }
  | { readonly type: "tree.select"; readonly entry: string }
  | { readonly type: "tree.clear-selection" }
  | { readonly type: "tree.focus-initial" }
  | { readonly type: "tree.refresh-decorations" }

export type PickerTreeTransition = { readonly state: PickerTreeState; readonly effects: readonly PickerTreeEffect[] }

type LiveTree = Exclude<PickerTreeState, { status: "disposed" }>

type ReadyTree = Extract<PickerTreeState, { status: "ready" }>

export function createPickerTreeState(): PickerTreeState {
  return { status: "booting", issued: 0 }
}

export function transitionPickerTree(
  state: PickerTreeState,
  event: PickerTreeEvent,
  policy: PickerPolicy,
): PickerTreeTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: [{ type: "queue.reset" }] }

  if (event.type === "location.requested") {
    if (state.status !== "booting" || state.locating !== undefined || state.locationDirectory) return unchanged(state)
    const attempt = state.issued + 1

    return { state: { ...state, issued: attempt, locating: attempt }, effects: [resolveLocation(attempt)] }
  }

  if (event.type === "location.resolved" || event.type === "location.failed" || event.type === "location.timed-out") {
    return settleLocation(state, event)
  }

  if (event.type === "navigate") {
    const root = target(state, event, policy)

    if (!root) return unchanged(state)

    return open(state, { root }, event.located)
  }

  if (event.type === "directory.chosen") return choose(state, event, policy)

  if (event.type === "dir.loaded" || event.type === "dir.failed" || event.type === "dir.timed-out") {
    return settleListing(state, event, policy)
  }

  if (state.status !== "ready") return unchanged(state)

  if (event.type === "dir.expanded") {
    const dir = event.dir.replace(/\/+$/, "")

    if (!dir) return unchanged(state)

    return requestDir(state, dir, [])
  }

  if (event.type === "tree.selected") {
    return select(state, event.path ? (policy.selection(state.root, event.path) ?? "") : "")
  }

  if (event.type === "selection.cleared") return select(state, "")

  return select(
    state,
    policy.selection(state.root, pickerFileSearchQuery(state.root, event.absolute, event.home)) ?? "",
  )
}

export function pickerTreeView(state: PickerTreeState, policy: PickerPolicy) {
  return {
    root: rootOf(state),
    selected: state.status === "ready" ? state.selected : "",
    loading: (state.status === "booting" && state.locating !== undefined) || state.status === "loading",
    error: state.status === "error",
    result: state.status === "ready" ? policy.result(state.root, state.selected, true) : undefined,
    locationDirectory: state.status === "disposed" ? undefined : state.locationDirectory,
  }
}

export function hasPickerGitRepo(state: PickerTreeState, dir: string) {
  return state.status === "ready" && Boolean(state.gitRepos[dir.replace(/\/+$/, "")])
}

function settleLocation(
  state: LiveTree,
  event: Extract<PickerTreeEvent, { type: "location.resolved" | "location.failed" | "location.timed-out" }>,
): PickerTreeTransition {
  if (state.status !== "booting" || state.locating !== event.attempt) return unchanged(state)

  if (event.type === "location.resolved" && event.directory) {
    const located = { status: "booting" as const, issued: state.issued, locationDirectory: event.directory }

    if (state.pending) return open(located, state.pending, true)

    return { state: located, effects: [] }
  }

  return { state: { status: "error", issued: state.issued, root: state.pending?.root ?? "" }, effects: [] }
}

function choose(
  state: LiveTree,
  event: Extract<PickerTreeEvent, { type: "directory.chosen" }>,
  policy: PickerPolicy,
): PickerTreeTransition {
  const value = target(state, event, policy)

  if (!value) return unchanged(state)

  if (state.status === "ready") {
    const relative = pickerRelativePath(state.root, value)

    if (relative === "") {
      return { state: { ...state, selected: "", reveal: undefined }, effects: [{ type: "tree.clear-selection" }] }
    }

    if (relative) {
      return advanceReveal(
        { ...state, reveal: { target: value, relative, index: 0, fromInput: event.fromInput } },
        [],
        policy,
      )
    }
  }

  const parent = pickerParent(value)

  if (parent && getFilename(value) && parent !== value && parent === event.home) {
    return open(state, { root: parent, selectChild: value }, event.located)
  }

  return open(state, { root: value }, event.located)
}

// A new root drops every listing, queued preload and reveal of the previous one.
function open(state: LiveTree, next: PickerTarget, located: boolean): PickerTreeTransition {
  const attempt = state.issued + 1

  if (!located) {
    if (state.status === "booting" && state.locating !== undefined) {
      return { state: { ...state, pending: next }, effects: [] }
    }

    return {
      state: { status: "booting", issued: attempt, locating: attempt, pending: next },
      effects: [{ type: "queue.reset" }, { type: "tree.reset" }, resolveLocation(attempt)],
    }
  }

  return {
    state: {
      status: "loading",
      issued: attempt,
      attempt,
      root: next.root,
      selectChild: next.selectChild,
      locationDirectory: state.locationDirectory,
    },
    effects: [{ type: "queue.reset" }, { type: "tree.reset" }, list(next.root, "", attempt, "user")],
  }
}

function settleListing(
  state: LiveTree,
  event: Extract<PickerTreeEvent, { type: "dir.loaded" | "dir.failed" | "dir.timed-out" }>,
  policy: PickerPolicy,
): PickerTreeTransition {
  if (state.status === "loading") {
    if (event.dir !== "" || event.attempt !== state.attempt) return unchanged(state)

    if (event.type !== "dir.loaded") {
      return {
        state: { status: "error", issued: state.issued, root: state.root, locationDirectory: state.locationDirectory },
        effects: [{ type: "queue.reset" }],
      }
    }

    return openRoot(state, event.nodes, policy)
  }

  if (state.status !== "ready") return unchanged(state)
  const entry = state.dirs[event.dir]

  if (entry?.status !== "loading" || entry.attempt !== event.attempt) return unchanged(state)
  const waiting = state.reveal !== undefined && revealAncestors(state.reveal.relative)[state.reveal.index] === event.dir

  if (event.type !== "dir.loaded") {
    // A child folder that fails stays retryable on its next expand; the root stays usable.
    const failed = { ...state, dirs: { ...state.dirs, [event.dir]: { status: "failed" as const } } }

    if (waiting && failed.reveal) return finishReveal(failed, failed.reveal, [], policy)

    return { state: failed, effects: [] }
  }

  const listed = absorb(state, event.dir, event.nodes, policy)

  if (waiting) return advanceReveal(listed.state, listed.effects, policy)

  return listed
}

// Preloading the root's folders makes their first expand instant and finds git repos for the badge.
function openRoot(
  state: Extract<PickerTreeState, { status: "loading" }>,
  nodes: readonly PickerNode[],
  policy: PickerPolicy,
): PickerTreeTransition {
  const listed = absorb(
    {
      status: "ready",
      issued: state.issued,
      root: state.root,
      selected: "",
      dirs: {},
      entries: {},
      gitRepos: {},
      locationDirectory: state.locationDirectory,
    },
    "",
    nodes,
    policy,
  )

  const children = nodes.flatMap((node) => (node.type === "directory" && node.name !== ".git" ? [node.name] : []))
  const entry = state.selectChild ? `${getFilename(state.selectChild)}/` : undefined

  return {
    state: {
      ...listed.state,
      issued: state.issued + children.length,
      selected: entry ? (policy.selection(state.root, entry) ?? "") : "",
      dirs: {
        ...listed.state.dirs,
        ...Object.fromEntries(
          children.map((name, index) => [
            name,
            { status: "loading" as const, attempt: state.issued + index + 1, priority: "background" as const },
          ]),
        ),
      },
    },
    effects: [
      ...listed.effects,
      entry ? { type: "tree.select", entry } : { type: "tree.focus-initial" },
      ...children.map((name, index) => list(state.root, name, state.issued + index + 1, "background")),
    ],
  }
}

function absorb(state: ReadyTree, dir: string, nodes: readonly PickerNode[], policy: PickerPolicy) {
  const paths = policy
    .entries(
      dir,
      nodes.filter((node) => node.name !== ".git"),
    )
    .filter((path) => !state.entries[path])

  const repo = nodes.some((node) => node.name === ".git") && !state.gitRepos[dir]
  const effects: PickerTreeEffect[] = []

  if (paths.length > 0) effects.push({ type: "tree.add", paths })

  if (repo) effects.push({ type: "tree.refresh-decorations" })

  return {
    state: {
      ...state,
      dirs: { ...state.dirs, [dir]: { status: "ready" as const } },
      entries:
        paths.length > 0
          ? { ...state.entries, ...Object.fromEntries(paths.map((path) => [path, true] as const)) }
          : state.entries,
      gitRepos: repo ? { ...state.gitRepos, [dir]: true as const } : state.gitRepos,
    },
    effects,
  }
}

// Expands the listed ancestors in order and waits on the first one that has not listed yet.
function advanceReveal(state: ReadyTree, effects: readonly PickerTreeEffect[], policy: PickerPolicy) {
  const reveal = state.reveal

  if (!reveal) return { state, effects }
  const ancestors = revealAncestors(reveal.relative)
  const index = ancestors.findIndex((dir, at) => at >= reveal.index && state.dirs[dir]?.status !== "ready")

  const expanded = [
    ...effects,
    ...ancestors
      .slice(reveal.index, index === -1 ? undefined : index)
      .map((dir) => ({ type: "tree.expand" as const, dir })),
  ]

  if (index === -1) return finishReveal(state, reveal, expanded, policy)

  return requestDir({ ...state, reveal: { ...reveal, index } }, ancestors[index]!, expanded)
}

// A folder the listings did not show opens as the new root instead.
function finishReveal(
  state: ReadyTree,
  reveal: PickerReveal,
  effects: readonly PickerTreeEffect[],
  policy: PickerPolicy,
): PickerTreeTransition {
  const entry = `${reveal.relative}/`

  if (!state.entries[entry]) return open({ ...state, reveal: undefined }, { root: reveal.target }, true)
  const selected = { ...state, reveal: undefined, selected: policy.selection(state.root, entry) ?? "" }
  const selecting = [...effects, { type: "tree.select" as const, entry }]

  if (!reveal.fromInput) return { state: selected, effects: selecting }

  return requestDir(selected, reveal.relative, [...selecting, { type: "tree.expand", dir: reveal.relative }])
}

function requestDir(state: ReadyTree, dir: string, effects: readonly PickerTreeEffect[]): PickerTreeTransition {
  const entry = state.dirs[dir]

  if (!entry || entry.status === "failed") {
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        dirs: { ...state.dirs, [dir]: { status: "loading", attempt, priority: "user" } },
      },
      effects: [...effects, list(state.root, dir, attempt, "user")],
    }
  }

  if (entry.status === "loading" && entry.priority === "background") {
    return {
      state: { ...state, dirs: { ...state.dirs, [dir]: { ...entry, priority: "user" } } },
      effects: [...effects, { type: "promote", attempt: entry.attempt }],
    }
  }

  return { state, effects }
}

function select(state: ReadyTree, selected: string): PickerTreeTransition {
  if (selected === state.selected && !state.reveal) return unchanged(state)

  return { state: { ...state, selected, reveal: undefined }, effects: [] }
}

function target(state: LiveTree, event: PickerNavigation, policy: PickerPolicy) {
  return resolvePickerTarget(policy, event.path, event.home, rootOf(state) || event.fallback)
}

function rootOf(state: PickerTreeState) {
  return state.status === "booting" || state.status === "disposed" ? "" : state.root
}

function revealAncestors(relative: string) {
  const segments = relative.split("/").filter(Boolean)

  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"))
}

function resolveLocation(attempt: number): PickerTreeEffect {
  return { type: "resolve-location", attempt, timeoutMs: PICKER_LOAD_TIMEOUT_MS }
}

function list(root: string, dir: string, attempt: number, priority: "user" | "background"): PickerTreeEffect {
  return { type: "list", root, dir, attempt, priority, timeoutMs: PICKER_LOAD_TIMEOUT_MS }
}

function unchanged(state: PickerTreeState): PickerTreeTransition {
  return { state, effects: [] }
}

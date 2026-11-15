import { getOwner, onCleanup, untrack } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import type { FileNode } from "@/runtime/server/types"
import {
  canRefreshDirectory,
  createFileTreeState,
  isDirectoryBusy,
  isDirectoryExpanded,
  isDirectoryLoaded,
  isDirectoryLoading,
  selectDirectoryChildren,
  selectDirectoryError,
  selectTreeNode,
  transitionFileTree,
  type FileTreeEffect,
  type FileTreeEvent,
} from "./tree-machine"

type TreeStoreOptions = {
  normalizeDir: (input: string) => string
  list: (input: string) => Promise<FileNode[]>
  onError: (message: string) => void
}

export function createFileTreeStore(options: TreeStoreOptions) {
  const [tree, setTree] = createStore({ current: createFileTreeState() })
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const waiters = new Map<string, Array<() => void>>()

  const dispatch = (event: FileTreeEvent) =>
    untrack(() => {
      const previous = unwrap(tree.current)
      const result = transitionFileTree(previous, event)

      if (result.state !== previous) {
        // Keyless reconcile writes only the fields that changed, so unchanged nodes and directories notify no reader.
        setTree("current", reconcile(result.state, { key: null }))

        waiters.forEach((resolve, dir) => {
          if (isDirectoryBusy(result.state, dir)) return
          waiters.delete(dir)
          resolve.forEach((run) => run())
        })
      }

      result.effects.forEach(run)
    })

  const run = (effect: FileTreeEffect) => {
    if (effect.type === "notify.error") return options.onError(effect.message)

    const settle = (event: Extract<FileTreeEvent, { attempt: number }>) => {
      clearTimeout(timers.get(event.attempt))
      timers.delete(event.attempt)
      dispatch(event)
    }

    timers.set(
      effect.attempt,
      setTimeout(() => settle({ type: "list.timed-out", dir: effect.dir, attempt: effect.attempt }), effect.timeoutMs),
    )
    void Promise.try(() => options.list(effect.dir)).then(
      (nodes) => settle({ type: "list.loaded", dir: effect.dir, attempt: effect.attempt, nodes }),
      (error) =>
        settle({
          type: "list.failed",
          dir: effect.dir,
          attempt: effect.attempt,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
  }

  if (getOwner()) {
    onCleanup(() => {
      dispatch({ type: "disposed" })
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    })
  }

  // Resolves once the directory has no listing in flight, so a forced reload resolves after its follow-up listing.
  const listDir = (input: string, opts?: { force?: boolean }) => {
    const dir = options.normalizeDir(input)
    dispatch({ type: "list.requested", dir, force: Boolean(opts?.force) })

    if (!isDirectoryBusy(unwrap(tree.current), dir)) return Promise.resolve()

    return new Promise<void>((resolve) => waiters.set(dir, [...(waiters.get(dir) ?? []), resolve]))
  }

  // `list: false` marks a directory expanded without fetching its children, for
  // trees whose nodes are synthesized from a filter; listing directories that
  // only exist on a diff's base branch fails and surfaces error toasts.
  const expandDir = (input: string, behavior?: { list?: boolean }) => {
    dispatch({ type: "dir.expanded", dir: options.normalizeDir(input), list: behavior?.list !== false })
  }

  const collapseDir = (input: string) => {
    dispatch({ type: "dir.collapsed", dir: options.normalizeDir(input) })
  }

  // Getters keep each reader subscribed to the one field it reads. Reading `epoch` makes a workspace reset re-run every
  // reader, so the file tree lists the new root even when the old one never loaded.
  const dirState = (input: string) => {
    const dir = options.normalizeDir(input)
    const current = tree.current

    if (current.status !== "active") return undefined
    void current.epoch
    const entry = current.dirs[dir]

    if (!entry) return undefined

    return {
      get expanded() {
        return isDirectoryExpanded(entry)
      },
      get loaded() {
        return isDirectoryLoaded(entry)
      },
      get loading() {
        return isDirectoryLoading(entry)
      },
      get error() {
        return selectDirectoryError(entry)
      },
    }
  }

  return {
    listDir,
    expandDir,
    collapseDir,
    dirState,
    children: (input: string) => selectDirectoryChildren(tree.current, options.normalizeDir(input)),
    node: (path: string) => selectTreeNode(tree.current, path),
    // Includes directories still loading, so a change during their first listing queues a reload.
    isLoaded: (path: string) => canRefreshDirectory(tree.current, options.normalizeDir(path)),
    reset: () => dispatch({ type: "reset" }),
  }
}

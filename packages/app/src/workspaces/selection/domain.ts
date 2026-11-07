export function treeEntries(parent: string, nodes: ReadonlyArray<{ name: string; type: "file" | "directory" }>) {
  const prefix = parent.replace(/^\/+|\/+$/g, "")

  return nodes.map((node) => {
    const path = prefix ? `${prefix}/${node.name}` : node.name

    return node.type === "directory" ? path + "/" : path
  })
}

export function pickerMode(mode: "directory" | "file", base?: string) {
  if (mode === "file") {
    return {
      includeFiles: true,
      action: "file" as const,
      entries(parent: string, nodes: ReadonlyArray<{ name: string; type: "file" | "directory" }>) {
        return treeEntries(parent, nodes)
      },
      navigation(path: string) {
        return treePathWithin(base, path) ? path : undefined
      },
      result(root: string, selected: string) {
        return selected || undefined
      },
      selection(root: string, path: string) {
        if (!treePathWithin(base, root)) return

        return selectedTreePath(root, path, "file", base)
      },
    }
  }

  return {
    includeFiles: false,
    action: "directory" as const,
    entries(parent: string, nodes: ReadonlyArray<{ name: string; type: "file" | "directory" }>) {
      return treeEntries(
        parent,
        nodes.filter((node) => node.type === "directory"),
      )
    },
    navigation(path: string) {
      return path
    },
    result(root: string, selected: string, valid = true) {
      if (!valid) return

      return selected || (root ? nativePickerPath(root) : undefined)
    },
    selection(root: string, path: string) {
      return selectedTreePath(root, path, "directory")
    },
  }
}

export function pickerFileSearchQuery(root: string, input: string, home: string) {
  const value = input
    .replace(/\\/g, "/")
    .replace(/^~(?=\/|$)/, home)
    .replace(/\/+$/, "")

  const base = root.replace(/\\/g, "/").replace(/\/+$/, "")

  if (value === base) return ""

  if (value.startsWith(base + "/")) return value.slice(base.length + 1)

  return value
}

export function pickerAbsoluteInput(input: string, home: string, current: string) {
  const value = normalizePickerDrive(input).replace(/^~(?=\/|$)/, normalizePickerDrive(home))

  return pickerAbsolutePath(value, current)
}

export function pickerAbsolutePath(input: string, current: string) {
  const value = normalizePickerDrive(input)
  const absolute = pickerRoot(value) ? value : joinPickerPath(current, value)

  return canonicalPickerPath(absolute)
}

export function treePathWithin(base: string | undefined, path: string) {
  return pickerRelativePath(base, path) !== undefined
}

export function canonicalPickerPath(path: string) {
  const value = normalizePickerDrive(path)
  const root = pickerRoot(value)
  const parts = value.slice(root.length).split("/")

  const resolved = parts.reduce<string[]>((output, part) => {
    if (!part || part === ".") return output

    if (part === "..") {
      output.pop()

      return output
    }

    output.push(part)

    return output
  }, [])

  return joinPickerPath(root, resolved.join("/"))
}

export function pickerRelativePath(base: string | undefined, path: string) {
  if (!base) return
  const rootPath = canonicalPickerPath(base)
  const targetPath = canonicalPickerPath(path)
  const insensitive = /^[A-Za-z]:\//.test(rootPath) || rootPath.startsWith("//")
  const root = insensitive ? rootPath.toLowerCase() : rootPath
  const target = insensitive ? targetPath.toLowerCase() : targetPath

  if (target === root) return ""
  const prefix = root.endsWith("/") ? root : root + "/"

  if (!target.startsWith(prefix)) return

  return targetPath.slice(prefix.length)
}

export type PickerPolicy = ReturnType<typeof pickerMode>

// The folder a typed or chosen path opens, or undefined when the mode does not allow it.
export function resolvePickerTarget(policy: PickerPolicy, path: string, home: string, base: string) {
  return policy.navigation(pickerAbsoluteInput(cleanPickerInput(path), home, base))
}

export function displayInputDirectory(path: string, home: string) {
  const displayed = displayPickerPath(path, "", home)
  const separator = displayed.includes("\\") ? "\\" : "/"

  return displayed.endsWith(separator) ? displayed : displayed + separator
}

export function pickerDisplaySeparator(displayed: string) {
  return displayed.includes("\\") ? "\\" : "/"
}

// `abort(key)` and `clear()` abort the task's signal and resolve its promise with undefined at once, so a task that
// never settles cannot keep its slot. The queue order lives in `PriorityQueueState`; this map holds only the I/O.
export function createPriorityTaskQueue<T>(concurrency: number) {
  type Entry = {
    controller: AbortController
    task: (signal: AbortSignal) => Promise<T>
    deferred: PromiseWithResolvers<T | undefined>
  }

  const entries = new Map<string, Entry>()
  let queue: PriorityQueueState = { status: "idle" }

  const dispatch = (event: PriorityQueueEvent) => {
    const result = transitionPriorityQueue(queue, event, concurrency)
    queue = result.state
    result.effects.forEach((effect) => {
      if (effect.type === "start") return start(effect.key)

      effect.keys.forEach((key) => {
        const entry = entries.get(key)

        if (!entry) return
        entries.delete(key)
        entry.controller.abort()
        entry.deferred.resolve(undefined)
      })
    })
  }

  // A task that settles after it was aborted, or after another task took its key, reports nothing.
  const start = (key: string) => {
    const entry = entries.get(key)

    if (!entry) return

    const settle = (outcome: { value: T | undefined } | { error: unknown }) => {
      if (entries.get(key) !== entry) return
      entries.delete(key)

      if ("error" in outcome) entry.deferred.reject(outcome.error)
      else entry.deferred.resolve(outcome.value)
      dispatch({ type: "settled", key })
    }

    void Promise.resolve()
      .then(() => (entry.controller.signal.aborted ? undefined : entry.task(entry.controller.signal)))
      .then(
        (value) => settle({ value }),
        (error) => settle({ error }),
      )
  }

  const schedule = (key: string, priority: TaskPriority, task: (signal: AbortSignal) => Promise<T>) => {
    const existing = entries.get(key)

    if (existing) {
      dispatch({ type: "scheduled", key, priority })

      return existing.deferred.promise
    }

    const entry: Entry = { controller: new AbortController(), task, deferred: Promise.withResolvers() }
    entries.set(key, entry)
    dispatch({ type: "scheduled", key, priority })

    return entry.deferred.promise
  }

  return {
    schedule,
    promote: (key: string) => dispatch({ type: "promoted", key }),
    abort: (key: string) => dispatch({ type: "aborted", key }),
    clear: () => dispatch({ type: "cleared" }),
  }
}

export function nextSuggestionIndex(current: number, delta: -1 | 1, count: number) {
  if (count === 0) return -1

  return (current + delta + count) % count
}

export function absoluteTreePath(root: string, path: string) {
  const base = trimPickerPath(root)
  const relative = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")

  if (!relative) return base || "/"

  if (!base || base === "/") return "/" + relative

  if (base.endsWith("/")) return base + relative

  return `${base}/${relative}`
}

export function selectedTreePath(root: string, path: string, mode: "directory" | "file", base?: string) {
  const directory = path.endsWith("/")

  if (mode === "file") {
    if (directory) return

    if (!base) return path
    const absolute = absoluteTreePath(root, path)

    return pickerRelativePath(base, absolute)
  }

  return directory ? nativePickerPath(absoluteTreePath(root, path)) : undefined
}

function nativePickerPath(path: string) {
  const value = trimPickerPath(path)

  if (/^[A-Za-z]:\//.test(value) || value.startsWith("//")) return value.replaceAll("/", "\\")

  return value
}

import { getFilename } from "@opencode/util/path"
import fuzzysort from "fuzzysort"
import { ServerSDK } from "@/runtime/server/client"
import {
  createDirectoryCacheState,
  directoryCacheEntry,
  transitionDirectoryCache,
  transitionPriorityQueue,
  type DirectoryCacheEvent,
  type PriorityQueueEvent,
  type PriorityQueueState,
  type TaskPriority,
} from "./queue-machine"

export function cleanPickerInput(value: string) {
  const first = (value ?? "").split(/\r?\n/)[0] ?? ""

  return first.replace(/[\u0000-\u001F\u007F]/g, "").trim()
}

function normalizePickerPath(input: string) {
  const value = input.replaceAll("\\", "/")

  if (value.startsWith("//") && !value.startsWith("///")) return "//" + value.slice(2).replace(/\/+/g, "/")

  return value.replace(/\/+/g, "/")
}

function normalizePickerDrive(input: string) {
  const value = normalizePickerPath(input)

  if (/^[A-Za-z]:$/.test(value)) return value + "/"

  return value
}

function trimPickerPath(input: string) {
  const value = normalizePickerDrive(input)

  if (value === "/" || value === "//" || /^[A-Za-z]:\/$/.test(value)) return value

  return value.replace(/\/+$/, "")
}

function joinPickerPath(base: string | undefined, relative: string) {
  const root = trimPickerPath(base ?? "")
  const path = trimPickerPath(relative).replace(/^\/+/, "")

  if (!root) return path

  if (!path) return root

  if (root.endsWith("/")) return root + path

  return root + "/" + path
}

export function pickerRoot(input: string) {
  const value = normalizePickerDrive(input)

  if (value.startsWith("//")) {
    const [server, share] = value.slice(2).split("/")

    if (server && share) return `//${server}/${share}`

    return "//"
  }

  if (value.startsWith("/")) return "/"

  if (/^[A-Za-z]:\//.test(value)) return value.slice(0, 3)

  return ""
}

export function pickerParent(input: string) {
  const value = trimPickerPath(input)
  const root = pickerRoot(value)

  if (value === root) return value

  if (value === "/" || value === "//" || /^[A-Za-z]:\/$/.test(value)) return value
  const index = value.lastIndexOf("/")

  if (index < root.length) return root

  if (index <= 0) return "/"

  if (index === 2 && /^[A-Za-z]:/.test(value)) return value.slice(0, 3)

  return value.slice(0, index)
}

function pickerTilde(absolute: string, home: string) {
  const path = trimPickerPath(absolute)

  if (!home) return ""
  const root = trimPickerPath(home)

  if (/^[A-Za-z]:\//.test(root)) return ""

  if (path === root) return "~"

  if (path.startsWith(root + "/")) return "~" + path.slice(root.length)

  return ""
}

export function displayPickerPath(path: string, input: string, home: string) {
  const value = trimPickerPath(path)

  if (/^[A-Za-z]:\//.test(trimPickerPath(home)) || /^[A-Za-z]:\//.test(value)) return value.replaceAll("/", "\\")

  return pickerTilde(value, home) || value
}

export function shortenPickerRecentPath(path: string, home: string) {
  const display = displayPickerPath(path, "", home)

  if (display.startsWith("~/")) {
    const parts = display.slice(2).split("/").filter(Boolean)

    if (parts.length <= 2) return display

    return `~/…/${parts.slice(-2).join("/")}`
  }

  if (display.startsWith("/") && !display.startsWith("//")) {
    const parts = display.slice(1).split("/").filter(Boolean)

    if (parts.length <= 2) return display

    return `/${parts[0]}/…/${parts.slice(-2).join("/")}`
  }

  if (/^[A-Za-z]:\\/.test(display)) {
    const parts = display.split("\\").filter(Boolean)

    if (parts.length <= 3) return display

    return `${parts[0]}\\…\\${parts.slice(-2).join("\\")}`
  }

  return display
}

export async function listPickerDirectory(
  sdk: ServerSDK,
  location: { directory: string; workspace?: string },
  directory: string,
  signal?: AbortSignal,
) {
  const result = await sdk.api.file.list({ location, path: directory }, { signal })

  return result.data.map((entry) => {
    const absolute = pickerAbsolutePath(entry.path, result.location.directory)

    return { name: getFilename(absolute), type: entry.type, absolute }
  })
}

export function createDirectorySearch(args: {
  sdk: ServerSDK
  location: () => { directory: string; workspace?: string } | undefined
  base: () => string | undefined
  home: () => string
}) {
  type Item = { name: string; absolute: string }

  // Reads end with the dialog, not with one search, since later searches reuse what they cached.
  const lifetime = new AbortController()
  const waiters = new Map<number, Array<(items: readonly Item[]) => void>>()
  let cache = createDirectoryCacheState<Item>()

  const dispatch = (event: DirectoryCacheEvent<Item>) => {
    const result = transitionDirectoryCache(cache, event)
    cache = result.state
    result.effects.forEach((effect) => {
      if (effect.type === "fetch") {
        const attempt = effect.attempt
        const key = effect.key
        void listPickerDirectory(args.sdk, effect.location, effect.directory, lifetime.signal).then(
          (nodes) =>
            dispatch({
              type: "lookup.succeeded",
              key,
              attempt,
              items: nodes.filter((node) => node.type === "directory"),
            }),
          () => dispatch({ type: "lookup.failed", key, attempt }),
        )

        return
      }

      if (effect.type === "resolve") {
        const resolve = waiters.get(effect.attempt) ?? []
        waiters.delete(effect.attempt)
        resolve.forEach((answer) => answer(effect.items))

        return
      }

      lifetime.abort()
      const pending = [...waiters.values()].flat()
      waiters.clear()
      pending.forEach((answer) => answer([]))
    })
  }

  const scoped = (value: string) => {
    const raw = normalizePickerDrive(value)
    const root = pickerRoot(raw)

    if (root) return { directory: trimPickerPath(root), path: raw.slice(root.length) }
    const base = args.base()

    if (!base) return

    if (!raw) return { directory: trimPickerPath(base), path: "" }
    const home = args.home()

    if (raw === "~") return { directory: trimPickerPath(home || base), path: "" }

    if (raw.startsWith("~/")) return { directory: trimPickerPath(home || base), path: raw.slice(2) }

    return { directory: trimPickerPath(base), path: raw }
  }

  const directories = async (directory: string): Promise<readonly Item[]> => {
    const location = args.location()

    if (!location) return []
    const key = JSON.stringify([location, trimPickerPath(directory)])
    dispatch({ type: "lookup.requested", key, location, directory })
    const entry = directoryCacheEntry(cache, key)

    if (!entry) return []

    if (entry.status === "ready") return entry.items
    const answer = Promise.withResolvers<readonly Item[]>()
    waiters.set(entry.attempt, [...(waiters.get(entry.attempt) ?? []), answer.resolve])

    return answer.promise
  }

  const match = async (directory: string, query: string, limit: number) => {
    const items = await directories(directory)

    if (!query) return items.slice(0, limit).map((item) => item.absolute)

    return fuzzysort.go(query, items, { key: "name", limit }).map((item) => item.obj.absolute)
  }

  const search = async (filter: string, options?: { signal?: AbortSignal }): Promise<string[]> => {
    const active = () => !options?.signal?.aborted
    const value = cleanPickerInput(filter)
    const input = scoped(value)
    const location = args.location()

    if (!input || !location) return []
    const raw = normalizePickerDrive(value)
    const pathInput = raw.startsWith("~") || !!pickerRoot(raw) || raw.includes("/")
    const query = normalizePickerDrive(input.path)

    if (!pathInput) {
      const relative = pickerRelativePath(location.directory, input.directory)

      const results =
        relative === undefined
          ? []
          : await args.sdk.api.file
              .find(
                { location, query: joinPickerPath(relative, query), type: "directory", limit: 50 },
                { signal: options?.signal },
              )
              .then((result) =>
                result.data
                  .map((entry) => pickerAbsolutePath(entry.path, result.location.directory))
                  .filter((path) => treePathWithin(input.directory, path)),
              )
              .catch(() => [])

      if (!active()) return []

      if (results.length) {
        return results.slice(0, 50)
      }

      const fallback = query
        ? await match(input.directory, query, 50)
        : (await directories(input.directory)).map((item) => item.absolute)

      if (!active()) return []

      return fallback
    }

    const segments = query.replace(/^\/+/, "").split("/")
    const head = segments.slice(0, -1).filter((part) => part && part !== ".")
    const tail = segments.at(-1) ?? ""
    let paths = [input.directory]

    for (const part of head) {
      if (!active()) return []

      if (part === "..") {
        paths = paths.map(pickerParent)
        continue
      }

      paths = Array.from(new Set((await Promise.all(paths.map((path) => match(path, part, 4)))).flat())).slice(0, 12)

      if (!active() || paths.length === 0) return []
    }

    const matches = Array.from(new Set((await Promise.all(paths.map((path) => match(path, tail, 50)))).flat()))

    if (!active()) return []
    const base = raw.startsWith("~") ? trimPickerPath(input.directory) : ""

    if (raw.endsWith("/") || !tail) return Array.from(new Set([base, ...matches].filter(Boolean))).slice(0, 50)
    const target = matches.find((path) => getFilename(path).toLowerCase() === tail.toLowerCase())

    if (!target) return matches.slice(0, 50)
    const children = await match(target, "", 30)

    if (!active()) return []

    return Array.from(new Set([base, ...matches, ...children].filter(Boolean))).slice(0, 50)
  }

  return Object.assign(search, { dispose: () => dispatch({ type: "disposed" }) })
}

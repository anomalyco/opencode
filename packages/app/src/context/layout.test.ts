import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionKeyReader, ensureSessionKey, pruneSessionKeys } from "./layout-helpers"

describe("layout session-key helpers", () => {
  test("couples touch and scroll seed in order", () => {
    const calls: string[] = []
    const result = ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    )

    expect(result).toBe("dir/a")
    expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])
  })

  test("reads dynamic accessor keys lazily", () => {
    const seen: string[] = []

    createRoot((dispose) => {
      const [key, setKey] = createSignal("dir/one")
      const read = createSessionKeyReader(key, (value) => seen.push(value))

      expect(read()).toBe("dir/one")
      setKey("dir/two")
      expect(read()).toBe("dir/two")

      dispose()
    })

    expect(seen).toEqual(["dir/one", "dir/two"])
  })
})

describe("pruneSessionKeys", () => {
  test("keeps active key and drops lowest-used keys", () => {
    const drop = pruneSessionKeys({
      keep: "k4",
      max: 3,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
        ["k3", 3],
        ["k4", 4],
      ]),
      view: ["k1", "k2", "k4"],
      tabs: ["k1", "k3", "k4"],
    })

    expect(drop).toEqual(["k1"])
    expect(drop.includes("k4")).toBe(false)
  })

  test("does not prune without keep key", () => {
    const drop = pruneSessionKeys({
      keep: undefined,
      max: 1,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
      view: ["k1"],
      tabs: ["k2"],
    })

    expect(drop).toEqual([])
  })
})

describe("rootFor drive root guard", () => {
  // Simulates the roots() memo: sandbox -> worktree map keyed by pathKey
  const makeRoots = (entries: { sandbox: string; worktree: string }[]) => {
    const map = new Map<string, string>()
    for (const { sandbox, worktree } of entries) {
      map.set(pathKey(sandbox), worktree)
    }
    return map
  }

  const pathKey = (path: string) => {
    const isWinPath = path[1] === ":" || path.startsWith("\\\\")
    const value = isWinPath ? path.replaceAll("\\", "/") : path
    const trimmed = value.replace(/\/+$/, "")
    if (!trimmed && value.startsWith("/")) return "/"
    const isDrive = trimmed.length === 2 && path[1] === ":" && /^[A-Za-z]$/.test(path[0])
    if (isDrive) return `${trimmed}/`
    return trimmed
  }

  const rootFor = (directory: string, map: Map<string, string>) => {
    if (map.size === 0) return directory
    const visited = new Set<string>()
    const chain = [directory]
    while (chain.length) {
      const current = chain[chain.length - 1]
      if (!current) return directory
      if (current !== "/" && /^[a-z]:\//i.test(current) && pathKey(current).length <= 3) return directory
      const next = map.get(pathKey(current))
      if (!next) return current
      const nextKey = pathKey(next)
      if (visited.has(nextKey)) return directory
      visited.add(nextKey)
      chain.push(next)
    }
    return directory
  }

  test("returns drive root when sandbox resolves to drive root", () => {
    const map = makeRoots([{ sandbox: "C:/foo", worktree: "C:/" }])
    expect(rootFor("C:/", map)).toBe("C:/")
    // Guard prevents traversal through drive roots, so C:/foo stays as-is
    expect(rootFor("C:/foo", map)).toBe("C:/foo")
  })

  test("stops traversal when reaching a drive root from a deeper path", () => {
    const map = makeRoots([
      { sandbox: "C:/bar", worktree: "C:/foo" },
      { sandbox: "C:/foo", worktree: "C:/" },
    ])
    expect(rootFor("C:/bar", map)).toBe("C:/bar")
  })

  test("normalizes drive roots regardless of slash style", () => {
    const map = makeRoots([{ sandbox: "C:/foo", worktree: "C:/" }])
    // C:\ normalizes to C:/ by pathKey, which is a drive root, so input stays as-is
    expect(rootFor("C:\\", map)).toBe("C:\\")
  })

  test("does not prevent normal sandbox resolution for non-drive roots", () => {
    const map = makeRoots([{ sandbox: "/home/user/repo", worktree: "/home/user/repo/main" }])
    expect(rootFor("/home/user/repo", map)).toBe("/home/user/repo/main")
  })

  test("handles empty map by returning directory unchanged", () => {
    const map = makeRoots([])
    expect(rootFor("C:/foo", map)).toBe("C:/foo")
    expect(rootFor("/tmp/test", map)).toBe("/tmp/test")
  })
})

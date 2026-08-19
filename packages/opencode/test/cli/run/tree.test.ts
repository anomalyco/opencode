import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import {
  DescendantFetchError,
  fetchDescendants,
  lookupSessionTreeOwnership,
  replyPermission,
  resolveSessionTreeOwnership,
} from "@/cli/cmd/run/tree"

function client(input: {
  children?: (sessionID: string, signal?: AbortSignal) => Promise<Array<{ id: string; title?: string }>>
  get?: (sessionID: string) => Promise<{ parentID?: string }>
  reply?: (input: { requestID: string; reply: "once" | "always" | "reject" }) => Promise<{
    data?: boolean
    error?: unknown
  }>
}) {
  return {
    permission: {
      reply: (params: { requestID: string; reply: "once" | "always" | "reject" }) => input.reply?.(params),
    },
    session: {
      children: (params: { sessionID: string }, options?: { signal?: AbortSignal }) =>
        input.children?.(params.sessionID, options?.signal).then((data) => ({ data })),
      get: (params: { sessionID: string }) => input.get?.(params.sessionID).then((data) => ({ data })),
    },
  } as unknown as OpencodeClient
}

describe("run session tree", () => {
  test("surfaces descendant lookup failures with successfully traversed branches", async () => {
    const sdk = client({
      children: async (sessionID) => {
        if (sessionID === "root") return [{ id: "child-a" }, { id: "child-b" }]
        if (sessionID === "child-a") throw new Error("child-a unavailable")
        if (sessionID === "child-b") return [{ id: "grandchild-b" }]
        return []
      },
    })

    try {
      await fetchDescendants(sdk, "root")
      throw new Error("expected descendant traversal to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(DescendantFetchError)
      if (!(error instanceof DescendantFetchError)) return
      expect(error.failures.map((item) => item.sessionID)).toEqual(["child-a"])
      expect(error.partial.map((item) => item.id)).toEqual(["child-a", "child-b", "grandchild-b"])
    }
  })

  test("does not revisit a cycle", async () => {
    const sdk = client({
      children: async (sessionID) => {
        if (sessionID === "root") return [{ id: "child" }]
        if (sessionID === "child") return [{ id: "root" }]
        return []
      },
    })

    expect(await fetchDescendants(sdk, "root")).toEqual([{ id: "child" }])
  })

  test("bounds concurrent descendant lookups", async () => {
    let active = 0
    let maxActive = 0
    const sdk = client({
      children: async (sessionID) => {
        if (sessionID === "root") return Array.from({ length: 6 }, (_, index) => ({ id: `child-${index}` }))
        active += 1
        maxActive = Math.max(maxActive, active)
        await Bun.sleep(20)
        active -= 1
        return []
      },
    })

    await fetchDescendants(sdk, "root", { concurrency: 2 })
    expect(maxActive).toBe(2)
  })

  test("uses bounded defaults for invalid options", async () => {
    let active = 0
    let maxActive = 0
    const sdk = client({
      children: async (sessionID) => {
        if (sessionID === "root") return Array.from({ length: 6 }, (_, index) => ({ id: `child-${index}` }))
        active += 1
        maxActive = Math.max(maxActive, active)
        await Bun.sleep(20)
        active -= 1
        return []
      },
    })

    await fetchDescendants(sdk, "root", { concurrency: Number.POSITIVE_INFINITY, limit: Number.NaN })
    expect(maxActive).toBe(4)
  })

  test("returns partial data when the session limit is reached", async () => {
    const sdk = client({
      children: async (sessionID) =>
        sessionID === "root" ? [{ id: "child-a" }, { id: "child-b" }, { id: "child-c" }] : [],
    })

    try {
      await fetchDescendants(sdk, "root", { limit: 2 })
      throw new Error("expected descendant traversal to reach its limit")
    } catch (error) {
      expect(error).toBeInstanceOf(DescendantFetchError)
      if (!(error instanceof DescendantFetchError)) return
      expect(error.partial).toEqual([{ id: "child-a" }])
      expect(String(error.failures[0]?.error)).toContain("session tree exceeds 2 entries")
    }
  })

  test("cancels descendant lookups", async () => {
    let started: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const sdk = client({
      children: async (sessionID, signal) => {
        if (sessionID === "root") return [{ id: "child" }]
        started?.()
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      },
    })
    const controller = new AbortController()
    const pending = fetchDescendants(sdk, "root", { signal: controller.signal })

    await ready
    controller.abort(new Error("stopped"))
    await expect(pending).rejects.toThrow("stopped")
  })

  test("times out stalled descendant lookups", async () => {
    const sdk = client({
      children: async (sessionID, signal) => {
        if (sessionID === "root") return [{ id: "child" }]
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      },
    })

    await expect(fetchDescendants(sdk, "root", { timeoutMs: 20 })).rejects.toBeInstanceOf(DescendantFetchError)
  })

  test("bounds total traversal time", async () => {
    const sdk = client({
      children: async (sessionID, signal) => {
        if (sessionID === "root") return [{ id: "child" }]
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      },
    })

    const started = Date.now()
    await expect(fetchDescendants(sdk, "root", { timeoutMs: 1_000, totalTimeoutMs: 20 })).rejects.toBeInstanceOf(
      DescendantFetchError,
    )
    expect(Date.now() - started).toBeLessThan(500)
  })

  test("models a failed ancestry lookup as unknown", async () => {
    let lookups = 0
    const sdk = client({
      get: () => {
        lookups += 1
        return Promise.reject(new Error("session lookup unavailable"))
      },
    })

    const ownership = await lookupSessionTreeOwnership(sdk, new Set(["root"]), "leaf")
    expect(ownership.type).toBe("unknown")
    expect(lookups).toBe(1)
    if (ownership.type === "unknown") expect(String(ownership.error)).toContain("session lookup unavailable")
  })

  test("cancels retained ancestry retries", async () => {
    let lookups = 0
    let retryStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      retryStarted = resolve
    })
    const sdk = client({
      get: () => {
        lookups += 1
        return Promise.reject(new Error("session lookup unavailable"))
      },
    })
    const controller = new AbortController()
    const resolving = resolveSessionTreeOwnership(sdk, new Set(["root"]), "leaf", {
      signal: controller.signal,
      onUnknown: () => retryStarted?.(),
    })

    await started
    controller.abort()
    expect(await resolving).toEqual({ type: "cancelled" })
    const stoppedAt = lookups
    await Bun.sleep(150)
    expect(lookups).toBe(stoppedAt)
  })

  test("returns foreign only after reaching a known root", async () => {
    const sdk = client({
      get: () => Promise.resolve({ parentID: undefined }),
    })

    expect(await lookupSessionTreeOwnership(sdk, new Set(["root"]), "foreign")).toEqual({ type: "foreign" })
  })

  test("adds a resolved ancestry path to the known tree", async () => {
    const parents = new Map<string, string | undefined>([
      ["leaf", "middle"],
      ["middle", "root"],
    ])
    const sdk = client({
      get: async (sessionID) => {
        if (!parents.has(sessionID)) throw new Error(`unexpected lookup: ${sessionID}`)
        return { parentID: parents.get(sessionID) }
      },
    })
    const tree = new Set(["root"])

    expect(await resolveSessionTreeOwnership(sdk, tree, "leaf", { signal: new AbortController().signal })).toEqual({
      type: "owned",
      value: undefined,
    })
    expect(tree).toEqual(new Set(["root", "leaf", "middle"]))
  })

  test("gives up on an unresolvable ancestry instead of retrying forever", async () => {
    // A parent chain cycle and a deleted parent both fail permanently. Retrying
    // them forever leaves the server's permission deferred unanswered, so the
    // walk has to surface exhaustion to the caller.
    let lookups = 0
    const sdk = client({
      get: (sessionID) => {
        lookups += 1
        return Promise.resolve({ parentID: sessionID === "leaf" ? "middle" : "leaf" })
      },
    })

    const resolution = await resolveSessionTreeOwnership(sdk, new Set(["root"]), "leaf", {
      signal: new AbortController().signal,
      attempts: 3,
    })

    expect(resolution.type).toBe("exhausted")
    if (resolution.type === "exhausted") expect(String(resolution.error)).toContain("cycle detected")
    expect(lookups).toBeGreaterThan(0)
  })

  test("gives up when a parent points at a missing session", async () => {
    const sdk = client({
      get: (sessionID) => {
        if (sessionID === "leaf") return Promise.resolve({ parentID: "deleted" })
        return Promise.reject(new Error(`session not found: ${sessionID}`))
      },
    })

    const resolution = await resolveSessionTreeOwnership(sdk, new Set(["root"]), "leaf", {
      signal: new AbortController().signal,
      attempts: 2,
    })

    expect(resolution.type).toBe("exhausted")
    if (resolution.type === "exhausted") expect(String(resolution.error)).toContain("session not found")
  })

  test("treats a missing permission request as already answered", async () => {
    // The server drops pending requests when a session aborts and rejects the
    // cascade itself, so a reply that lost that race must not fail the run.
    const sdk = client({
      reply: () => Promise.reject({ _tag: "PermissionNotFoundError", requestID: "perm-1", message: "gone" }),
    })

    await expect(replyPermission(sdk, { requestID: "perm-1", reply: "once" })).resolves.toBeUndefined()
  })

  test("rejects permission reply error envelopes", async () => {
    const sdk = client({
      reply: () => Promise.resolve({ error: new Error("reply rejected") }),
    })

    await expect(replyPermission(sdk, { requestID: "perm-1", reply: "once" })).rejects.toThrow("reply rejected")
  })
})

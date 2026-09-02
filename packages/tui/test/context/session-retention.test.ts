import { expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { createData } from "@opencode-ai/client/solid"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createRoot, createSignal } from "solid-js"
import { createSessionRetention } from "../../src/context/session-retention"
import { createApi, createFetch, directory, json } from "../fixture/tui-client"

function setup(options: { keep?: string[]; current?: string; limit?: number } = {}) {
  return createRoot((dispose) => {
    const events = createGlobalEmitter<{
      [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }>
    }>()
    const api = createApi(
      createFetch((url) => {
        if (url.pathname.endsWith("/message"))
          return json({
            data: [{ id: "msg_test", type: "user", text: "Transcript", time: { created: 1 } }],
            cursor: {},
          })
        if (url.pathname.endsWith("/inbox")) return json({ data: [] })
        return undefined
      }).fetch,
    )
    const data = createData({ api: () => api, event: events, directory })
    const [current, setCurrent] = createSignal(options.current)
    const [keep, setKeep] = createSignal(options.keep ?? [])
    const evictions: string[] = []
    createSessionRetention({
      session: {
        ...data.session,
        evict(id) {
          evictions.push(id)
          data.session.evict(id)
        },
      },
      current,
      keep,
      limit: options.limit ?? 3,
    })
    return {
      dispose,
      data,
      events,
      evictions,
      setCurrent,
      setKeep,
      remember(id: string, parentID?: string, updated = 0) {
        data.session.remember({
          id,
          parentID,
          projectID: "project",
          location: { directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated },
        })
      },
      async view(id: string) {
        setCurrent(id)
        await data.session.message.sync(id)
      },
      cached: (id: string) => data.session.message.list(id).length > 0,
    }
  })
}

test("retains three recently viewed families and child views touch their root", async () => {
  const scope = setup()
  try {
    for (const id of ["a", "b", "c", "d", "e"]) scope.remember(id)
    scope.remember("child", "a")
    scope.remember("grandchild", "child")
    await scope.view("a")
    await scope.view("grandchild")
    await scope.view("b")
    await scope.view("c")
    await scope.view("child")
    await scope.view("d")
    expect(["a", "child", "grandchild", "c", "d"].every(scope.cached)).toBe(true)
    expect(scope.cached("b")).toBe(false)

    scope.setCurrent(undefined)
    expect(scope.cached("a")).toBe(true)
    await scope.view("e")
    expect(scope.cached("c")).toBe(false)
    await scope.view("c")
    expect(["a", "child", "grandchild"].some(scope.cached)).toBe(false)
    expect(["c", "d", "e"].every(scope.cached)).toBe(true)
    expect(scope.data.session.family("a").toSorted()).toEqual(["a", "child", "grandchild"])
  } finally {
    scope.dispose()
  }
})

test("explicitly kept families are exempt from the recent-family budget", async () => {
  const scope = setup({ keep: ["a", "b", "c", "d"] })
  try {
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      scope.remember(id)
      await scope.view(id)
    }
    expect(["a", "b", "c", "d", "f", "g", "h"].every(scope.cached)).toBe(true)
    expect(scope.cached("e")).toBe(false)

    scope.setKeep(["b", "c", "d"])
    expect(scope.cached("a")).toBe(false)
    await scope.view("b")
    scope.setKeep(["c", "d"])
    expect(scope.cached("b")).toBe(true)
    expect(scope.cached("f")).toBe(false)
    scope.setKeep([])
    expect(["c", "d"].some(scope.cached)).toBe(false)
    expect(["b", "g", "h"].every(scope.cached)).toBe(true)
  } finally {
    scope.dispose()
  }
})

test("background metadata changes do not refresh view recency or repeat eviction", async () => {
  const scope = setup()
  try {
    for (const id of ["a", "b", "c"]) {
      scope.remember(id)
      await scope.view(id)
    }
    scope.remember("a", undefined, 100)
    scope.remember("d")
    await scope.view("d")
    expect(scope.cached("a")).toBe(false)
    expect(["b", "c", "d"].every(scope.cached)).toBe(true)
    const count = scope.evictions.length
    scope.remember("a", undefined, 200)
    scope.remember("d", undefined, 300)
    expect(scope.evictions.length).toBe(count)
  } finally {
    scope.dispose()
  }
})

test("unviewed families and newly discovered descendants are evicted", async () => {
  const scope = setup({ current: "current" })
  try {
    await scope.data.session.message.sync("background")
    expect(scope.cached("background")).toBe(true)
    scope.remember("background")
    expect(scope.cached("background")).toBe(false)
    await scope.data.session.message.sync("child")
    scope.remember("child", "background")
    expect(scope.cached("child")).toBe(false)
    expect(scope.evictions.filter((id) => id === "background")).toHaveLength(2)

    scope.remember("current")
    scope.remember("kept-child", "current")
    await scope.data.session.message.sync("kept-child")
    scope.remember("kept-child", "current", 10)
    expect(scope.cached("kept-child")).toBe(true)
    expect(
      scope.data.session
        .list()
        .map((session) => session.id)
        .toSorted(),
    ).toEqual(["background", "child", "current", "kept-child"])
  } finally {
    scope.dispose()
  }
})

test("current child protects late-arriving ancestry and reopening restores an evicted transcript", async () => {
  const scope = setup({ current: "child" })
  try {
    scope.remember("root")
    await scope.data.session.message.sync("child")
    scope.remember("child", "parent")
    scope.remember("parent", "root")
    scope.remember("root")
    expect(scope.cached("child")).toBe(true)
    expect(scope.evictions).toEqual(["root"])
    for (const id of ["a", "b", "c"]) {
      scope.remember(id)
      await scope.view(id)
    }
    expect(scope.cached("child")).toBe(false)
    await scope.view("child")
    expect(scope.cached("child")).toBe(true)
    expect(scope.cached("a")).toBe(false)
  } finally {
    scope.dispose()
  }
})

test("uses the caller's recent-family limit", async () => {
  const scope = setup({ keep: ["a"], limit: 1 })
  try {
    for (const id of ["a", "b", "c"]) {
      scope.remember(id)
      await scope.view(id)
    }
    expect(scope.cached("a")).toBe(true)
    expect(scope.cached("b")).toBe(false)
    expect(scope.cached("c")).toBe(true)
  } finally {
    scope.dispose()
  }
})

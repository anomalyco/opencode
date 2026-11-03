import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { DataContext, useData, type TurnDiffSource } from "@opencode/session-ui/context"
import { MarkdownContext, useMarkdown, type ReadMarkdownImage } from "@opencode/session-ui/context/markdown"
import {
  batch,
  createComponent,
  createComputed,
  createEffect,
  createMemo,
  createRoot,
  on,
  onCleanup,
  type Context,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { ServerScope, SessionRouteKey, SessionStateKey } from "../src/runtime/server/scope"
import { createTimelineActions } from "../src/session/composer/timeline-actions"
import { createTimelineCache } from "../src/session/timeline/cache"
import { useWorkspaceLocation, WorkspaceLocationContext } from "../src/workspaces/location"

function setup() {
  return createRoot((dispose) => {
    const [state, setState] = createStore<{
      id: string
      directory: string
      visible: boolean
      deferred: boolean
      turnDiff: string
      messages: Partial<Record<string, SessionMessageInfo[]>>
      parents: Partial<Record<string, string>>
    }>({
      id: "ses_a",
      directory: "/repo",
      visible: true,
      deferred: false,
      turnDiff: "a1",
      messages: {
        ses_a: [{ id: "msg_a", type: "user", text: "First session", time: { created: 1 } }],
        ses_b: [{ id: "msg_b", type: "user", text: "Second session", time: { created: 2 } }],
      },
      parents: {},
    })

    const views = new Map<
      string,
      { active: () => boolean; messages: () => SessionMessageInfo[]; element: HTMLDivElement }
    >()

    const disposed: string[] = []

    // The Location of every provider value each view reads, by the view's session and Location.
    const reads: Record<string, string[]> = {}
    const imageReaders = new Map<ReadMarkdownImage, string>()
    // What each view reads once a deferred part of it, like a Markdown block, first renders.
    const deferredReads: Record<string, string[]> = {}
    const shellOutput = async () => ({ data: { cursor: 0, size: 0, output: "" } })
    const shells: Record<string, boolean[]> = {}
    // Turn diff sources by label, as the host binds one to the routed tab, and the labels each view saw.
    const turnDiffSources = new Map<string, TurnDiffSource>()

    const turnDiffSource = (label: string) => {
      const source = turnDiffSources.get(label) ?? { get: () => undefined, load: () => {} }
      turnDiffSources.set(label, source)

      return source
    }

    const turnDiffs: Record<string, string[]> = {}
    // Views whose effects saw their transcript empty, as a subagent's view reloads its evicted parent.
    const reloads: string[] = []
    // The sessions each view's message actions read, and whether they were a child's.
    const actions: Record<string, string[]> = {}
    let directoryReads = 0

    const imageReader = createMemo(() => {
      const read: ReadMarkdownImage = async () => undefined
      imageReaders.set(read, state.directory)

      return read
    })

    const location = createMemo(() => ({
      directory: state.directory,
      event: { on: () => () => {}, listen: () => () => {} },
      ref: { directory: state.directory },
      current: undefined,
      missing: undefined,
    }))

    const provide = <T>(context: Context<T>, value: T, children: () => JSX.Element) =>
      createComponent(context.Provider, {
        value,
        get children() {
          return children()
        },
      })

    let cache!: () => JSX.Element
    provide(WorkspaceLocationContext, location, () =>
      provide(
        DataContext,
        {
          store: { session: [], session_status: {}, session_diff: {} },
          get directory() {
            directoryReads++

            return state.directory
          },
          sessionID: undefined,
          agents: true,
          get backgroundCompaction() {
            return state.directory === "/other"
          },
          navigateToSession: undefined,
          sessionHref: undefined,
          shellRunning: undefined,
          shellOutput,
          get turnDiff() {
            return turnDiffSource(state.turnDiff)
          },
        },
        () =>
          provide(
            MarkdownContext,
            {
              get readImage() {
                return imageReader()
              },
            },
            () => {
              cache = createSessionTimelineCache()

              return null
            },
          ),
      ),
    )

    return {
      state,
      setState,
      cache,
      views,
      disposed,
      reads,
      deferredReads,
      shells,
      turnDiffs,
      reloads,
      actions,
      directoryReads: () => directoryReads,
      dispose,
    }

    function createSessionTimelineCache() {
      return createTimelineCache(
        {
          identity: {
            params: {
              get id() {
                return state.id
              },
              serverKey: "local",
            },
            sessionID: () => state.id,
            sessionKey: () =>
              SessionStateKey.from(ServerScope.local, SessionRouteKey.fromRoute(state.directory, state.id)),
          },
          data: {
            info: createMemo(() => ({
              id: state.id,
              projectID: "project",
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: 1, updated: 1 },
              location: { directory: state.directory },
            })),
            parent: () => undefined,
            parentID: () => state.parents[state.id],
            status: () => ({ type: "idle" }),
          },
          history: { messages: () => state.messages[state.id] ?? [] },
        },
        (source, active) => {
          const id = source.identity.sessionID()!
          const element = document.createElement("div")
          const workspace = useWorkspaceLocation()
          const data = useData()
          const markdown = useMarkdown()
          createMemo(() =>
            element.setAttribute(
              "data-messages",
              source.history
                .messages()
                .map((message) => message.id)
                .join(","),
            ),
          )
          const view = `${id} in ${state.directory}`
          createComputed(() => {
            const readImage = markdown?.readImage
            reads[view] = [
              ...(reads[view] ?? []),
              workspace().directory,
              data.directory,
              (readImage && imageReaders.get(readImage)) ?? "",
            ]
          })
          createComputed(() => {
            if (!state.deferred) return
            const readImage = markdown?.readImage
            deferredReads[view] = [
              workspace().directory,
              data.directory,
              (readImage && imageReaders.get(readImage)) ?? "",
              data.backgroundCompaction ? "/other" : "/repo",
            ]
          })
          createComputed(() => {
            const source = data.turnDiff
            const label = [...turnDiffSources].find((entry) => entry[1] === source)?.[0] ?? ""
            turnDiffs[view] = [...(turnDiffs[view] ?? []), label]
          })
          createComputed(() => {
            shells[view] = [...(shells[view] ?? []), data.shellOutput === shellOutput]
          })
          createEffect(
            on(
              () => (state.messages[id] ?? []).length,
              (count) => {
                if (count === 0) reloads.push(id)
              },
              { defer: true },
            ),
          )

          const timelineActions = createTimelineActions(
            { sessionID: source.identity.sessionID, isChild: () => !!source.data.parentID() },
            {
              revert: () => {},
              fork: () => {},
              chooseModel: () => {},
              openAttachment: () => {},
              pending: {
                status: (sessionID) => (sessionID === id ? "queued" : undefined),
                queue: async () => {},
                remove: async () => {},
              },
            },
          )

          createComputed(() => {
            const status = timelineActions.pending?.status("msg")
            actions[view] = [...(actions[view] ?? []), timelineActions.revert ? `root ${status}` : "child"]
          })
          views.set(id, { active, messages: source.history.messages, element })
          onCleanup(() => disposed.push(id))

          return element
        },
        () => state.visible,
        (id) => state.messages[id] ?? [],
      )
    }
  })
}

test("reuses a session view and refreshes its own history when selected again", () => {
  const input = setup()

  try {
    const first = input.cache()
    input.setState("id", "ses_b")
    const second = input.cache()
    expect(second).not.toBe(first)
    expect(input.views.get("ses_a")!.active()).toBe(false)
    expect(input.views.get("ses_a")!.element.dataset.messages).toBe("msg_a")
    expect(input.views.get("ses_b")!.element.dataset.messages).toBe("msg_b")

    input.setState("messages", "ses_a", [
      { id: "msg_c", type: "user", text: "Updated while inactive", time: { created: 3 } },
    ])
    input.setState("id", "ses_a")
    expect(input.cache()).toBe(first)
    expect(input.views.get("ses_a")!.active()).toBe(true)
    expect(input.views.get("ses_a")!.element.dataset.messages).toBe("msg_c")
    expect(input.views.get("ses_b")!.element.dataset.messages).toBe("msg_b")
    expect(input.disposed).toEqual([])
  } finally {
    input.dispose()
  }

  expect(input.disposed.sort()).toEqual(["ses_a", "ses_b"])
})

test("disposes a detached view once its transcript is evicted, but never the selected one", async () => {
  const input = setup()

  try {
    const first = input.cache()
    input.setState("messages", "ses_a", [])
    await Promise.resolve()
    expect(input.disposed).toEqual([])

    input.setState("messages", "ses_a", [{ id: "msg_a", type: "user", text: "Reloaded", time: { created: 1 } }])
    input.setState("id", "ses_b")
    input.cache()
    input.setState("messages", "ses_a", [])
    await Promise.resolve()
    expect(input.disposed).toEqual(["ses_a"])

    input.setState("id", "ses_a")
    expect(input.cache()).not.toBe(first)
  } finally {
    input.dispose()
  }
})

test("a detached view goes before its effects can reload its evicted transcript", () => {
  const input = setup()

  try {
    input.cache()
    input.setState("id", "ses_b")
    input.cache()
    input.setState("messages", "ses_a", [])
    expect(input.disposed).toEqual(["ses_a"])
    expect(input.reloads).toEqual([])
  } finally {
    input.dispose()
  }
})

test("a session moved to another Location replaces its view under the old one", () => {
  const input = setup()

  try {
    const first = input.cache()
    input.setState("directory", "/moved")
    expect(input.cache()).not.toBe(first)
    expect(input.disposed).toEqual(["ses_a"])
  } finally {
    input.dispose()
  }
})

test("a detached view's message actions keep its own session while a child session is routed", () => {
  const input = setup()

  try {
    input.cache()
    input.setState({ id: "ses_child", parents: { ses_child: "ses_a" } })
    input.cache()
    input.setState("id", "ses_b")
    input.cache()
    expect(input.actions).toEqual({
      "ses_a in /repo": ["root queued"],
      "ses_child in /repo": ["child"],
      "ses_b in /repo": ["root queued"],
    })
  } finally {
    input.dispose()
  }
})

test("suspends a detached mobile view and reuses it when the conversation returns", () => {
  const input = setup()

  try {
    const first = input.cache()
    input.setState("visible", false)
    expect(input.views.get("ses_a")!.active()).toBe(false)
    input.setState("visible", true)
    expect(input.cache()).toBe(first)
    expect(input.views.get("ses_a")!.active()).toBe(true)
  } finally {
    input.dispose()
  }
})

for (const order of ["session-first", "workspace-first"] as const) {
  test(`keeps views across Locations, each reading only its own Location, when updates are ${order}`, () => {
    const input = setup()

    const select = (id: string, directory: string) => {
      if (order === "workspace-first") input.setState("directory", directory)
      input.setState("id", id)

      if (order === "session-first") input.setState("directory", directory)

      return input.cache()
    }

    try {
      const first = input.cache()
      const second = select("ses_b", "/other")
      expect(second).not.toBe(first)
      expect(select("ses_a", "/repo")).toBe(first)
      expect(select("ses_b", "/other")).toBe(second)

      // A Location change while the conversation is hidden keeps both views too.
      input.setState("visible", false)
      select("ses_a", "/repo")
      input.setState("visible", true)
      expect(input.cache()).toBe(first)

      expect(input.disposed).toEqual([])
      expect(Object.keys(input.reads).sort()).toEqual(["ses_a in /repo", "ses_b in /other"])
      expect(new Set(input.reads["ses_a in /repo"])).toEqual(new Set(["/repo"]))
      expect(new Set(input.reads["ses_b in /other"])).toEqual(new Set(["/other"]))
    } finally {
      input.dispose()
    }

    expect(input.disposed.sort()).toEqual(["ses_a", "ses_b"])
  })
}

for (const order of ["session-first", "workspace-first"] as const) {
  test(`keeps views live across five workspaces when updates are ${order}`, () => {
    const input = setup()
    input.setState("directory", "/repo/ses_a")
    const render = createRoot((dispose) => ({ selected: createMemo(input.cache), dispose }))

    try {
      ;["ses_b", "ses_c", "ses_d", "ses_e", "ses_a", "ses_c", "ses_b", "ses_e", "ses_d", "ses_a"].forEach(
        (id, index) => {
          batch(() => {
            if (order === "workspace-first") input.setState("directory", `/repo/${id}`)
            input.setState("id", id)

            if (order === "session-first") input.setState("directory", `/repo/${id}`)
          })
          expect(input.disposed).toEqual([])
          input.setState("messages", id, [
            { id: `msg_live_${index}`, type: "user", text: "Live update", time: { created: index + 3 } },
          ])
          render.selected()
          expect(input.views.get(id)!.element.dataset.messages).toBe(`msg_live_${index}`)
          expect(input.views.get(id)!.active()).toBe(true)
        },
      )
      Object.entries(input.reads).forEach(([view, directories]) =>
        expect(new Set(directories)).toEqual(new Set([view.split(" in ")[1]])),
      )
    } finally {
      render.dispose()
      input.dispose()
    }
  })
}

test("a view first reading its providers while another Location is selected reads its own", () => {
  const input = setup()

  try {
    input.cache()
    input.setState("id", "ses_b")
    input.setState("directory", "/other")
    input.cache()
    input.setState("deferred", true)
    expect(input.deferredReads).toEqual({
      "ses_a in /repo": ["/repo", "/repo", "/repo", "/repo"],
      "ses_b in /other": ["/other", "/other", "/other", "/other"],
    })
  } finally {
    input.dispose()
  }
})

test("a detached view's readers stay still when another Location is selected", () => {
  const input = setup()

  try {
    input.cache()
    const runs = input.reads["ses_a in /repo"]!.length
    input.setState("id", "ses_b")
    input.setState("directory", "/other")
    input.cache()
    input.setState("id", "ses_c")
    input.setState("directory", "/third")
    input.cache()
    expect(input.reads["ses_a in /repo"]!.length).toBe(runs)
  } finally {
    input.dispose()
  }
})

test("a detached view's shells stop reading output until it is selected again", () => {
  const input = setup()

  try {
    input.cache()
    input.setState("id", "ses_b")
    input.cache()
    expect(input.shells["ses_a in /repo"]!.at(-1)).toBe(false)
    expect(input.shells["ses_b in /repo"]!.at(-1)).toBe(true)
    input.setState("id", "ses_a")
    input.cache()
    expect(input.shells["ses_a in /repo"]!.at(-1)).toBe(true)
    expect(input.shells["ses_b in /repo"]!.at(-1)).toBe(false)
  } finally {
    input.dispose()
  }
})

test("a view follows its routed tab's turn diffs while selected and keeps them once detached", () => {
  const input = setup()

  try {
    input.cache()
    // The tab of a newly opened session arrives after its route.
    input.setState("turnDiff", "a2")
    expect(input.turnDiffs["ses_a in /repo"]!.at(-1)).toBe("a2")
    // A child session's tab returns to its parent, whose route resolves its own tab.
    input.setState({ id: "ses_b", turnDiff: "b1" })
    input.cache()
    expect(input.turnDiffs["ses_a in /repo"]!.at(-1)).toBe("a2")
    expect(input.turnDiffs["ses_b in /repo"]!.at(-1)).toBe("b1")
  } finally {
    input.dispose()
  }
})

test("reads each provider value once when a view is created", () => {
  const input = setup()

  try {
    input.cache()
    expect(input.directoryReads()).toBe(1)
  } finally {
    input.dispose()
  }
})

test("evicts the least recently selected view and disposes all retained owners", () => {
  const input = setup()

  try {
    const first = input.cache()
    Array.from({ length: 15 }, (_, index) => `ses_${index}`).forEach((id) => {
      input.setState("id", id)
      input.cache()
    })
    input.setState("id", "ses_a")
    expect(input.cache()).toBe(first)
    input.setState("id", "ses_last")
    input.cache()
    expect(input.disposed).toEqual(["ses_0"])
    input.setState("id", "ses_0")
    input.cache()
    expect(input.disposed).toEqual(["ses_0", "ses_1"])
  } finally {
    input.dispose()
  }

  expect(input.disposed).toHaveLength(18)
})

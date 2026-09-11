import { beforeAll, describe, expect, mock, test } from "bun:test"
import { plugin } from "bun"
import { createRoot } from "solid-js"
import type { JSX } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"

// `packages/app/tsconfig.json` sets `"jsx": "preserve"`, so Bun's transpiler falls back to the
// classic `React.createElement` factory and `sub-agents.tsx` throws `ReferenceError: React is not
// defined` the moment its provider returns. Binding that factory to Solid's own `createComponent`
// inside the module's scope makes `SubAgentsContext.Provider` behave exactly as compiled JSX would,
// without writing to globalThis and without a Babel toolchain. `bun run test:unit` passes no extra
// `--preload`, so the loader has to register itself here.
plugin({
  name: "sub-agents-jsx-factory",
  setup(build) {
    build.onLoad({ filter: /[\\/]sub-agents\.tsx$/ }, async (args) => ({
      contents:
        `import { createComponent } from "solid-js"\n` +
        `const React = { createElement: (type, props, ...children) => createComponent(type, children.length === 0 ? props : { ...props, children: children.length === 1 ? children[0] : children }) }\n` +
        (await Bun.file(args.path).text()),
      loader: "tsx",
    }))
  },
})

const PARENT = "ses_parent"
const OTHER_PARENT = "ses_other_parent"

let SubAgentsProvider: typeof import("./sub-agents").SubAgentsProvider
let useSubAgents: typeof import("./sub-agents").useSubAgents

let liveSessions: Session[] = []
let backfillSessions: Session[] = []

const session = (id: string, parentID: string | undefined, title = id) =>
  ({
    id,
    parentID,
    title,
    cost: 0,
    time: { created: 1, updated: 1 },
  }) as Session

beforeAll(async () => {
  // Bun's module mocks are process-wide and outlive this file, so a stub that replaces a module
  // wholesale breaks whichever later test file imports its other exports. Every module that other
  // tests reach for therefore keeps its real exports and overrides only the one hook
  // `sub-agents.tsx` consumes. None of them pulls in `sub-agents.tsx`, so loading them first cannot
  // beat the stubs into place.
  const sync = await import("@/context/sync")
  const sdk = await import("@/context/sdk")
  const serverSDK = await import("@/context/server-sdk")
  const solidQuery = await import("@tanstack/solid-query")

  await mock.module("@/context/sync", () => ({
    ...sync,
    useSync: () => () => ({
      data: { session: liveSessions, session_status: {} },
      session: { get: (id: string) => liveSessions.find((s) => s.id === id) },
    }),
  }))
  // Only `directory` is read, as part of the backfill query key. The query function never runs
  // because `useQuery` is stubbed below.
  await mock.module("@/context/sdk", () => ({ ...sdk, useSDK: () => () => ({ directory: "/tmp" }) }))
  await mock.module("@/context/server-sdk", () => ({ ...serverSDK, useServerSDK: () => () => ({ scope: "test" }) }))
  // Replaced wholesale on purpose: importing the real module evaluates `@solidjs/router`, which
  // throws "Client-only API called on the server side" under the Solid build `bun run test:unit`
  // resolves. Nothing else in the suite imports it.
  await mock.module("@/pages/session/session-layout", () => ({ useSessionLayout: () => ({ params: { id: PARENT } }) }))
  // Same strategy as `global-sync/child-store.test.ts`: stubbing `useQuery` keeps the one-shot
  // backfill snapshot synchronous, so the union under test is the only moving part.
  await mock.module("@tanstack/solid-query", () => ({
    ...solidQuery,
    useQuery: () => ({
      get data() {
        return backfillSessions
      },
    }),
  }))

  const subAgents = await import("./sub-agents")
  SubAgentsProvider = subAgents.SubAgentsProvider
  useSubAgents = subAgents.useSubAgents
})

function withSubAgents<T>(
  input: { live: Session[]; backfill: Session[] },
  read: (agents: ReturnType<typeof useSubAgents>) => T,
) {
  liveSessions = input.live
  backfillSessions = input.backfill

  return createRoot((dispose) => {
    let captured: { value: T } | undefined
    // Solid resolves a function child lazily, under the owner the provider just pushed its context
    // onto - the non-JSX spelling of `<SubAgentsProvider><Consumer /></SubAgentsProvider>`.
    // `JSX.Element` does not model that function form, hence the cast.
    const consume = () => {
      captured = { value: read(useSubAgents()) }
      return null
    }

    SubAgentsProvider({ children: consume as unknown as JSX.Element })
    dispose()
    if (!captured) throw new Error("provider children were never resolved")
    return captured.value
  })
}

const childIDs = (input: { live: Session[]; backfill: Session[] }) =>
  withSubAgents(input, (agents) => agents.children().map((s) => s.id))

describe("SubAgentsProvider children", () => {
  test("returns the live store children when the backfill is empty", () => {
    expect(
      childIDs({
        live: [session("ses_child_b", PARENT), session("ses_child_a", PARENT)],
        backfill: [],
      }),
    ).toEqual(["ses_child_a", "ses_child_b"])
  })

  test("returns the backfill children when the live store holds none for this parent", () => {
    expect(
      childIDs({
        live: [session(PARENT, undefined)],
        backfill: [session("ses_child_b", PARENT), session("ses_child_a", PARENT)],
      }),
    ).toEqual(["ses_child_a", "ses_child_b"])
  })

  test("keeps one entry for an id held by both sources, and the live store copy wins", () => {
    const input = {
      live: [session("ses_child_b", PARENT, "live-title")],
      backfill: [session("ses_child_a", PARENT, "backfill-only"), session("ses_child_b", PARENT, "stale-title")],
    }

    expect(childIDs(input)).toEqual(["ses_child_a", "ses_child_b"])
    expect(withSubAgents(input, (agents) => agents.children().map((s) => s.title))).toEqual([
      "backfill-only",
      "live-title",
    ])
  })

  test("excludes a session that belongs to a different parent", () => {
    expect(
      childIDs({
        live: [session("ses_child_a", PARENT), session("ses_other_child", OTHER_PARENT)],
        backfill: [],
      }),
    ).toEqual(["ses_child_a"])
  })

  test("returns an empty list when neither source has children", () => {
    expect(childIDs({ live: [], backfill: [] })).toEqual([])
  })

  test("orders both sources lexicographically by id, and repeated reads agree", () => {
    const input = {
      live: [session("ses_2", PARENT), session("ses_10", PARENT)],
      backfill: [session("ses_20", PARENT), session("ses_1", PARENT)],
    }
    const expected = ["ses_1", "ses_10", "ses_2", "ses_20"]

    expect(
      withSubAgents(input, (agents) => [agents.children().map((s) => s.id), agents.children().map((s) => s.id)]),
    ).toEqual([expected, expected])
    expect(childIDs(input)).toEqual(expected)
  })
})

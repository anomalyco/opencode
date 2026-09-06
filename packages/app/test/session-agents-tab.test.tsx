// The test that proves the reported subagent bug is fixed: "o status na tag de subagents nao esta a
// atualizar". It renders the REAL `SessionAgentsTab` against a reactive Solid store and mutates only
// the narrow slice the server would touch, so a frozen (non-reactive) row snapshot fails it.
//
// Requires the Solid JSX loader and the browser export condition, so it lives outside `./src` and
// runs via `bun run test:solid` rather than `bun run test:unit`. See `test/solid-preload.ts`.
import { beforeAll, afterAll, expect, mock, test } from "bun:test"
import { createStore } from "solid-js/store"
import type { JSX } from "solid-js"
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"

const PARENT = "ses_parent"
const CHILD = "ses_child"

const [state, setState] = createStore({
  session: [
    {
      id: CHILD,
      parentID: PARENT,
      title: "child-title",
      cost: 0,
      tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    },
  ] as unknown as Session[],
  // Seeded `busy` on purpose: see the non-vacuity note at the bottom of this file.
  session_status: { [CHILD]: { type: "busy" } } as Record<string, SessionStatus>,
  // No task parts, so `deriveStatus` falls through to the live `session_status` map.
  message: {} as Record<string, Message[]>,
  part: {} as Record<string, Part[]>,
})

const host = document.createElement("div")
let dispose = () => {}

beforeAll(async () => {
  await mock.module("@solidjs/router", () => ({ useNavigate: () => () => {} }))
  await mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => null }))
  await mock.module("@opencode-ai/ui/scroll-view", () => ({
    ScrollView: (props: { children: JSX.Element }) => props.children,
  }))
  await mock.module("@opencode-ai/session-ui/v2/session-progress-indicator-v2", () => ({
    SessionProgressIndicatorV2: () => null,
  }))
  await mock.module("@/pages/session/session-layout", () => ({
    useSessionLayout: () => ({ params: { id: PARENT, serverKey: "srv" } }),
  }))
  // `t` echoes the key so assertions read as the i18n contract instead of English copy.
  await mock.module("@/context/language", () => ({
    useLanguage: () => ({ t: (key: string) => key, intl: () => "en-US" }),
  }))
  await mock.module("@/context/server-sdk", () => ({ useServerSDK: () => () => ({ scope: "test" }) }))
  await mock.module("@/context/sdk", () => ({
    useSDK: () => () => ({
      directory: "/tmp",
      client: { session: { list: async () => ({ data: [] }) } },
    }),
  }))
  // `useSync` returns an accessor, hence the double arrow. `data` is the store proxy itself, so
  // reads inside the component subscribe exactly as they do against the real global sync store.
  await mock.module("@/context/sync", () => ({
    useSync: () => () => ({
      data: state,
      session: { get: (id: string) => state.session.find((s) => s.id === id) },
    }),
  }))

  const { render } = await import("solid-js/web")
  const { QueryClient, QueryClientProvider } = await import("@tanstack/solid-query")
  const { SubAgentsProvider } = await import("@/context/sub-agents")
  const { SessionAgentsTab } = await import("@/components/session/session-agents-tab")

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  document.body.appendChild(host)
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <SubAgentsProvider>
          <SessionAgentsTab />
        </SubAgentsProvider>
      </QueryClientProvider>
    ),
    host,
  )

  const deadline = Date.now() + 5000
  while (host.querySelectorAll("button").length < 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
})

afterAll(() => {
  dispose()
  host.remove()
})

test("status label updates in place when only session_status mutates", () => {
  const row = host.querySelectorAll("button")[0]
  expect(row.textContent).toContain("session.agents.status.busy")

  setState("session_status", CHILD, { type: "idle" })

  expect(row.textContent).toContain("session.agents.status.idle")
  expect(row.textContent).not.toContain("session.agents.status.busy")
  // Identical element reference: the row was updated in place, not remounted.
  expect(host.querySelectorAll("button")[0]).toBe(row)
})

test("token total updates in place when only session.tokens mutates", () => {
  const row = host.querySelectorAll("button")[0]
  expect(row.textContent).toContain("100 session.agents.tokens")

  setState("session", 0, "tokens", "input", 2000)

  expect(row.textContent).toContain("2.0k session.agents.tokens")
  expect(row.textContent).not.toContain("100 session.agents.tokens")
  expect(host.querySelectorAll("button")[0]).toBe(row)
})

test("cost of exactly 0 still renders the $0.00 span instead of hiding it", () => {
  const row = host.querySelectorAll("button")[0]
  expect(row.textContent).toContain("$0.00")
})

// NON-VACUITY (why these tests cannot pass against the pre-fix component)
//
// The argument is structural, not a revert-and-rerun: the fixture is seeded so that a frozen
// first-render snapshot is red by construction.
//
// The pre-fix row callback held `const st = deriveStatus(session.id)` and `const totalT = ...` --
// plain values, evaluated once, because in Solid a `<For>` row callback body runs once per row.
// Both tests assert the seeded value FIRST (`busy`, `100 tokens`), which pins the snapshot to the
// pre-mutation state, and only then mutate. A frozen snapshot therefore still reads `busy` /
// `100 tokens` at the second assertion, and both tests fail. Only the `createMemo` accessors the
// fix introduced can satisfy both assertions in the same test.
//
// The element-identity assertions rule out the opposite escape hatch: passing by remounting the
// row. A remount would produce a different `<button>` element and fail `toBe(row)`, so the tests
// can only be satisfied by a genuine in-place reactive update.

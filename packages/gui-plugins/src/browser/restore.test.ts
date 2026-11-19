import { expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import { activityOwner, agentDriven } from "./policy"
import { createBrowserRestoreStore, restoredActivity } from "./restore"

test("keeps which tabs the agent drove across a restart, so they come back with every agent-driven limit", () => {
  const values = new Map<string, unknown>()

  // SAFETY: the restore store reads only `store` with its `value` and `set`, and `remove`.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const storage = {
    store: (key: string, options: { initial: unknown }) => ({
      get value() {
        return values.has(key) ? values.get(key) : options.initial
      },
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
      set: (next: unknown) => values.set(key, next),
    }),
    remove: (key: string) => values.delete(key),
  } as unknown as BuiltinMainStorage

  const agentTab = Browser.TabID.make("tab_11111111-1111-1111-1111-111111111111")
  const userTab = Browser.TabID.make("tab_22222222-2222-2222-2222-222222222222")
  const store = createBrowserRestoreStore(storage)

  store.save(
    "server\nses_a",
    { tabs: [{ id: agentTab, url: "https://accounts.example/pk" }, { id: userTab, url: "https://docs.example/" }], focusedTabID: userTab },
    (tabID) => (tabID === agentTab ? { agentRuns: 0, control: "agent" } : undefined),
  )

  const saved = createBrowserRestoreStore(storage).load("server\nses_a")

  expect(saved).toEqual({
    tabs: [
      { id: agentTab, url: "https://accounts.example/pk", control: "agent" },
      { id: userTab, url: "https://docs.example/" },
    ],
    focusedTabID: userTab,
  })

  // The pane seeds its tabs from the mark: the agent's tab is agent-driven for good and still the agent's, with no
  // command running.
  const activity = restoredActivity(saved)
  const restored = activity.get(agentTab)
  expect([...activity.keys()]).toEqual([agentTab])
  expect(restored && agentDriven(restored)).toBe(true)
  expect(restored).toEqual({ agentRuns: 0, control: "agent" })
  expect(restored && activityOwner(restored)).toBe("agent")
})

import { expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import { selectPromptTab } from "@/composer/persistence"
import type { Tab } from "@/shell/tabs/tabs"

test("selects the explicitly scoped session tab instead of the active tab", () => {
  const server = ServerConnection.Key.make("local")
  const tabs: Tab[] = [
    { type: "session", server, sessionId: "A" },
    { type: "session", server, sessionId: "B" },
  ]

  expect(selectPromptTab(tabs, { dir: "repo", id: "B" }, server)).toBe(tabs[1])
})

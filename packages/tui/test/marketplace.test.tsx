import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test("Marketplace confirms the reviewed plan before installing it", async () => {
  const installed = Promise.withResolvers<unknown>()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const source = { id: "team", name: "Team", url: "https://example.test/catalog.json", trust: "community" }
  const item = {
    id: "review",
    name: "Review kit",
    description: "Review changes",
    kind: "agent",
    version: "1.0.0",
    install: { agents: { review: { prompt: "review" } } },
  }
  const view = {
    state: { revision: 3, sources: [source] },
    listings: [
      {
        key: "team:catalog:review",
        source,
        item,
        catalog: { id: "catalog", name: "Catalog", schema: "opencode.marketplace/v1", items: [item] },
      },
    ],
    errors: [],
    cache: { root: "/cache", objects: 0, total_bytes: 0, fetch_entries: 0, materializations: 0 },
  }
  const calls: unknown[] = []
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, keybinds: { "marketplace.list": "f8" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/experimental/marketplace") return json({ location, data: view })
      if (url.pathname === "/api/experimental/marketplace/plan")
        return json({
          location,
          data: {
            ok: true,
            plan_id: "reviewed",
            revision: 3,
            expires_at: "2099-01-01",
            key: "team:catalog:review",
            action: "install",
            listing_digest: "listing",
            plan_digest: "plan",
            compatibility: { compatible: true, reasons: [] },
            trust_warning: true,
            conflicts: [],
            permissions: ["Adds an agent"],
            summary: "1 agent",
          },
        })
      if (url.pathname === "/api/experimental/marketplace/install") {
        const body = await request.json()
        calls.push(body)
        installed.resolve(body)
        return json({ location, data: { ok: true, changed: true, view, connect_mcp: [], preserved: [] } })
      }
    },
  })
  await setup.ready
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  setup.mockInput.pressKey("F8")
  await setup.waitForFrame(
    (frame) => frame.includes("Review kit") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Install Marketplace package?") && frame.includes("Adds an agent"))
  expect(calls).toEqual([])
  setup.mockInput.pressEnter()
  expect(await installed.promise).toEqual({
    plan_id: "reviewed",
    expected_revision: 3,
    accept_untrusted: true,
    force: false,
  })
  await setup.waitForFrame((frame) => frame.includes("Review kit") && !frame.includes("Install Marketplace package?"))
})

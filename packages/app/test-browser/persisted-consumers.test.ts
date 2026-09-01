import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { ModelSelectionSchema } from "@/providers/models/selection"
import { persisted } from "@/runtime/persistence/storage"

test("persisted model selection hydrates, updates and serializes the schema shape", () => {
  const key = `consumer-model-selection-${crypto.randomUUID()}`
  localStorage.setItem(
    key,
    JSON.stringify({ pick: { session1: { agent: "plan" }, __workspace__: { agent: "build" } } }),
  )
  createRoot((dispose) => {
    try {
      const [state, setState] = persisted(
        key,
        ModelSelectionSchema,
        { session: {} },
        {
          platform: "web",
          openExternal: () => {},
          restart: async () => {},
          notify: async () => {},
        },
      )
      expect(state.session.session1?.agent).toBe("plan")
      setState("session", "session1", { agent: "build", variant: null })
      expect(state.session.session1?.agent).toBe("build")
      expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual({
        session: { session1: { agent: "build", variant: null } },
      })
    } finally {
      dispose()
      localStorage.removeItem(key)
    }
  })
})

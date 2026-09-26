import { describe, expect, test } from "bun:test"
import { resolveMiniModelPreference } from "../../src/mini/model-preference"

const recent = { providerID: "connected", modelID: "recent" }
const configured = { providerID: "connected", modelID: "configured" }
const providers = [
  { id: "connected", name: "Connected", models: { recent: { name: "Recent" }, configured: { name: "Configured" } } },
]

describe("Mini model preference", () => {
  test("restores the recent model from the available catalog", () => {
    expect(resolveMiniModelPreference({ configured: [], recent: [recent], providers })).toEqual({
      model: recent,
      variant: undefined,
      warning: undefined,
    })
  })
  test("prefers the configured model over recent models", () => {
    const result = resolveMiniModelPreference({
      configured: [{ type: "document", info: { model: "connected/configured#high" } }],
      recent: [recent],
      providers,
    })
    expect(result.model).toEqual(configured)
    expect(result.variant).toBe("high")
    expect(result.warning).toBeUndefined()
  })
  test("accepts the explicit configured model form", () => {
    expect(
      resolveMiniModelPreference({
        configured: [{ type: "document", info: { model: { providerID: "connected", model: "configured" } } }],
        recent: [recent],
        providers,
      }).model,
    ).toEqual(configured)
  })
  test("skips an unavailable recent model and explains the fallback", () => {
    const result = resolveMiniModelPreference({
      configured: [],
      recent: [{ ...recent, modelID: "removed" }, recent],
      providers,
    })
    expect(result.model).toEqual(recent)
    expect(result.warning).toContain("Recent model connected/removed")
    expect(result.warning).toContain("Falling back to connected/recent")
  })
  test("reports an unavailable configured model before falling back to recent models", () => {
    const result = resolveMiniModelPreference({
      configured: [{ type: "document", info: { model: "disconnected/model" } }],
      recent: [recent],
      providers,
    })
    expect(result.model).toEqual(recent)
    expect(result.warning).toContain("Configured model disconnected/model")
    expect(result.warning).toContain("Falling back to connected/recent")
  })
  test("does not select a model from a disconnected provider", () => {
    const result = resolveMiniModelPreference({
      configured: [],
      recent: [{ providerID: "disconnected", modelID: "recent" }],
      providers,
    })
    expect(result.model).toBeUndefined()
    expect(result.warning).toContain("server default")
  })
  test("ignores a malformed configured model reference", () => {
    expect(
      resolveMiniModelPreference({
        configured: [{ type: "document", info: { model: "not-a-reference" } }],
        recent: [recent],
        providers,
      }),
    ).toEqual({ model: recent, variant: undefined, warning: undefined })
  })
})

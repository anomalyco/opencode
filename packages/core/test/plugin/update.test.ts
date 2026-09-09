import { describe, expect, test } from "bun:test"
import { PluginUpdate } from "../../src/plugin/update"

describe("isAutoUpdateEligible", () => {
  test("accepts bare package specs", () => {
    expect(PluginUpdate.isAutoUpdateEligible("acme-plugin")).toBe(true)
  })

  test("accepts dist-tag specs", () => {
    expect(PluginUpdate.isAutoUpdateEligible("acme-plugin@latest")).toBe(true)
  })

  test("accepts range specs", () => {
    expect(PluginUpdate.isAutoUpdateEligible("acme-plugin@^1.0.0")).toBe(true)
  })

  test("accepts scoped bare specs", () => {
    expect(PluginUpdate.isAutoUpdateEligible("@scope/plugin")).toBe(true)
  })

  test("rejects exact pinned versions", () => {
    expect(PluginUpdate.isAutoUpdateEligible("acme-plugin@1.2.3")).toBe(false)
  })

  test("rejects pinned scoped versions", () => {
    expect(PluginUpdate.isAutoUpdateEligible("@scope/plugin@2.0.0")).toBe(false)
  })

  test("rejects file url specs", () => {
    expect(PluginUpdate.isAutoUpdateEligible("file:///abs/path/plugin.ts")).toBe(false)
  })

  test("rejects relative path specs", () => {
    expect(PluginUpdate.isAutoUpdateEligible("./local.ts")).toBe(false)
    expect(PluginUpdate.isAutoUpdateEligible("../local.ts")).toBe(false)
  })
})

import { describe, expect, test } from "bun:test"
import { displayPluginName } from "../../src/component/dialog-status"

describe("displayPluginName", () => {
  test("uses the directory basename for a path-registered plugin", () => {
    // On Windows fileURLToPath returns backslash paths, which split("/") never splits.
    expect(displayPluginName("file:///C:/Users/user/.config/opencode/plugins/opencode-mem")).toEqual({
      name: "opencode-mem",
    })
  })

  test("handles a dotted plugin directory", () => {
    expect(displayPluginName("file:///C:/Users/user/.config/opencode/plugins/opencode-provider-proxy")).toEqual({
      name: "opencode-provider-proxy",
    })
  })

  test("strips the file extension from a file-based plugin", () => {
    expect(displayPluginName("file:///C:/Users/user/.config/opencode/plugins/local-plugin.ts")).toEqual({
      name: "local-plugin",
    })
  })

  test("uses the parent directory for an index entrypoint", () => {
    expect(displayPluginName("file:///C:/Users/user/.config/opencode/plugins/my-plugin/index.ts")).toEqual({
      name: "my-plugin",
    })
  })

  test("parses a bare npm spec as latest", () => {
    expect(displayPluginName("opencode-ai")).toEqual({ name: "opencode-ai", version: "latest" })
  })

  test("parses a versioned npm spec", () => {
    expect(displayPluginName("@opencode-ai/plugin@1.0.0")).toEqual({
      name: "@opencode-ai/plugin",
      version: "1.0.0",
    })
  })
})

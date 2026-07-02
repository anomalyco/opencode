import { describe, expect, test } from "bun:test"
import { formatPluginName } from "./status-popover-plugin"

describe("formatPluginName", () => {
  test("keeps registry plugin specs unchanged", () => {
    expect(formatPluginName("opencode-gemini-auth")).toBe("opencode-gemini-auth")
    expect(formatPluginName("opencode-foo@1.2.3")).toBe("opencode-foo@1.2.3")
  })

  test("uses the package name for local package specs", () => {
    expect(formatPluginName("opencode-usage-audit@file:/Users/alice/plugins/usage-audit")).toBe("opencode-usage-audit")
    expect(formatPluginName("@scope/usage-audit@file:../plugins/usage-audit")).toBe("@scope/usage-audit")
  })

  test("uses the file name for local plugin paths", () => {
    expect(formatPluginName("./plugin/usage-audit.ts")).toBe("usage-audit")
    expect(formatPluginName("file:///Users/alice/plugin/usage-audit.js")).toBe("usage-audit")
    expect(formatPluginName("C:\\Users\\alice\\plugin\\usage-audit.ts")).toBe("usage-audit")
  })

  test("uses the parent directory for local index plugin paths", () => {
    expect(formatPluginName("./plugin/usage-audit/index.ts")).toBe("usage-audit")
    expect(formatPluginName("file:///Users/alice/plugin/usage-audit/index.js")).toBe("usage-audit")
  })
})

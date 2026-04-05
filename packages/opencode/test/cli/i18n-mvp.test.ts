import { describe, expect, test } from "bun:test"
import { countText, mcpStatusText } from "../../src/cli/cmd/tui/component/dialog-status"
import { exportHint, exportProgress } from "../../src/cli/cmd/export"
import { serveListening, serveWarning } from "../../src/cli/cmd/serve"
import { sessionHeader } from "../../src/cli/cmd/session"

describe("i18n MVP surfaces", () => {
  test("formats serve strings", () => {
    expect(serveWarning("en")).toContain("OPENCODE_SERVER_PASSWORD")
    expect(serveListening("zh", "127.0.0.1", 4096)).toContain("4096")
  })

  test("formats export strings", () => {
    expect(exportProgress("en", "latest")).toBe("Exporting session: latest")
    expect(exportProgress("zh", "ses_1")).toContain("ses_1")
    expect(exportHint("en", Date.UTC(2026, 0, 2, 3, 4, 5), "ses_12345678")).toContain("12345678")
  })

  test("formats dialog status counts", () => {
    expect(countText("en", "plugin", 1)).toBe("1 Plugin")
    expect(countText("en", "plugin", 2)).toBe("2 Plugins")
    expect(countText("zh", "mcp", 3)).toBe("3 个 MCP 服务器")
  })

  test("formats session table header", () => {
    expect(sessionHeader("en", 20, 25)).toContain("Session ID")
    expect(sessionHeader("zh", 20, 25)).toContain("会话 ID")
    expect(sessionHeader("zh", 20, 25)).toContain("更新时间")
  })

  test("formats mcp status messages", () => {
    expect(mcpStatusText("en", "demo", { status: "connected" })).toBe("Connected")
    expect(mcpStatusText("zh", "demo", { status: "disabled" })).toBe("已在配置中禁用")
    expect(mcpStatusText("en", "demo", { status: "needs_auth" })).toContain("opencode mcp auth demo")
    expect(mcpStatusText("en", "demo", { status: "failed", error: "boom" })).toBe("boom")
  })
})

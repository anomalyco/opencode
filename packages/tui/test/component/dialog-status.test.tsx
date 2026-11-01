import { expect, test } from "bun:test"
import { DialogStatus } from "../../src/component/dialog-status"
import { DialogSelect } from "../../src/ui/dialog-select"
import { renderLocal } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

test.each([false, true])("status uses the picker inset with MCP servers: %s", async (connected) => {
  await using setup = await renderLocal({
    fetch: (url) => {
      if (url.pathname === "/api/mcp")
        return json({
          location: { directory },
          data: connected ? [{ name: "docs", status: { status: "connected" } }] : [],
        })
    },
  })
  await setup.data.location.mcp.server.sync()

  for (const width of [44, 120]) {
    setup.resize(width, 30)
    setup.dialog.replace(() => (
      <DialogSelect title="Select model" options={[{ title: "Example model", value: "example" }]} />
    ))
    await setup.renderOnce()
    const picker = setup
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("Select model"))!
    expect(picker).toContain("esc")

    setup.dialog.replace(() => <DialogStatus />)
    await setup.renderOnce()
    const lines = setup.captureCharFrame().split("\n")
    const header = lines.find((line) => line.includes("Status"))!
    const body = lines.find((line) => line.includes(connected ? "1 MCP server" : "No MCP servers"))!
    expect(header).toContain("esc")
    expect(body).toBeDefined()
    expect(header.indexOf("Status")).toBe(picker.indexOf("Select model"))
    expect(header.indexOf("esc")).toBe(picker.indexOf("esc"))
    expect(body.indexOf(connected ? "1 MCP server" : "No MCP servers")).toBe(picker.indexOf("Select model"))
    if (connected) expect(lines.some((line) => line.includes("docs Connected"))).toBe(true)
  }
})

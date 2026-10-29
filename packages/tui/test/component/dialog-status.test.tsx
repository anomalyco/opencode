import { expect, test } from "bun:test"
import { DialogStatus } from "../../src/component/dialog-status"
import { DialogSelect } from "../../src/ui/dialog-select"
import { renderLocal } from "../fixture/local"

test("status aligns its title, body and escape hint with pickers", async () => {
  await using setup = await renderLocal()
  setup.dialog.replace(() => <DialogSelect title="Models" options={[]} />)
  await setup.renderOnce()
  const picker = setup
    .captureCharFrame()
    .split("\n")
    .find((line) => line.includes("Models"))!
  expect(picker).toContain("esc")

  setup.dialog.replace(() => <DialogStatus />)
  await setup.renderOnce()
  const lines = setup.captureCharFrame().split("\n")
  const header = lines.find((line) => line.includes("Status"))!
  const body = lines.find((line) => line.includes("No MCP servers"))
  expect(header).toContain("esc")
  expect(header.indexOf("Status")).toBe(picker.indexOf("Models"))
  expect(header.indexOf("esc")).toBe(picker.indexOf("esc"))
  expect(body?.indexOf("No MCP servers")).toBe(picker.indexOf("Models"))
})

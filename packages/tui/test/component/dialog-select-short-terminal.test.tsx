import { expect, test } from "bun:test"
import { DialogSelect } from "../../src/ui/dialog-select"
import { renderLocal } from "../fixture/local"

test("custom scaled picker keeps at least one selectable row on short terminals", async () => {
  await using setup = await renderLocal()
  setup.renderer.resize(80, 12)
  setup.dialog.replace(() => <DialogSelect
    title="Scaled picker"
    heightScale={1.7}
    renderFilter={false}
    skipFilter
    options={[{ title: "INDEPENDENT_VISIBLE_ROW", value: "one" }]}
  />)
  await setup.renderOnce()
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Scaled picker")
  expect(frame).toContain("INDEPENDENT_VISIBLE_ROW")
})

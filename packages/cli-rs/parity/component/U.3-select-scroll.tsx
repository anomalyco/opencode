/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for DialogSelect's scrolling (packages/tui/src/ui/dialog-select.tsx `scrollToSelection`):
// crates/ui/tests/all/dialogs.rs. A list of 30 options in three categories, one with a detail row, at 72x30 (a list
// of 9 rows). Keys sent with no frame between them reach OpenTUI's scroll box in one layout, which sums the
// relative scrolls before it clamps them; "-frames" fixtures draw a frame after every key instead.
import { DialogSelect } from "../../../tui/src/ui/dialog-select"
import { renderComponent } from "../lib/component"

const options = ["Alpha", "Beta", "Gamma"].flatMap((category, c) =>
  Array.from({ length: 10 }, (_, i) => ({
    title: `${category} ${i + 1}`,
    value: c * 10 + i,
    category,
    details: c === 1 && i === 3 ? ["/a/detail/row"] : undefined,
  })),
)

const dialog = () => <DialogSelect title="Long list" options={options} />
const ready = (frame: string) => frame.includes("Long list")
const base = { width: 72, height: 30, dialog, ready }

type Setup = Parameters<NonNullable<Parameters<typeof renderComponent>[0]["act"]>>[0]
async function press(setup: Setup, key: "up" | "down", count: number, frames: boolean) {
  for (let i = 0; i < count; i++) {
    setup.mockInput.pressArrow(key)
    if (frames) await setup.renderOnce()
  }
}

for (const count of [5, 10, 20]) {
  await renderComponent({
    ...base,
    fixture: `U.3/select-scroll-${count}`,
    act: (setup) => press(setup, "down", count, false),
  })
  await renderComponent({
    ...base,
    fixture: `U.3/select-scroll-${count}-frames`,
    act: (setup) => press(setup, "down", count, true),
  })
}
await renderComponent({
  ...base,
  fixture: "U.3/select-scroll-up",
  act: async (setup) => {
    await press(setup, "down", 20, false)
    await setup.renderOnce()
    await press(setup, "up", 8, false)
  },
})
await renderComponent({
  ...base,
  fixture: "U.3/select-scroll-up-frames",
  act: async (setup) => {
    await press(setup, "down", 20, true)
    await press(setup, "up", 8, true)
  },
})

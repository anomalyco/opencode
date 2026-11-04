/** @jsxImportSource @opentui/solid */
// P-COMP fixture of plain OpenTUI elements with explicit colors, the cross-language check of the harness:
// crates/parity/tests/component.rs draws the same box with opentui-rust and expects equal cells.
import { renderComponent } from "../lib/component"

await renderComponent({
  fixture: "H.1/box",
  width: 24,
  height: 5,
  bare: () => (
    <box
      width={20}
      height={4}
      border
      borderStyle="rounded"
      borderColor="#5c9cf5"
      backgroundColor="#1e1e2e"
      title=" Hi "
      paddingLeft={1}
    >
      <text fg="#eeeeee">
        <b>Hello</b> 界
      </text>
    </box>
  ),
  ready: (frame) => frame.includes("Hello"),
})

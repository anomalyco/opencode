/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for DialogSelect (packages/tui/src/ui/dialog-select.tsx): crates/ui/tests/dialogs.rs. One list
// with two categories, a current option, descriptions, footers, details, and an action: as opened (scrolled to
// the current option), after moving down twice, after typing a filter, and with a filter that matches nothing.
import { DialogSelect } from "../../../tui/src/ui/dialog-select"
import { renderComponent } from "../lib/component"

const options = [
  { title: "Claude Sonnet", value: "sonnet", category: "Anthropic", footer: "Free" },
  { title: "Claude Opus", value: "opus", category: "Anthropic", description: "best" },
  { title: "Claude Haiku", value: "haiku", category: "Anthropic" },
  { title: "Disabled", value: "off", category: "Anthropic", disabled: true },
  { title: "GPT-5", value: "gpt5", category: "OpenAI", details: ["/a/very/long/path/that/gets/cut/in/the/middle/model.json"] },
  { title: "GPT-5 mini", value: "gpt5-mini", category: "OpenAI", footer: "$0.25" },
  { title: "o4", value: "o4", category: "OpenAI" },
  { title: "Codex", value: "codex", category: "OpenAI", searchText: "code" },
]

const dialog = () => (
  <DialogSelect
    title="Select model"
    options={options}
    current="haiku"
    actions={[{ command: "model.dialog.favorite", title: "favorite", onTrigger: () => {} }]}
  />
)
const ready = (frame: string) => frame.includes("Select model")
const base = { width: 72, height: 30, dialog, ready }

await renderComponent({ ...base, fixture: "U.3/select" })
await renderComponent({
  ...base,
  fixture: "U.3/select-down",
  act: async (setup) => {
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down")
  },
})
await renderComponent({ ...base, fixture: "U.3/select-filter", act: (setup) => setup.mockInput.typeText("gpt") })
await renderComponent({ ...base, fixture: "U.3/select-empty", act: (setup) => setup.mockInput.typeText("zzz") })

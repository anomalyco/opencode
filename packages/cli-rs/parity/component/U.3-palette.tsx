/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the command palette (packages/tui/src/component/command-palette.tsx) and the help dialog
// (packages/tui/src/ui/dialog-help.tsx): crates/ui/tests/dialogs.rs registers the same global layer of palette
// commands. "U.3/palette" is the palette as opened, with one suggested command; "U.3/help" is the help dialog.
import { onMount, type JSX } from "solid-js"
import { CommandPaletteDialog } from "../../../tui/src/component/command-palette"
import { COMMAND_PALETTE_COMMAND, Keymap } from "../../../tui/src/context/keymap"
import { useDialog } from "../../../tui/src/ui/dialog"
import { DialogHelp } from "../../../tui/src/ui/dialog-help"
import { renderComponent } from "../lib/component"

function Commands(props: { open: () => JSX.Element }) {
  const dialog = useDialog()
  Keymap.createLayer(() => ({
    mode: "global",
    commands: [
      { id: COMMAND_PALETTE_COMMAND, title: "Show command palette", group: "System", run: () => {} },
      { id: "session.new", title: "New session", group: "Session", palette: true, suggested: true, run: () => {} },
      { id: "session.list", title: "Switch session", group: "Session", palette: true, run: () => {} },
      {
        id: "session.rename",
        title: "Rename session",
        description: "Give the session a name",
        group: "Session",
        palette: true,
        run: () => {},
      },
      { id: "theme.switch", title: "Switch theme", group: "System", palette: true, run: () => {} },
      { id: "app.exit", title: "Exit the app", group: "System", palette: true, run: () => {} },
    ],
  }))
  onMount(() => dialog.replace(props.open))
  return null
}

await renderComponent({
  fixture: "U.3/palette",
  width: 80,
  height: 36,
  element: () => <Commands open={() => <CommandPaletteDialog />} />,
  ready: (frame) => frame.includes("Exit the app"),
})

// At 80x20 the list has 4 rows, so it scrolls; "-end" is after moving to the last command.
for (const [fixture, moves] of [
  ["U.3/palette-20", 0],
  ["U.3/palette-20-end", 5],
] as const) {
  await renderComponent({
    fixture,
    width: 80,
    height: 20,
    element: () => <Commands open={() => <CommandPaletteDialog />} />,
    ready: (frame) => frame.includes("Search commands"),
    act: (setup) => {
      for (let i = 0; i < moves; i++) setup.mockInput.pressArrow("down")
    },
  })
}

await renderComponent({
  fixture: "U.3/help",
  width: 80,
  height: 14,
  element: () => <Commands open={() => <DialogHelp />} />,
  ready: (frame) => frame.includes("Press"),
})

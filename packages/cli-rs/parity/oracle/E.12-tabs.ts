// P-FILE for the `tabs` and `layout` storage keys (E.12): crates/tui/tests/all/tabs.rs runs this against the state
// directory the Rust TUI writes, through the TS storage (`context/storage.tsx`, the same lock and atomic write) and
// the TS tab model.
//
//   load <state> <channel>                          prints {tabs, layout} as the TS TUI reads them
//   move <state> <channel> <cwd> <session> <index>  moves a tab in the cwd scope, as a drag in the strip does
//   width <state> <channel> <width>                 stores verticalTabsWidth, as the rail's resize handle does
import { createStorage } from "../../../tui/src/context/storage"
import { moveSessionTab, type SessionTab } from "../../../tui/src/context/session-tabs-model"

type Scope = { tabs: SessionTab[]; unread: Record<string, unknown> }
type Tabs = { global: Scope; cwd: Record<string, Scope> }

const [command, state, channel, ...rest] = process.argv.slice(2)
// `bun run parity/fixtures.ts` runs every oracle without arguments; this one writes no fixture.
if (command && state && channel) {
  const { storage, close } = createStorage(state, channel)
  const [tabs, updateTabs] = storage.store<Tabs>("tabs", { initial: { global: { tabs: [], unread: {} }, cwd: {} } })
  const [layout, updateLayout] = storage.store<{ verticalTabsWidth?: number; paneWidth?: number }>("layout", {
    initial: {},
  })
  if (command === "move") {
    const [cwd, session, index] = rest
    await updateTabs((draft) => {
      const scope = (draft.cwd[cwd!] ??= { tabs: [], unread: {} })
      scope.tabs = moveSessionTab(scope.tabs, session!, Number(index))
    })
  }
  if (command === "width") await updateLayout((draft) => void (draft.verticalTabsWidth = Number(rest[0])))
  console.log(JSON.stringify({ tabs: JSON.parse(JSON.stringify(tabs)), layout: JSON.parse(JSON.stringify(layout)) }))
  close()
}

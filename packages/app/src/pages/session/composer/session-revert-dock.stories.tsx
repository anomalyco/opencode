import { For } from "solid-js"
import { createStore } from "solid-js/store"
import { SessionRevertDock } from "@/pages/session/composer/session-revert-dock"
import { SettingsProvider, useSettings } from "@/context/settings"

export default {
  title: "Composer/Revert Dock",
  id: "composer-revert-dock",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `### Overview
Real \`SessionRevertDock\` from app code, rendered above a mock composer card.

### Source path
- \`packages/app/src/pages/session/composer/session-revert-dock.tsx\`

### Why the mock composer
The live composer overlaps the dock's bottom by 18px (\`session-composer-region-controller.ts\` \`lift()\`).
The card below reproduces that overlap so the collapsed/expanded cutoff behavior can be verified in isolation.

### Layout split
Use the **Layout** button to toggle \`newLayoutDesigns\` and preview both the v2 dock and the legacy (v1) \`DockTray\` fallback.

### Notes
- \`onRestore\` only mutates local story state, so nothing in the real session is affected.
- Click the header to expand/collapse. Click "Restore message" to remove a row.`,
      },
    },
  },
}

const messages = [
  "update current branch with latest changes from dev and fix conflicts if any",
  "investigate why the chat input loses focus after sending a message",
  "Debug why streaming responses sometimes duplicate the last token",
  "suggest a better title for this PR based on the diff",
  "add a storybook story for the revert dock",
  "reduce re-renders in the timeline component",
]

const btn = (accent?: boolean) =>
  ({
    padding: "6px 12px",
    "border-radius": "6px",
    border: "1px solid var(--v2-border-border-base, #0000001a)",
    background: accent ? "var(--v2-background-bg-contrast, #242424)" : "var(--v2-background-bg-base, #fff)",
    color: accent ? "var(--v2-text-text-contrast, #fafafa)" : "var(--v2-text-text-base, #161616)",
    cursor: "pointer",
    "font-size": "13px",
  }) as const

function Stage(props: { count: number }) {
  const settings = useSettings()
  const seed = () => messages.slice(0, props.count).map((text, index) => ({ id: `rolled-${index}`, text }))
  const [store, setStore] = createStore({ items: seed() })

  const v2 = () => settings.general.newLayoutDesigns()
  const reset = () => setStore("items", seed())
  const restore = (id: string) =>
    setStore(
      "items",
      store.items.filter((item) => item.id !== id),
    )

  return (
    <div style={{ display: "grid", gap: "16px", "max-width": "720px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        <button style={btn()} onClick={reset}>
          Reset ({props.count})
        </button>
        <button style={btn(v2())} onClick={() => settings.general.setNewLayoutDesigns(!v2())}>
          Layout: {v2() ? "v2" : "v1"}
        </button>
      </div>

      {/* Reproduce the real composer stack: dock + card overlapping the dock's bottom by lift() = 18px */}
      <div style={{ display: "flex", "flex-direction": "column" }}>
        <SessionRevertDock items={store.items} onRestore={restore} />
        <div
          style={{ position: "relative", "z-index": 70, "margin-top": "-18px" }}
          class="min-h-24 w-full rounded-[12px] border border-v2-border-border-base bg-v2-background-bg-base px-4 py-3 text-[13px] text-v2-text-text-faint"
        >
          Ask anything...
        </div>
      </div>

      <div class="text-[12px] text-v2-text-text-faint">
        Restored so far:{" "}
        <For each={seed()}>
          {(item) => <span>{store.items.some((current) => current.id === item.id) ? "" : `“${item.text}” `}</span>}
        </For>
      </div>
    </div>
  )
}

const story = (count: number) => () => (
  <SettingsProvider>
    <Stage count={count} />
  </SettingsProvider>
)

export const OneMessage = {
  name: "1 rolled back",
  render: story(1),
}

export const ThreeMessages = {
  name: "3 rolled back",
  render: story(3),
}

export const ManyMessages = {
  name: "6 rolled back (scrolls)",
  render: story(6),
}

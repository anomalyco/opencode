import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { TuiKeybind } from "./src/config/keybind"

const keybinds = TuiKeybind.parse({})
const lookup = createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
  commandMap: TuiKeybind.CommandMap,
  bindingDefaults: TuiKeybind.bindingDefaults(),
})

// Mock renderer
const mockRenderer = {
  currentFocusedEditor: null,
  getSelection: () => null,
  clearSelection: () => {},
  paletteDetectionStatus: "idle",
  console: {
    onCopySelection: null,
  },
  keyInput: {
    prependListener: () => {},
    removeListener: () => {},
  },
} as any

const keymap = createDefaultOpenTuiKeymap(mockRenderer)

// Emulate sessionCommandList
const followup = "haltingSteer" // mock kv
const sessionCommands = [
  {
    namespace: "palette",
    name: "session.toggle-queue-mode",
    title: `Toggle follow-up mode (${followup})`,
    value: "session.toggle-queue-mode",
    category: "Session",
    run: () => {},
  },
  {
    namespace: "palette",
    name: "session.rename",
    title: "Rename session",
    value: "session.rename",
    category: "Session",
    run: () => {},
  }
]

// Register commands and bindings
const offLayer = keymap.registerLayer({
  commands: sessionCommands,
  bindings: lookup.gather("session", ["session.toggle-queue-mode", "session.rename"]),
})

const query = {
  namespace: "palette",
}

const reachable = keymap.getCommandEntries({
  ...query,
  visibility: "reachable",
})

console.log("Reachable commands in palette namespace:")
for (const entry of reachable) {
  console.log(`- name: ${entry.command.name}, title: ${entry.command.title}, hidden: ${entry.command.hidden}`)
}

offLayer()


// Relative command import is deliberate: Storybook aliases @/shell/commands/command to a no-op.
import { DialogProvider } from "@opencode/ui/context/dialog"
import { render } from "solid-js/web"
import { PlatformProvider } from "../src/runtime/platform/platform"
import { LanguageProvider } from "../src/runtime/i18n/language"
import { SettingsProvider, useSettings } from "../src/settings/model"
import { CommandProvider, useCommand } from "../src/shell/commands/command"

export async function mountCommands() {
  const element = document.createElement("div")
  document.body.append(element)
  const selected: string[] = []
  let settings: ReturnType<typeof useSettings> | undefined

  function Probe() {
    const commands = useCommand()
    settings = useSettings()
    settings.keybinds.set("command.palette", "ctrl+k")
    commands.register("layout-fixture", () => [
      { id: "find", title: "Find", keybind: "ctrl+f", onSelect: () => void selected.push("find") },
      { id: "custom", title: "Custom", keybind: "none", onSelect: () => void selected.push("custom") },
      { id: "command.palette", title: "Palette", onSelect: () => void selected.push("palette") },
    ])

    return null
  }

  const dispose = render(
    () => (
      <PlatformProvider value={{ platform: "web", openExternal() {}, restart: async () => {}, notify: async () => {} }}>
        <LanguageProvider locale="en">
          <SettingsProvider>
            <DialogProvider>
              <CommandProvider>
                <Probe />
              </CommandProvider>
            </DialogProvider>
          </SettingsProvider>
        </LanguageProvider>
      </PlatformProvider>
    ),
    element,
  )

  await Promise.resolve()

  return {
    selected,
    set(action: string, bind: string) {
      settings!.keybinds.set(action, bind)
    },
    send(input: KeyboardEventInit) {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...input })
      element.dispatchEvent(event)

      return event.defaultPrevented
    },
    dispose() {
      dispose()
      element.remove()
    },
  }
}

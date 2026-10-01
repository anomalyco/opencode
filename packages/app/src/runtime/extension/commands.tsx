import { Command } from "@opencode/gui-extensions/sdk"
import { useCommand } from "@/shell/commands/command"
import { useSettings } from "@/settings/model"
import { migrateKeybinds } from "@/settings/keybinds/migration"
import { useExtensionHost } from "./host"

/** Publishes extension commands as `${extension}.${id}` in the host command registry. */
export function ExtensionCommands() {
  const host = useExtensionHost()
  const command = useCommand()
  migrateKeybinds(useSettings())
  command.register("extensions", () =>
    host.items(Command).map((item) => ({
      id: `${item.extension}.${item.value.id}`,
      title: item.value.title,
      description: item.value.description,
      category: item.value.group,
      section: item.value.section,
      keybind: item.value.bind,
      slash: item.value.slash?.name,
      slashArguments: item.value.slash?.arguments,
      suggested: item.value.suggested,
      featured: item.value.featured,
      disabled: item.value.enabled === false,
      hidden: item.value.hidden,
      editable: item.value.editable,
      when: item.value.scope
        ? (event: KeyboardEvent) =>
            event.target instanceof Element && !!event.target.closest(item.value.scope as string)
        : undefined,
      onSelect: (_source: unknown, input?: string) => item.value.run(input),
    })),
  )
  return null
}

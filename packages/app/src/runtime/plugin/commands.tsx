import { createMemo } from "solid-js"
import { BuiltinCommand } from "@opencode/plugin/gui/builtin"
import { useCommand, type CommandSource } from "@/shell/commands/command"
import { useSettings } from "@/settings/model"
import { migrateKeybinds } from "@/settings/keybinds/migration"
import { usePluginHost, type Item } from "./host"

/** Publishes plugin commands as `${plugin}.${id}` in the host command registry. */
export function PluginCommands() {
  const host = usePluginHost()
  const command = useCommand()
  migrateKeybinds(useSettings())
  // Plugins activate in whatever order their entries load; list them in definition order, then registration order.
  const rank = createMemo(() => new Map(host.definitions().map((definition, index) => [definition.id, index])))
  const order = (plugin: string) => rank().get(plugin) ?? rank().size
  command.register("plugins", () =>
    pluginCommandItems(host.items(BuiltinCommand))
      .toSorted((a, b) => order(a.plugin) - order(b.plugin))
      .map((item) => ({
        id: `${item.plugin}.${item.value.id}`,
        plugin: item.plugin,
        title: item.value.title,
        description: item.value.description,
        keywords: item.value.keywords,
        category: item.value.group,
        section: item.value.section,
        keybind: item.value.bind,
        follows: item.value.follows,
        slash: item.value.slash?.name,
        slashArguments: item.value.slash?.arguments,
        slashAfter: item.value.slash?.after,
        suggested: item.value.suggested,
        featured: item.value.featured,
        disabled: item.value.enabled === false,
        hidden: item.value.hidden,
        editable: item.value.editable,
        when: item.value.scope ? scopedTo(item.value.scope) : undefined,
        onSelect: (_source?: CommandSource, input?: string) => item.value.run(input),
      })),
  )

  return null
}

/**
 * One item per published command id. A plugin may contribute the same command from several mounted owners, such as one
 * per cached timeline; the newest wins, as the newest keyed registration does in the command registry.
 */
export function pluginCommandItems(items: readonly Item<BuiltinCommand>[]) {
  return [...new Map(items.map((item) => [`${item.plugin}.${item.value.id}`, item])).values()]
}

// A command scoped to a selector runs only while the event's target is inside it.
const scopedTo = (scope: string) => (event: KeyboardEvent) =>
  event.target instanceof Element && !!event.target.closest(scope)

/** Whether an enabled plugin command scoped around the key's target is bound to that key, so it answers instead. */
export function usePluginClaims() {
  const host = usePluginHost()
  const command = useCommand()

  return (event: KeyboardEvent) => pluginClaims(host.items(BuiltinCommand), command.matches, event)
}

export function pluginClaims(
  commands: readonly Item<BuiltinCommand>[],
  matches: (id: string, event: KeyboardEvent) => boolean,
  event: KeyboardEvent,
) {
  return commands.some(
    (item) =>
      !!item.value.scope &&
      item.value.enabled !== false &&
      scopedTo(item.value.scope)(event) &&
      matches(`${item.plugin}.${item.value.id}`, event),
  )
}

/** Focus inside a plugin command's scope belongs to that plugin, which binds its own shortcuts there. */
export function usePluginScoped() {
  const host = usePluginHost()

  return (target: EventTarget | null) =>
    target instanceof Element &&
    host.items(BuiltinCommand).some((item) => !!item.value.scope && !!target.closest(item.value.scope))
}

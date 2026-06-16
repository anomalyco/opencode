import type { AffineSlashMenuWidget } from "@blocksuite/blocks"

// Action items to remove from the BlockSuite `/` slash menu.
const HIDE_ITEMS = new Set(["New Doc", "Linked Doc"])
// Group dividers whose whole group is removed — otherwise an empty group header
// would render, since BlockSuite does not strip empty groups.
const HIDE_GROUPS = new Set(["Page"])

let patched = false

// Removes selected entries from the slash menu by mutating the widget's shared
// default config. Each `AffineSlashMenuWidget` instance initializes its `config`
// from `DEFAULT_CONFIG` at construction, so patching it once before any editor
// mounts applies to every instance without a per-instance, timing-sensitive lookup.
export function patchSlashMenu(widget: typeof AffineSlashMenuWidget) {
  if (patched) return
  patched = true
  const base = widget.DEFAULT_CONFIG
  widget.DEFAULT_CONFIG = {
    ...base,
    items: base.items.filter((item) => {
      if (typeof item === "function") return true // generator items
      if ("groupName" in item) return !HIDE_GROUPS.has(item.groupName)
      if ("name" in item) return !HIDE_ITEMS.has(item.name)
      return true
    }),
  }
}

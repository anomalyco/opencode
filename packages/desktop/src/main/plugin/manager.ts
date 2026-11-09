import { pluginEnabled } from "@opencode/plugin/gui/host"
import type { Database } from "../storage/database"
import { plugin } from "../storage/schema"
import { readEnableState } from "./enable-state"
import { PluginError } from "./error"

/** Plugin enable state in the desktop database. Built-ins always run; `builtins` are their ids. */
export function createManager(db: Database, builtins: readonly string[]) {
  return {
    /** Always true for a built-in; otherwise the setting saved under the id, and no setting means enabled. */
    enabled(id: string) {
      return pluginEnabled({ id, builtin: builtins.includes(id) }, readEnableState(db.$client))
    },
    /** Saves the setting under the id; a built-in always runs, so it throws a `builtin` PluginError for one. */
    setEnabled(id: string, enabled: boolean) {
      if (builtins.includes(id)) throw new PluginError("builtin")
      db.insert(plugin).values({ id, enabled }).onConflictDoUpdate({ target: plugin.id, set: { enabled } }).run()
    },
  }
}

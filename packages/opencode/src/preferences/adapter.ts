// Adapter layer for Desktop (and other clients) to consume plugin-registered preferences.
// This module exposes a minimal API used by the Desktop app to list preference tabs,
// read current values, validate and apply changes.

import { preferenceRegistry } from "../plugin/preferences/registry"
import path from "path"
import fs from "fs/promises"
import { modify, parse as parseJsonc, applyEdits } from "jsonc-parser"
import { Instance } from "../project/instance"

export type PreferenceTab = {
  pluginId: string
  id: string
  title: string
  icon?: string
  requiresRestart?: boolean
  schema: Record<string, any>
  defaults: Record<string, any>
  ui?: Record<string, any>
}

export async function listPreferenceTabs(): Promise<PreferenceTab[]> {
  const regs = preferenceRegistry.getAllRegistrations()
  const out: PreferenceTab[] = []
  for (const [pluginId, reg] of regs) {
    out.push({
      pluginId,
      id: reg.id,
      title: reg.title,
      icon: reg.icon,
      requiresRestart: reg.requiresRestart,
      schema: reg.schema,
      defaults: reg.defaults,
      ui: reg.ui,
    })
  }
  return out
}

export async function getPreferenceValues(pluginId: string): Promise<Record<string, any>> {
  return preferenceRegistry.getValues(pluginId)
}

export async function validatePreferenceValue(pluginId: string, key: string, value: any) {
  return preferenceRegistry.validateValue(pluginId, key, value)
}

export async function applyPreferenceChange(pluginId: string, key: string, value: any) {
  const oldValues = await preferenceRegistry.getValues(pluginId)
  const oldValue = oldValues[key]
  await preferenceRegistry.handleChange(pluginId, key, value, oldValue)

  // Persist change to project opencode.jsonc under namespaced plugin_preferences
  // location: <project-root>/opencode.jsonc (or opencode.json)
  try {
    const dir = Instance.directory
    const candidates = [path.join(dir, "opencode.jsonc"), path.join(dir, "opencode.json")]
    let filepath = candidates.find((p) => {
      try {
        // use sync check via fs.access not available sync here; we'll assume existence by trying to read
        return require('fs').existsSync(p)
      } catch {
        return false
      }
    })

    if (!filepath) {
      // default to opencode.jsonc in project root
      filepath = path.join(dir, "opencode.jsonc")
    }

    let text = "{}"
    try {
      text = await fs.readFile(filepath, "utf8")
    } catch (err) {
      text = "{}"
    }

    // compute edit to set plugin_preferences.<pluginId>.<key> = value
    const pathSegments = ["plugin_preferences", pluginId, key]
    const edits = modify(text, pathSegments, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })
    const updated = applyEdits(text, edits)
    await fs.writeFile(filepath, updated, "utf8")
  } catch (err) {
    // best-effort persistence; log and continue
    try {
      const { Log } = await import("../util/log")
      const log = Log.create({ service: "preferences" })
      log.error("failed to persist preference change", { pluginId, key, err })
    } catch {}
  }
}

export const adapter = {
  listPreferenceTabs,
  getPreferenceValues,
  validatePreferenceValue,
  applyPreferenceChange,
}

export default adapter

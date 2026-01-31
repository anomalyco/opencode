import { adapter } from "../../preferences/adapter"
import type { ServerRequest, ServerResponse } from "../types"

/**
 * Lightweight HTTP handlers for plugin preferences. The server may import and
 * wire these handlers into its route table. We keep this module minimal so it
 * can be integrated into existing server route registration logic.
 */

export async function listTabs(_req: ServerRequest, res: ServerResponse) {
  try {
    const tabs = await adapter.listPreferenceTabs()
    return res.json({ ok: true, tabs })
  } catch (err) {
    return res.json({ ok: false, error: String(err) }, 500)
  }
}

export async function getValues(req: ServerRequest, res: ServerResponse) {
  try {
    const { pluginId } = req.params
    const values = await adapter.getPreferenceValues(pluginId)
    return res.json({ ok: true, values })
  } catch (err) {
    return res.json({ ok: false, error: String(err) }, 500)
  }
}

export async function validate(req: ServerRequest, res: ServerResponse) {
  try {
    const { pluginId } = req.params
    const { key, value } = await req.json()
    const result = await adapter.validatePreferenceValue(pluginId, key, value)
    return res.json({ ok: true, result })
  } catch (err) {
    return res.json({ ok: false, error: String(err) }, 500)
  }
}

export async function applyChange(req: ServerRequest, res: ServerResponse) {
  try {
    const { pluginId } = req.params
    const { key, value } = await req.json()
    await adapter.applyPreferenceChange(pluginId, key, value)
    return res.json({ ok: true })
  } catch (err) {
    return res.json({ ok: false, error: String(err) }, 500)
  }
}

export const PreferenceRoutes = {
  listTabs,
  getValues,
  validate,
  applyChange,
}

export default PreferenceRoutes

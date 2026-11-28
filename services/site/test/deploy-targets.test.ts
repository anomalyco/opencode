import { describe, expect, test } from "bun:test"
import { resolveAndParseConfig } from "@cloudflare/config"
import devTarget from "../../../.github/release/targets/site/dev/worker.json"
import productionTarget from "../../../.github/release/targets/site/production/worker.json"

const targets = [
  ["dev", devTarget],
  ["production", productionTarget],
] as const

describe("site deploy targets", () => {
  for (const [mode, target] of targets) {
    test(`${mode} pinned target matches the generated Worker config`, async () => {
      const parsed = await resolveAndParseConfig((await import("../cloudflare.config")).default, {
        isPreview: false,
        mode,
      })
      expect(parsed.success).toBe(true)
      if (!parsed.success) return

      // The build adds this manifest to the artifact after the config is resolved.
      const { manifest: _manifest, ...pinned } = target as typeof target & { manifest?: unknown }
      expect(JSON.parse(JSON.stringify(parsed.data.worker))).toEqual(pinned)
    })
  }
})

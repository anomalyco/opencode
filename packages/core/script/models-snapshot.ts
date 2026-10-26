import type { BunPlugin } from "bun"
import { Effect } from "effect"
import { ModelsDev } from "../src/models-dev"

// A floor, not equality: guards against an error page or a truncated body
// that still parses as a small object.
const MINIMUM_PROVIDERS = 100
export const committedSnapshot = new URL("../src/models-dev/snapshot.txt", import.meta.url)

export async function fetchModelsSnapshot() {
  const source = process.env.OPENCODE_MODELS_URL || "https://models.opencode.ai"
  const response = await fetch(`${source}/api.json`, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${source}/api.json returned ${response.status} ${response.statusText}`)
  return validateModelsSnapshot(await response.text())
}

async function validateModelsSnapshot(text: string) {
  const providers = (await Effect.runPromise(ModelsDev.decodeSnapshot(text))).length
  if (providers < MINIMUM_PROVIDERS)
    throw new Error(`models.dev catalog has ${providers} providers, expected at least ${MINIMUM_PROVIDERS}`)
  return { text, providers }
}

export async function bundledModelsSnapshot() {
  const file = process.env.OPENCODE_MODELS_SNAPSHOT
  if (!file) return Bun.file(committedSnapshot).text()
  const snapshot = await validateModelsSnapshot(await Bun.file(file).text())
  console.log(`bundling models.dev catalog from ${file} (${snapshot.providers} providers)`)
  return snapshot.text
}

export function modelsSnapshotPlugin(text: string): BunPlugin {
  return {
    name: "opencode-models-snapshot",
    setup(build) {
      build.onLoad({ filter: /models-dev[/\\]snapshot\.txt$/ }, () => ({ contents: text, loader: "text" }))
    },
  }
}

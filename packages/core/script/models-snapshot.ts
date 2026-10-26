import type { BunPlugin } from "bun"
import { Effect } from "effect"
import { ModelsDev } from "../src/models-dev"

// A floor, not equality: guards against an error page or a truncated body
// that still parses as a small object.
const MINIMUM_PROVIDERS = 100
const source = process.env.OPENCODE_MODELS_URL || "https://models.opencode.ai"
export const committedSnapshot = new URL("../src/models-dev/snapshot.txt", import.meta.url)

export async function fetchModelsSnapshot() {
  const response = await fetch(`${source}/api.json`, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${source}/api.json returned ${response.status} ${response.statusText}`)
  const text = await response.text()
  const providers = (await Effect.runPromise(ModelsDev.decodeSnapshot(text))).length
  if (providers < MINIMUM_PROVIDERS)
    throw new Error(`${source}/api.json has ${providers} providers, expected at least ${MINIMUM_PROVIDERS}`)
  return { text, providers }
}

export async function bundledModelsSnapshot() {
  const fetched = await fetchModelsSnapshot()
    .catch(() => fetchModelsSnapshot())
    .catch((error: unknown) => {
      console.warn(
        `WARNING: could not fetch the models.dev catalog, bundling the committed snapshot instead: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  if (!fetched) return Bun.file(committedSnapshot).text()
  console.log(`bundling live models.dev catalog from ${source} (${fetched.providers} providers)`)
  return fetched.text
}

export function modelsSnapshotPlugin(text: string): BunPlugin {
  return {
    name: "opencode-models-snapshot",
    setup(build) {
      build.onLoad({ filter: /models-dev[/\\]snapshot\.txt$/ }, () => ({ contents: text, loader: "text" }))
    },
  }
}

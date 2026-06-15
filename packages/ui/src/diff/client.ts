import type { DiffSource } from "../components/session-diff"
import { DiffPreparation } from "./client-core"

let client: DiffPreparation | undefined

export function prepareDiff(source: DiffSource) {
  if (!client) {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
    const next = new DiffPreparation(worker, () => {
      worker.terminate()
      if (client === next) client = undefined
    })
    client = next
  }
  return client.prepare(source)
}

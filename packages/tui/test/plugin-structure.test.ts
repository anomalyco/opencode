import { expect, test } from "bun:test"
import type { Claim, Degraded, PlacementKind, Slotted, Suppressed } from "../src/plugin/structure"

function claim(kind: PlacementKind, target: string, id: string): Claim<string> {
  return { key: `p/${id}`, plugin: "p", placement: { kind, target }, render: id }
}

type SerializedResolution = {
  readonly slotted: ReadonlyArray<[string, Slotted<string>]>
  readonly suppressed: ReadonlyArray<Suppressed<string>>
  readonly degraded: ReadonlyArray<Degraded<string>>
}

// Run resolveSlots off the main thread so a synchronous infinite loop fails
// via the timeout instead of blocking the test runner.
async function resolveWithTimeout(
  paths: ReadonlyArray<string>,
  claims: ReadonlyArray<Claim<string>>,
  timeoutMs = 5_000,
): Promise<SerializedResolution> {
  const moduleUrl = new URL("../src/plugin/structure.ts", import.meta.url).href
  const source = `
    import { resolveSlots } from ${JSON.stringify(moduleUrl)}
    self.onmessage = (event) => {
      const result = resolveSlots({ paths: new Set(event.data.paths), claims: event.data.claims })
      self.postMessage({
        slotted: [...result.slotted.entries()],
        suppressed: result.suppressed,
        degraded: result.degraded,
      })
    }
  `
  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
  const worker = new Worker(blobUrl)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<SerializedResolution>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`resolveSlots did not return within ${timeoutMs}ms`)), timeoutMs)
      worker.onmessage = (event) => resolve(event.data as SerializedResolution)
      worker.onerror = (event) => reject(event.error ?? new Error(event.message))
      worker.postMessage({ paths, claims })
    })
  } finally {
    clearTimeout(timer)
    worker.terminate()
    URL.revokeObjectURL(blobUrl)
  }
}

test("suppresses slot claims targeting paths with empty segments without hanging", async () => {
  const invalid = [
    claim("append", ".x", "leading"),
    claim("after", ".", "dot"),
    claim("before", ".side.child", "leading-nested"),
    claim("prepend", "", "empty"),
    claim("append", "side.", "trailing"),
    claim("append", "side..child", "double-dot"),
    claim("replace", "side..child", "replace-double-dot"),
    claim("replace", ".x", "replace-leading"),
  ]
  const direct = claim("append", "side", "direct")
  const degraded = claim("after", "side.missing", "degraded")

  const result = await resolveWithTimeout(["side", "side.child"], [...invalid, direct, degraded])

  expect(result.slotted).toEqual([
    [
      "side",
      {
        before: [],
        prepend: [],
        append: [direct, degraded],
        after: [],
      },
    ],
  ])
  expect(result.degraded).toEqual([{ claim: degraded, to: "side" }])
  expect(result.suppressed).toEqual([...invalid.slice(6), ...invalid.slice(0, 6)].map((item) => ({ claim: item })))
})

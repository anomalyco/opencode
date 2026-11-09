import { CodeMode, type Extension } from "../../src/index.js"

export * from "../../src/codemode.js"

// The suite runs on the engine the environment selects (`bun run test:vm`, `test:roundtrip`), unless a test picks one.
export const engine: "legacy" | "vm" =
  process.env.CODEMODE_ENGINE === "vm" || process.env.CODEMODE_ROUNDTRIP === "1" ? "vm" : "legacy"

if (process.env.CODEMODE_ROUNDTRIP === "1") {
  const { setRoundTrip } = await import("../../src/vm/runtime/execute.js")
  setRoundTrip(true)
}

export const make = <
  const Provided extends Record<string, unknown> = {},
  const Extensions extends ReadonlyArray<Extension.Extension> = [],
>(
  options: CodeMode.Options<Provided, Extensions> = {},
) => CodeMode.make<Provided, Extensions>({ engine, ...options })

export const execute: typeof CodeMode.execute = (options) => CodeMode.execute({ engine, ...options })

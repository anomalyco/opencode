import { CodeMode } from "../../src/index.js"

export * from "../../src/codemode.js"

// The suite runs on the engine the environment selects (`bun run test:vm`, `test:roundtrip`), unless a test picks one.
export const engine: "legacy" | "vm" =
  process.env.CODEMODE_ENGINE === "vm" || process.env.CODEMODE_ROUNDTRIP === "1" ? "vm" : "legacy"

export const make: typeof CodeMode.make = (options = {}) => CodeMode.make({ engine, ...options })

export const execute: typeof CodeMode.execute = (options) => CodeMode.execute({ engine, ...options })

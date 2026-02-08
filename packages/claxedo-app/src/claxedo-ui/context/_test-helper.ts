/**
 * Shared test helper for claxedo layout tests.
 *
 * Both claxedo-layout.test.ts and terminal-integration.test.ts need to:
 * 1. Mock @opencode-ai/ui/context to capture the init function
 * 2. Mock @opencode-ai/claxedo-app for persisted/Persist
 * 3. Import ./claxedo-layout to trigger the capture
 *
 * When bun runs multiple test files in the same process, mock.module is global
 * and import() caches modules. This means only the first file to import
 * ./claxedo-layout triggers createSimpleContext. By extracting this into a
 * shared module, initLayout is captured once and reused.
 */
import { mock } from "bun:test"

let _initLayout: (() => any) | undefined
let _loaded = false

export async function ensureLayoutMocked() {
  if (_loaded) return
  _loaded = true

  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: (config: any) => {
      _initLayout = config.init
      return { use: () => {}, provider: () => {} }
    },
  }))

  mock.module("@opencode-ai/claxedo-app", () => ({
    Persist: { global: () => ({}) },
    persisted: (_target: any, storeResult: any) => [...storeResult, undefined, () => true],
  }))

  await import("./claxedo-layout")
}

export function getInitLayout(): () => any {
  if (!_initLayout) throw new Error("initLayout not captured — call ensureLayoutMocked() in beforeAll first")
  return _initLayout
}

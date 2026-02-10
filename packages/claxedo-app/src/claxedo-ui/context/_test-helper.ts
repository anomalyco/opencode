/**
 * Shared test helper for claxedo layout tests.
 *
 * All test files that transitively import claxedo-layout.tsx must call
 * ensureLayoutMocked() in beforeAll BEFORE any import of claxedo-layout
 * (including transitive imports via terminal-content-wrapper, etc.).
 *
 * Mocks are always re-registered because bun may restore them between test
 * files while the module cache persists. The init function is only captured
 * on the first call (when claxedo-layout.tsx is first evaluated).
 */
import { mock } from "bun:test"

let _initLayout: (() => any) | undefined

export async function ensureLayoutMocked() {
  // Always re-register mocks — bun restores them between test files
  // but the module cache (and _initLayout) persists across files.
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: (config: any) => {
      if (config.name === "ClaxedoLayout") _initLayout = config.init
      return { use: () => {}, provider: () => {} }
    },
  }))

  mock.module("@opencode-ai/claxedo-app", () => ({
    Persist: { global: () => ({}) },
    persisted: (_target: any, storeResult: any) => [...storeResult, undefined, () => true],
  }))

  // Only the first import triggers module evaluation and captures _initLayout.
  // Subsequent calls get the cached module (no-op) but mocks are still active.
  await import("./claxedo-layout")
}

export function getInitLayout(): () => any {
  if (!_initLayout) throw new Error("initLayout not captured — call ensureLayoutMocked() in beforeAll first")
  return _initLayout
}

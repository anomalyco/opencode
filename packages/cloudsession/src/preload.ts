/**
 * Mock for cloudflare:workers module in tests
 * This file is preloaded before tests run
 */

import { mock } from "bun:test"

// Mock the durable-object wrapper module
mock.module("./durable-object.ts", () => ({
  DurableObject: class DurableObject<Env = unknown> {
    constructor(
      protected ctx: DurableObjectState,
      protected env: Env,
    ) {}
  },
}))

// Also mock with absolute path
mock.module("/home/jm/data/code/opencode-trees/sessions-viewer/packages/sessions/src/durable-object.ts", () => ({
  DurableObject: class DurableObject<Env = unknown> {
    constructor(
      protected ctx: DurableObjectState,
      protected env: Env,
    ) {}
  },
}))

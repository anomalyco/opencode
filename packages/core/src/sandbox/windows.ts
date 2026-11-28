export * as WindowsSandbox from "./windows.js"

import type { SandboxBackend } from "./backend.js"

// Supply a backend only after Windows can enforce the policy for commands and file workers.
export function backend(): SandboxBackend.Interface {
  throw new Error("Windows sandboxing is not implemented")
}

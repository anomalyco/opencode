// packages/opencode/src/workflow/sandbox.ts
// Path sandboxing: ensure all workflow install destinations stay inside the
// workflows base directory. Prevents path traversal (e.g., "../../.ssh").

import path from "path"
import { Workflow } from "./index"

/**
 * Validate that destDir is strictly inside workflowsDir().
 * Throws if the resolved path escapes the sandbox.
 */
export function validateWorkflowPath(destDir: string): void {
  const base = path.resolve(Workflow.workflowsDir())
  const resolved = path.resolve(destDir)

  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(
      `Security: workflow path "${resolved}" escapes the workflow sandbox directory "${base}". ` +
      `Workflow plugins must be installed inside ${base}.`
    )
  }
}

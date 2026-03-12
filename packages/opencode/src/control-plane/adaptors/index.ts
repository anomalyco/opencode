import { lazy } from "@/util/lazy"
import type { Adaptor } from "../types"
import type { WorkspaceAdaptor } from "@opencode-ai/plugin"

const ADAPTORS: Record<string, () => Adaptor | Promise<Adaptor>> = {
  worktree: lazy(async () => (await import("./worktree")).WorktreeAdaptor),
}

export async function getAdaptor(type: string): Promise<Adaptor> {
  const factory = ADAPTORS[type]
  if (!factory) throw new Error(`Unknown workspace adaptor type "${type}". Available: ${listTypes().join(", ")}`)
  return factory()
}

// Accepts both internal Adaptor (branded IDs) and plugin WorkspaceAdaptor
// (plain strings). The branded types are structurally identical at runtime.
export function installAdaptor(type: string, adaptor: Adaptor | WorkspaceAdaptor) {
  ADAPTORS[type] = () => adaptor as Adaptor
}

export function listTypes(): string[] {
  return Object.keys(ADAPTORS)
}

export async function detectAdaptor(directory: string) {
  for (const type of listTypes()) {
    if (type === "worktree") continue
    const adaptor = await getAdaptor(type)
    if (adaptor.detect && (await adaptor.detect(directory))) {
      return { type, adaptor }
    }
  }
}

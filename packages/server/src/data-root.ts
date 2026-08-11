export * as DataRoot from "./data-root"

import { Global } from "@opencode-ai/core/global"
import { Context, Effect, Layer } from "effect"
import path from "path"

// ─── DataRootConfig ────────────────────────────────────────────
//
// Controls the root directory for server-managed data (workspaces, etc).
// Defaults to @opencode-ai/core/global Path.data (which follows XDG base dir
// convention). Can be overridden via OPENCODE_DATA_ROOT env var.

const workspaceDir = (root: string) => path.join(root, "workspaces")

export class DataRootConfig extends Context.Service<DataRootConfig, string>()("@opencode/DataRootConfig") {
  static get layer() {
    // Note: uses Effect.sync instead of EffectConfig so that process.env
    // is read fresh each time the layer is built. EffectConfig caches the
    // env snapshot on first read, which makes testing different values in
    // the same process impossible.
    return Layer.effect(
      this,
      Effect.sync(() => {
        const root = process.env.OPENCODE_DATA_ROOT ?? Global.Path.data
        return DataRootConfig.of(root)
      }),
    )
  }
}

// ─── Workspace directory helper ─────────────────────────────────
//
// Derives the per-user workspace path from the configured data root.
// Used by session.create to determine the default location.directory.

export function workspacePath(userID: string, dataRoot: string): string {
  // Defense-in-depth: caller (deriveDefaultLocation) already guards against
  // empty userID, but if someone calls this directly the result would be the
  // workspace root with no subdirectory — multiple empty-userID callers would
  // collide. Reject empty userID explicitly.
  if (!userID) throw new TypeError("userID must not be empty")
  // encodeURIComponent does NOT encode "." or "..", so path-traversal
  // sequences like "../etc" would survive encoding. Strip them explicitly.
  const safe = encodeURIComponent(userID).replace(/\.\.?/g, (m) =>
    m === ".." ? "%2E%2E" : "%2E",
  )
  return path.join(workspaceDir(dataRoot), safe)
}

export function dataRootFromConfig(): Effect.Effect<string, never, DataRootConfig> {
  return Effect.map(DataRootConfig, (root) => root)
}

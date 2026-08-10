export * as DataRoot from "./data-root"

import { Global } from "@opencode-ai/core/global"
import { Config as EffectConfig, Context, Effect, Layer, Option } from "effect"
import path from "path"

// ─── DataRootConfig ────────────────────────────────────────────
//
// Controls the root directory for server-managed data (workspaces, etc).
// Defaults to @opencode-ai/core/global Path.data (which follows XDG base dir
// convention). Can be overridden via OPENCODE_DATA_ROOT env var.

const workspaceDir = (root: string) => path.join(root, "workspaces")

export class DataRootConfig extends Context.Service<DataRootConfig, string>()("@opencode/DataRootConfig") {
  static get layer() {
    return Layer.effect(
      this,
      EffectConfig.string("OPENCODE_DATA_ROOT").pipe(
        EffectConfig.withDefault(Global.Path.data),
        Effect.map((root) => DataRootConfig.of(root)),
      ),
    )
  }
}

// ─── Workspace directory helper ─────────────────────────────────
//
// Derives the per-user workspace path from the configured data root.
// Used by session.create to determine the default location.directory.

export function workspacePath(userID: string, dataRoot: string): string {
  return path.join(workspaceDir(dataRoot), encodeURIComponent(userID))
}

export function dataRootFromConfig(): Effect.Effect<string, never, DataRootConfig> {
  return Effect.map(DataRootConfig, (root) => root)
}

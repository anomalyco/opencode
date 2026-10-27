export * as CodeModeRun from "./run.js"

import type { CodeMode } from "@opencode/codemode"
import type { Context as ToolContext, Info } from "@opencode/schema/tool"
import { Context, type Effect } from "effect"
import type { Permission } from "../permission.js"

// Per-execution parts of a runtime shared by every execution against the same inventory.
export class Service extends Context.Service<
  Service,
  {
    readonly context: ToolContext
    readonly permission: Permission.Interface
    readonly executeTool: (name: string, tool: Info, input: unknown) => Effect.Effect<unknown, unknown>
    readonly hooks: CodeMode.Hooks
  }
>()("@opencode/CodeModeTool/Run") {}

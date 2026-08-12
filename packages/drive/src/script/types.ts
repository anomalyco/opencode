import type * as Effect from "effect/Effect"
import type * as Tool from "../tool/index.js"
import type * as OpenCodeUi from "../driver/ui.js"
import type * as OpenCodeTui from "../driver/client.js"
import type { Llm } from "../driver/llm.js"
import type * as OpenCodeServer from "../driver/server.js"
import type * as OpenCodeSdk from "../driver/opencode.js"
import type {
  OpenCodeConfig,
  OpenCodeTuiConfig,
  Project,
  ProjectFileSystem,
  Setup,
} from "../project.js"
export type * from "../project.js"
export type ScriptServerLaunchError = Effect.Error<
  ReturnType<OpenCodeServer.Server["launch"]>
>
export type ScriptServerKillError = Effect.Error<
  ReturnType<OpenCodeServer.Server["kill"]>
>

export interface ScriptServer {
  /** Launches the one shared OpenCode server for this script. */
  launch(): Effect.Effect<OpenCodeSdk.OpenCode, ScriptServerLaunchError>
  /** Stops the shared server. It may be launched again afterward. */
  kill(): Effect.Effect<void, ScriptServerKillError>
}

export interface ScriptContext {
  /** Generated SDK client connected to this script's private OpenCode service. */
  readonly opencode: OpenCodeSdk.OpenCode
  readonly fs: ProjectFileSystem
  readonly tui: OpenCodeTui.Tui
  /** Convenience alias for the primary TUI's UI. */
  readonly ui: OpenCodeUi.Ui
  readonly tuis: OpenCodeTui.Tuis
  readonly server: ScriptServer
  readonly llm: Llm
  /** Runtime controls for tools declared by name on the script. */
  readonly tools: Tool.Controls
  readonly artifacts: string
}

export interface ManualScriptContext extends Omit<ScriptContext, "opencode" | "tui" | "ui"> {
  readonly tui: null
  readonly ui: null
}

export type ScriptRun = (context: ScriptContext) => Effect.Effect<void, unknown>
export type ManualScriptRun = (
  context: ManualScriptContext,
) => Effect.Effect<void, unknown>

export interface AutomaticScriptDefinition {
  /** Declares the isolated project OpenCode runs against. */
  readonly project?: Project
  /** OpenCode configuration merged over project fixture configuration. */
  readonly config?: OpenCodeConfig
  /** OpenCode TUI configuration merged over project fixture configuration. */
  readonly tuiConfig?: OpenCodeTuiConfig
  /** Runs once before OpenCode starts. */
  readonly setup?: Setup
  /** Declares runtime-controlled tool names or fixed replacements before OpenCode starts. */
  readonly tools?: Tool.Configuration
  /** Configures the automatically launched primary TUI. */
  readonly tui?: OpenCodeTui.TuiOptions
  /** Runs after the UI and LLM connections are ready, and again after restart. */
  readonly run: ScriptRun
}

export interface ManualScriptDefinition {
  /** The server and every TUI are launched explicitly by the script. */
  readonly launch: "manual"
  /** Declares the isolated project OpenCode runs against. */
  readonly project?: Project
  /** OpenCode configuration merged over project fixture configuration. */
  readonly config?: OpenCodeConfig
  /** OpenCode TUI configuration merged over project fixture configuration. */
  readonly tuiConfig?: OpenCodeTuiConfig
  /** Runs once before OpenCode starts. */
  readonly setup?: Setup
  /** Declares runtime-controlled tool names or fixed replacements before OpenCode starts. */
  readonly tools?: Tool.Configuration
  /** Defaults for TUIs launched by the script. */
  readonly tui?: OpenCodeTui.TuiOptions
  /** Runs after the shared service and LLM connection are ready. */
  readonly run: ManualScriptRun
}

export type ScriptDefinitionInput =
  | AutomaticScriptDefinition
  | ManualScriptDefinition

export type ScriptDefinition = ScriptDefinitionInput & {
  readonly kind: "opencode-drive/script"
}

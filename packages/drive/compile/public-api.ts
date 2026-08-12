import * as Effect from "effect/Effect"
import { OpenCodeDriver, Tool } from "../src/index.js"
import type {
  Frontend,
  Project,
  Tui,
  Tuis,
  Ui,
} from "../src/index.js"
import type { ScriptContext } from "../src/script/types.js"

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false

type Assert<Value extends true> = Value

export type ScriptUiIsCanonical = Assert<Equal<ScriptContext["ui"], Ui>>
export type ScriptTuiIsCanonical = Assert<
  Equal<ScriptContext["tui"], Tui>
>
export type ScriptTuisAreCanonical = Assert<
  Equal<ScriptContext["tuis"], Tuis>
>
export type ScriptToolsAreCanonical = Assert<
  Equal<ScriptContext["tools"], Tool.Controls>
>
export type DriverToolsAreCanonical = Assert<
  Equal<OpenCodeDriver.Driver["tools"], Tool.Controls>
>
export type LaunchedTuiIsCanonical = Assert<
  Equal<Effect.Success<ReturnType<Tuis["launch"]>>, Tui>
>
export type ResizeIsCanonicalAction = Assert<
  Equal<
    Extract<Frontend.Action, { readonly type: "ui.resize" }>,
    {
      readonly type: "ui.resize"
      readonly cols: number
      readonly rows: number
    }
  >
>
export type DriverProjectIsCanonical = Assert<
  Equal<NonNullable<OpenCodeDriver.Options["project"]>, Project>
>

const zeroConfig = OpenCodeDriver.use(() => Effect.void)
export type ZeroConfigUseIsRunnable = Assert<
  Equal<Effect.Services<typeof zeroConfig>, never>
>

const controlledOptions: OpenCodeDriver.Options = { tools: ["shell"] }
declare const controls: Tool.Controls
const shellCalls = controls.control("shell")
declare const dynamicTools: Tool.AttachParams
const attached = controls.attach(dynamicTools)
const dynamicCall = controls.take("call_lookup")
declare const toolName: Tool.Name
controls.control(toolName)
export type ShellControlIsTyped = Assert<
  Equal<
    Effect.Success<typeof shellCalls>,
    Tool.ControlledCalls<Tool.ShellInput, Tool.ShellResult>
  >
>
export type DynamicAttachIsTyped = Assert<
  Equal<Effect.Success<typeof attached>, void>
>
export type DynamicCallIsTyped = Assert<
  Equal<Effect.Success<typeof dynamicCall>, Tool.Invocation>
>
const controlled = OpenCodeDriver.use(controlledOptions, ({ tools }) =>
  tools.control("shell").pipe(Effect.asVoid),
)
export type ControlledUseIsRunnable = Assert<
  Equal<Effect.Services<typeof controlled>, never>
>

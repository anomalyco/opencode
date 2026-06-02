import * as Tool from "../../tool/tool"
import { NavigateTool } from "./navigate"
import { ActionTool } from "./action"
import { ObserveTool } from "./observe"
import { EvalTool } from "./eval"
import { WaitTool } from "./wait"
import { DebugTool } from "./debug"
import { ContextTool } from "./context"

export const BrowserTools = [NavigateTool, ActionTool, ObserveTool, WaitTool, ContextTool, DebugTool, EvalTool] as const

export type BrowserTool = (typeof BrowserTools)[number]

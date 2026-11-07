export * as CodeModeExecution from "./execution.js"

import type { Context as ToolContext } from "@Mackery6969/schema/tool"
import { Context } from "effect"

/** The `execute` call a Code Mode program runs under, so extensions can act for its session like a tool does. */
export class Service extends Context.Service<Service, ToolContext>()("@Mackery6969/CodeModeExecution") {}

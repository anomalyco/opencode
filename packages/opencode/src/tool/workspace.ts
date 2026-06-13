import { EventV2Bridge } from "@/event-v2-bridge"
import { WorkspaceAction } from "@/workspace/action"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const DESCRIPTION = `Open visible workspace tabs in the app for the user.

Use this when opening a file, browser page, or terminal tab would help the user inspect or continue the work. This tool does not read file contents, run commands, or interact with the browser page; it only asks the app UI to open the requested workspace surface.`

export const Parameters = Schema.Struct({
  action: Schema.Literals(["open_file", "open_browser", "open_terminal"]).annotate({
    description: "Workspace action to request",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "Project-relative or absolute file path for open_file",
  }),
  url: Schema.optional(Schema.String).annotate({
    description: "URL for open_browser. Include http:// or https:// when opening a web page.",
  }),
  title: Schema.optional(Schema.String).annotate({
    description: "Optional tab title",
  }),
  activate: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to focus the opened tab. Defaults to true.",
  }),
})

type Metadata = {
  action: Schema.Schema.Type<typeof Parameters>["action"]
  target?: string
  error?: string
}

function workspaceAction(params: Schema.Schema.Type<typeof Parameters>): WorkspaceAction.Action | string {
  if (params.action === "open_file") {
    const path = params.path?.trim()
    if (!path) return "path is required for open_file"
    return {
      type: "openFile",
      path,
      ...(params.title?.trim() ? { title: params.title.trim() } : {}),
      ...(params.activate === undefined ? {} : { activate: params.activate }),
    }
  }
  if (params.action === "open_browser") {
    const url = params.url?.trim()
    if (!url) return "url is required for open_browser"
    return {
      type: "openBrowser",
      url,
      ...(params.title?.trim() ? { title: params.title.trim() } : {}),
      ...(params.activate === undefined ? {} : { activate: params.activate }),
    }
  }
  return {
    type: "openTerminal",
    ...(params.title?.trim() ? { title: params.title.trim() } : {}),
    ...(params.activate === undefined ? {} : { activate: params.activate }),
  }
}

function target(params: Schema.Schema.Type<typeof Parameters>) {
  if (params.action === "open_file") return params.path?.trim()
  if (params.action === "open_browser") return params.url?.trim()
  return "terminal"
}

export const WorkspaceTool = Tool.define<typeof Parameters, Metadata, EventV2Bridge.Service>(
  "workspace",
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const action = workspaceAction(params)
          const resource = target(params) ?? "*"
          if (typeof action === "string") {
            return {
              title: "Workspace action",
              output: `Cannot request ${params.action}: ${action}.`,
              metadata: { action: params.action, target: resource, error: action },
            }
          }

          yield* ctx.ask({
            permission: "workspace",
            patterns: [`${params.action}:${resource}`],
            always: ["*"],
            metadata: { action: params.action, target: resource },
          })

          yield* events.publish(WorkspaceAction.Event.Requested, {
            sessionID: ctx.sessionID,
            action,
          })

          return {
            title: "Workspace action",
            output: `Requested ${params.action} for ${resource}.`,
            metadata: { action: params.action, target: resource },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)

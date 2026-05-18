import { TuiEvent } from "@/cli/cmd/tui/event"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/tui"
export const CommandPayload = Schema.Struct({ command: Schema.String })
export const TuiRequestPayload = Schema.Struct({
  path: Schema.String,
  body: Schema.Unknown,
})
const EventTuiPromptAppend = Schema.Struct({
  type: Schema.Literal(TuiEvent.PromptAppend.type),
  properties: TuiEvent.PromptAppend.properties,
}).annotate({ identifier: "EventTuiPromptAppend" })
const EventTuiCommandExecute = Schema.Struct({
  type: Schema.Literal(TuiEvent.CommandExecute.type),
  properties: TuiEvent.CommandExecute.properties,
}).annotate({ identifier: "EventTuiCommandExecute" })
const EventTuiToastShow = Schema.Struct({
  type: Schema.Literal(TuiEvent.ToastShow.type),
  properties: TuiEvent.ToastShow.properties,
}).annotate({ identifier: "EventTuiToastShow" })
const EventTuiSessionSelect = Schema.Struct({
  type: Schema.Literal(TuiEvent.SessionSelect.type),
  properties: TuiEvent.SessionSelect.properties,
}).annotate({ identifier: "EventTuiSessionSelect" })
export const TuiPublishPayload = Schema.Union([
  EventTuiPromptAppend,
  EventTuiCommandExecute,
  EventTuiToastShow,
  EventTuiSessionSelect,
])

export const TuiPaths = {
  appendPrompt: `${root}/append-prompt`,
  openHelp: `${root}/open-help`,
  openSessions: `${root}/open-sessions`,
  openThemes: `${root}/open-themes`,
  openModels: `${root}/open-models`,
  submitPrompt: `${root}/submit-prompt`,
  clearPrompt: `${root}/clear-prompt`,
  executeCommand: `${root}/execute-command`,
  showToast: `${root}/show-toast`,
  publish: `${root}/publish`,
  selectSession: `${root}/select-session`,
  controlNext: `${root}/control/next`,
  controlResponse: `${root}/control/response`,
} as const

export const TuiApi = HttpApi.make("tui")
  .add(
    HttpApiGroup.make("tui")
      .add(
        HttpApiEndpoint.post("appendPrompt", TuiPaths.appendPrompt, {
          payload: TuiEvent.PromptAppend.properties,
          success: described(Schema.Boolean, "Prompt processed successfully"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.appendPrompt",
            summary: "Append TUI prompt",
            description: "Append prompt to the TUI.",
          }),
        ),
        HttpApiEndpoint.post("openHelp", TuiPaths.openHelp, {
          success: described(Schema.Boolean, "Help dialog opened successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.openHelp",
            summary: "Open help dialog",
            description: "Open the help dialog in the TUI to display user assistance information.",
          }),
        ),
        HttpApiEndpoint.post("openSessions", TuiPaths.openSessions, {
          success: described(Schema.Boolean, "Session dialog opened successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.openSessions",
            summary: "Open sessions dialog",
            description: "Open the session dialog.",
          }),
        ),
        HttpApiEndpoint.post("openThemes", TuiPaths.openThemes, {
          success: described(Schema.Boolean, "Theme dialog opened successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.openThemes",
            summary: "Open themes dialog",
            description: "Open the theme dialog.",
          }),
        ),
        HttpApiEndpoint.post("openModels", TuiPaths.openModels, {
          success: described(Schema.Boolean, "Model dialog opened successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.openModels",
            summary: "Open models dialog",
            description: "Open the model dialog.",
          }),
        ),
        HttpApiEndpoint.post("submitPrompt", TuiPaths.submitPrompt, {
          success: described(Schema.Boolean, "Prompt submitted successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.submitPrompt",
            summary: "Submit TUI prompt",
            description: "Submit the prompt.",
          }),
        ),
        HttpApiEndpoint.post("clearPrompt", TuiPaths.clearPrompt, {
          success: described(Schema.Boolean, "Prompt cleared successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.clearPrompt",
            summary: "Clear TUI prompt",
            description: "Clear the prompt.",
          }),
        ),
        HttpApiEndpoint.post("executeCommand", TuiPaths.executeCommand, {
          payload: CommandPayload,
          success: described(Schema.Boolean, "Command executed successfully"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.executeCommand",
            summary: "Execute TUI command",
            description: "Execute a TUI command.",
          }),
        ),
        HttpApiEndpoint.post("showToast", TuiPaths.showToast, {
          payload: TuiEvent.ToastShow.properties,
          success: described(Schema.Boolean, "Toast notification shown successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.showToast",
            summary: "Show TUI toast",
            description: "Show a toast notification in the TUI.",
          }),
        ),
        HttpApiEndpoint.post("publish", TuiPaths.publish, {
          payload: TuiPublishPayload,
          success: described(Schema.Boolean, "Event published successfully"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.publish",
            summary: "Publish TUI event",
            description: "Publish a TUI event.",
          }),
        ),
        HttpApiEndpoint.post("selectSession", TuiPaths.selectSession, {
          payload: TuiEvent.SessionSelect.properties,
          success: described(Schema.Boolean, "Session selected successfully"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.selectSession",
            summary: "Select session",
            description: "Navigate the TUI to display the specified session.",
          }),
        ),
        HttpApiEndpoint.get("controlNext", TuiPaths.controlNext, {
          success: described(TuiRequestPayload, "Next TUI request"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.control.next",
            summary: "Get next TUI request",
            description: "Retrieve the next TUI request from the queue for processing.",
          }),
        ),
        HttpApiEndpoint.post("controlResponse", TuiPaths.controlResponse, {
          payload: Schema.Unknown,
          success: described(Schema.Boolean, "Response submitted successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.control.response",
            summary: "Submit TUI response",
            description: "Submit a response to the TUI request queue to complete a pending request.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "tui", description: "Experimental HttpApi TUI routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

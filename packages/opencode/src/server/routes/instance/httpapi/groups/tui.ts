import { TuiEvent } from "@/cli/cmd/tui/event"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../auth"
import { InstanceContextMiddleware } from "../instance-context"

const root = "/tui"
export const CommandPayload = Schema.Struct({ command: Schema.String }).annotate({ identifier: "TuiCommandInput" })
export const TuiRequestPayload = Schema.Struct({
  path: Schema.String,
  body: Schema.Unknown,
}).annotate({ identifier: "TuiRequest" })
export const TuiPublishPayload = Schema.Union([
  Schema.Struct({ type: Schema.Literal(TuiEvent.PromptAppend.type), properties: TuiEvent.PromptAppend.properties }).annotate({ identifier: "EventTuiPromptAppend" }),
  Schema.Struct({ type: Schema.Literal(TuiEvent.CommandExecute.type), properties: TuiEvent.CommandExecute.properties }).annotate({ identifier: "EventTuiCommandExecute" }),
  Schema.Struct({ type: Schema.Literal(TuiEvent.ToastShow.type), properties: TuiEvent.ToastShow.properties }).annotate({ identifier: "EventTuiToastShow" }),
  Schema.Struct({ type: Schema.Literal(TuiEvent.SessionSelect.type), properties: TuiEvent.SessionSelect.properties }).annotate({ identifier: "EventTuiSessionSelect" }),
]).annotate({ identifier: "TuiEventInput" })

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
          success: Schema.Boolean,
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.appendPrompt",
            summary: "Append TUI prompt",
            description: "Append prompt to the TUI.",
          }),
        ),
        HttpApiEndpoint.post("openHelp", TuiPaths.openHelp, { success: Schema.Boolean }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.openHelp",
            summary: "Open help dialog",
            description: "Open the help dialog in the TUI to display user assistance information.",
          }),
        ),
        HttpApiEndpoint.post("openSessions", TuiPaths.openSessions, { success: Schema.Boolean }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.openSessions",
            summary: "Open sessions dialog",
            description: "Open the session dialog.",
          }),
        ),
        HttpApiEndpoint.post("openThemes", TuiPaths.openThemes, { success: Schema.Boolean }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.openThemes",
            summary: "Open themes dialog",
            description: "Open the theme dialog.",
          }),
        ),
        HttpApiEndpoint.post("openModels", TuiPaths.openModels, { success: Schema.Boolean }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.openModels",
            summary: "Open models dialog",
            description: "Open the model dialog.",
          }),
        ),
        HttpApiEndpoint.post("submitPrompt", TuiPaths.submitPrompt, { success: Schema.Boolean }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.submitPrompt",
            summary: "Submit TUI prompt",
            description: "Submit the prompt.",
          }),
        ),
        HttpApiEndpoint.post("clearPrompt", TuiPaths.clearPrompt, { success: Schema.Boolean }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.clearPrompt",
            summary: "Clear TUI prompt",
            description: "Clear the prompt.",
          }),
        ),
        HttpApiEndpoint.post("executeCommand", TuiPaths.executeCommand, {
          payload: CommandPayload,
          success: Schema.Boolean,
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
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.showToast",
            summary: "Show TUI toast",
            description: "Show a toast notification in the TUI.",
          }),
        ),
        HttpApiEndpoint.post("publish", TuiPaths.publish, {
          payload: TuiPublishPayload,
          success: Schema.Boolean,
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
          success: Schema.Boolean,
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.selectSession",
            summary: "Select session",
            description: "Navigate the TUI to display the specified session.",
          }),
        ),
        HttpApiEndpoint.get("controlNext", TuiPaths.controlNext, { success: TuiRequestPayload }).annotateMerge(
          OpenApi.annotations({
            identifier: "tui.control.next",
            summary: "Get next TUI request",
            description: "Retrieve the next TUI request from the queue for processing.",
          }),
        ),
        HttpApiEndpoint.post("controlResponse", TuiPaths.controlResponse, {
          payload: Schema.Unknown,
          success: Schema.Boolean,
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
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )


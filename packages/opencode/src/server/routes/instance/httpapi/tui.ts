import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import * as Database from "@/storage/db"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { nextTuiRequest, submitTuiResponse } from "../tui"
import { Authorization } from "./auth"

const root = "/tui"
const CommandPayload = Schema.Struct({ command: Schema.String }).annotate({ identifier: "TuiCommandInput" })
const TuiRequestPayload = Schema.Struct({
  path: Schema.String,
  body: Schema.Unknown,
}).annotate({ identifier: "TuiRequest" })
const TuiPublishPayload = Schema.Union([
  Schema.Struct({ type: Schema.Literal(TuiEvent.PromptAppend.type), properties: TuiEvent.PromptAppend.properties }),
  Schema.Struct({ type: Schema.Literal(TuiEvent.CommandExecute.type), properties: TuiEvent.CommandExecute.properties }),
  Schema.Struct({ type: Schema.Literal(TuiEvent.ToastShow.type), properties: TuiEvent.ToastShow.properties }),
  Schema.Struct({ type: Schema.Literal(TuiEvent.SessionSelect.type), properties: TuiEvent.SessionSelect.properties }),
]).annotate({ identifier: "TuiEventInput" })

const commandAliases = {
  session_new: "session.new",
  session_share: "session.share",
  session_interrupt: "session.interrupt",
  session_compact: "session.compact",
  messages_page_up: "session.page.up",
  messages_page_down: "session.page.down",
  messages_line_up: "session.line.up",
  messages_line_down: "session.line.down",
  messages_half_page_up: "session.half.page.up",
  messages_half_page_down: "session.half.page.down",
  messages_first: "session.first",
  messages_last: "session.last",
  agent_cycle: "agent.cycle",
} as const

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
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const tuiHandlers = HttpApiBuilder.group(TuiApi, "tui", (handlers) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const publishCommand = (command: typeof TuiEvent.CommandExecute.properties.Type.command) =>
      bus.publish(TuiEvent.CommandExecute, { command })

    const appendPrompt = Effect.fn("TuiHttpApi.appendPrompt")(function* (ctx: {
      payload: typeof TuiEvent.PromptAppend.properties.Type
    }) {
      yield* bus.publish(TuiEvent.PromptAppend, ctx.payload)
      return true
    })

    const openHelp = Effect.fn("TuiHttpApi.openHelp")(function* () {
      yield* publishCommand("help.show")
      return true
    })

    const openSessions = Effect.fn("TuiHttpApi.openSessions")(function* () {
      yield* publishCommand("session.list")
      return true
    })

    const openThemes = Effect.fn("TuiHttpApi.openThemes")(function* () {
      yield* publishCommand("session.list")
      return true
    })

    const openModels = Effect.fn("TuiHttpApi.openModels")(function* () {
      yield* publishCommand("model.list")
      return true
    })

    const submitPrompt = Effect.fn("TuiHttpApi.submitPrompt")(function* () {
      yield* publishCommand("prompt.submit")
      return true
    })

    const clearPrompt = Effect.fn("TuiHttpApi.clearPrompt")(function* () {
      yield* publishCommand("prompt.clear")
      return true
    })

    const executeCommand = Effect.fn("TuiHttpApi.executeCommand")(function* (ctx: {
      payload: typeof CommandPayload.Type
    }) {
      yield* publishCommand(commandAliases[ctx.payload.command as keyof typeof commandAliases] ?? ctx.payload.command)
      return true
    })

    const showToast = Effect.fn("TuiHttpApi.showToast")(function* (ctx: {
      payload: typeof TuiEvent.ToastShow.properties.Type
    }) {
      yield* bus.publish(TuiEvent.ToastShow, ctx.payload)
      return true
    })

    const publish = Effect.fn("TuiHttpApi.publish")(function* (ctx: { payload: typeof TuiPublishPayload.Type }) {
      if (ctx.payload.type === TuiEvent.PromptAppend.type)
        yield* bus.publish(TuiEvent.PromptAppend, ctx.payload.properties)
      if (ctx.payload.type === TuiEvent.CommandExecute.type)
        yield* bus.publish(TuiEvent.CommandExecute, ctx.payload.properties)
      if (ctx.payload.type === TuiEvent.ToastShow.type) yield* bus.publish(TuiEvent.ToastShow, ctx.payload.properties)
      if (ctx.payload.type === TuiEvent.SessionSelect.type)
        yield* bus.publish(TuiEvent.SessionSelect, ctx.payload.properties)
      return true
    })

    const selectSession = Effect.fn("TuiHttpApi.selectSession")(function* (ctx: {
      payload: typeof TuiEvent.SessionSelect.properties.Type
    }) {
      const row = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, ctx.payload.sessionID)).get(),
        ),
      )
      if (!row) return yield* new HttpApiError.NotFound({})
      yield* bus.publish(TuiEvent.SessionSelect, ctx.payload)
      return true
    })

    const controlNext = Effect.fn("TuiHttpApi.controlNext")(function* () {
      return yield* Effect.promise(() => nextTuiRequest())
    })

    const controlResponse = Effect.fn("TuiHttpApi.controlResponse")(function* (ctx: { payload: unknown }) {
      submitTuiResponse(ctx.payload)
      return true
    })

    return handlers
      .handle("appendPrompt", appendPrompt)
      .handle("openHelp", openHelp)
      .handle("openSessions", openSessions)
      .handle("openThemes", openThemes)
      .handle("openModels", openModels)
      .handle("submitPrompt", submitPrompt)
      .handle("clearPrompt", clearPrompt)
      .handle("executeCommand", executeCommand)
      .handle("showToast", showToast)
      .handle("publish", publish)
      .handle("selectSession", selectSession)
      .handle("controlNext", controlNext)
      .handle("controlResponse", controlResponse)
  }),
)

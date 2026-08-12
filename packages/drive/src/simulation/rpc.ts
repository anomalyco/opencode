import * as Schema from "effect/Schema"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { Backend, Frontend, Handshake } from "./protocol.js"

export class SimulationRequestError extends Schema.TaggedErrorClass<SimulationRequestError>()(
  "SimulationRequestError",
  {
    method: Schema.String,
    code: Schema.Number,
    message: Schema.String,
    data: Schema.optionalKey(Schema.Json),
  },
) {}

const request = <
  const Tag extends string,
  Payload extends Schema.Top | Schema.Struct.Fields = typeof Schema.Void,
  Success extends Schema.Top = typeof Schema.Void,
>(
  tag: Tag,
  options?: {
    readonly payload?: Payload
    readonly success?: Success
  },
) =>
  Rpc.make(tag, {
    ...options,
    error: SimulationRequestError,
  })

export const UiRpcs = RpcGroup.make(
  request("simulation.handshake", {
    payload: Handshake.Params,
    success: Handshake.Response,
  }),
  request("ui.state", { success: Frontend.State }),
  request("ui.snapshot", { success: Frontend.SemanticSnapshot }),
  request("ui.capture", { success: Frontend.CapturedFrame }),
  request("ui.matches", {
    payload: Frontend.MatchesParams,
    success: Frontend.Matches,
  }),
  request("ui.screenshot", {
    payload: Schema.UndefinedOr(Frontend.ScreenshotParams),
    success: Frontend.Screenshot,
  }),
  request("ui.recording.finish", {
    success: Frontend.RecordingFinish,
  }),
  request("ui.type", {
    payload: Frontend.TypeParams,
    success: Frontend.State,
  }),
  request("ui.press", {
    payload: Frontend.PressParams,
    success: Frontend.State,
  }),
  request("ui.enter", { success: Frontend.State }),
  request("ui.arrow", {
    payload: Frontend.ArrowParams,
    success: Frontend.State,
  }),
  request("ui.focus", {
    payload: Frontend.FocusParams,
    success: Frontend.State,
  }),
  request("ui.click", {
    payload: Frontend.ClickParams,
    success: Frontend.State,
  }),
  request("ui.resize", {
    payload: Frontend.ResizeParams,
    success: Frontend.State,
  }),
)

export const BackendRpcs = RpcGroup.make(
  request("simulation.handshake", {
    payload: Handshake.Params,
    success: Handshake.Response,
  }),
  request("llm.attach", { success: Backend.Attached }),
  request("llm.pending", { success: Backend.Pending }),
  request("llm.chunk", {
    payload: Backend.ChunkParams,
    success: Backend.Ok,
  }),
  request("llm.finish", {
    payload: Backend.FinishPayload,
    success: Backend.Ok,
  }),
  request("llm.disconnect", {
    payload: Backend.DisconnectParams,
    success: Backend.Ok,
  }),
  request("tool.attach", {
    payload: Backend.ToolAttachParams,
    success: Backend.Attached,
  }),
  request("tool.update", {
    payload: Backend.ToolUpdateParams,
    success: Backend.Ok,
  }),
  request("tool.finish", {
    payload: Backend.ToolFinishParams,
    success: Backend.Ok,
  }),
  request("tool.fail", {
    payload: Backend.ToolFailParams,
    success: Backend.Ok,
  }),
)

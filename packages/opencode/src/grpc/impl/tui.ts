import { create } from "@bufbuild/protobuf"
import { EmptySchema } from "@bufbuild/protobuf/wkt"
import { Bus } from "../../bus"
import { Session } from "../../session"
import { TuiEvent } from "@/cli/cmd/tui/event"
import {
  type AppendPromptRequest,
  type ExecuteCommandRequest,
  type SelectSessionRequest,
  type ShowToastRequest,
  type PublishRequest,
  ToastVariant_Type,
} from "../gen/opencode/v1/tui_pb"

const commandMap: Record<string, string> = {
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
}

function toToastVariant(variant: ToastVariant_Type): "info" | "success" | "warning" | "error" {
  switch (variant) {
    case ToastVariant_Type.TOAST_VARIANT_INFO:
      return "info"
    case ToastVariant_Type.TOAST_VARIANT_SUCCESS:
      return "success"
    case ToastVariant_Type.TOAST_VARIANT_WARNING:
      return "warning"
    case ToastVariant_Type.TOAST_VARIANT_ERROR:
      return "error"
    default:
      return "info"
  }
}

export const tui = {
  async appendPrompt(req: AppendPromptRequest) {
    await Bus.publish(TuiEvent.PromptAppend, { text: req.text })
    return create(EmptySchema, {})
  },

  async openHelp() {
    await Bus.publish(TuiEvent.CommandExecute, { command: "help.show" })
    return create(EmptySchema, {})
  },

  async openSessions() {
    await Bus.publish(TuiEvent.CommandExecute, { command: "session.list" })
    return create(EmptySchema, {})
  },

  async openThemes() {
    await Bus.publish(TuiEvent.CommandExecute, { command: "theme.list" })
    return create(EmptySchema, {})
  },

  async openModels() {
    await Bus.publish(TuiEvent.CommandExecute, { command: "model.list" })
    return create(EmptySchema, {})
  },

  async submitPrompt() {
    await Bus.publish(TuiEvent.CommandExecute, { command: "prompt.submit" })
    return create(EmptySchema, {})
  },

  async clearPrompt() {
    await Bus.publish(TuiEvent.CommandExecute, { command: "prompt.clear" })
    return create(EmptySchema, {})
  },

  async executeCommand(req: ExecuteCommandRequest) {
    const mappedCommand = commandMap[req.command] ?? req.command
    await Bus.publish(TuiEvent.CommandExecute, { command: mappedCommand })
    return create(EmptySchema, {})
  },

  async showToast(req: ShowToastRequest) {
    await Bus.publish(TuiEvent.ToastShow, {
      title: req.title,
      message: req.message,
      variant: toToastVariant(req.variant),
      duration: req.duration !== undefined ? Number(req.duration) : undefined,
    })
    return create(EmptySchema, {})
  },

  async selectSession(req: SelectSessionRequest) {
    await Session.get(req.sessionId)
    await Bus.publish(TuiEvent.SessionSelect, { sessionID: req.sessionId })
    return create(EmptySchema, {})
  },

  async publish(req: PublishRequest) {
    const properties = JSON.parse(new TextDecoder().decode(req.properties))
    const eventDef = Object.values(TuiEvent).find((def) => def.type === req.type)
    if (!eventDef) throw new Error(`Unknown event type: ${req.type}`)
    await Bus.publish(eventDef, properties)
    return create(EmptySchema, {})
  },
}

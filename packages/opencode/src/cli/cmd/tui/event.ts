import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import z from "zod"

export const TuiEvent = {
  PromptAppend: BusEvent.define(
    "tui.prompt.append",
    z.object({
      text: z.string(),
      parts: z.array(
        z.union([
          MessageV2.AgentPart.omit({ id: true, sessionID: true, messageID: true }),
          MessageV2.FilePart.omit({ id: true, sessionID: true, messageID: true }),
        ]),
      ),
    }),
  ),
  CommandExecute: BusEvent.define(
    "tui.command.execute",
    z.object({
      command: z.union([
        z.enum([
          "session.list",
          "session.new",
          "session.share",
          "session.interrupt",
          "session.compact",
          "session.page.up",
          "session.page.down",
          "session.line.up",
          "session.line.down",
          "session.half.page.up",
          "session.half.page.down",
          "session.first",
          "session.last",
          "prompt.clear",
          "prompt.submit",
          "agent.cycle",
        ]),
        z.string(),
      ]),
    }),
  ),
  ToastShow: BusEvent.define(
    "tui.toast.show",
    z.object({
      title: z.string().optional(),
      message: z.string(),
      variant: z.enum(["info", "success", "warning", "error"]),
      duration: z.number().default(5000).optional().describe("Duration in milliseconds"),
    }),
  ),
  SessionSelect: BusEvent.define(
    "tui.session.select",
    z.object({
      sessionID: SessionID.zod.describe("Session ID to navigate to"),
    }),
  ),
}

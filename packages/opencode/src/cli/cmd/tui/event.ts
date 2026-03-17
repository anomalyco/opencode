import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "@/session/schema"
import z from "zod"

/**
 * TUI event definitions for the terminal user interface.
 *
 * Defines events used for communication between TUI components and the bus system,
 * including prompt operations, command execution, toast notifications, and session navigation.
 *
 * @example
 * ```typescript
 * // Show a toast notification
 * Bus.emit(TuiEvent.ToastShow, { message: "Hello", variant: "info" })
 *
 * // Select a session
 * Bus.emit(TuiEvent.SessionSelect, { sessionID: "abc123" })
 * ```
 */
export const TuiEvent = {
  PromptAppend: BusEvent.define("tui.prompt.append", z.object({ text: z.string() })),
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

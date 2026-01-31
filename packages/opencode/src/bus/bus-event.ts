import z from "zod"
import type { ZodType } from "zod"
import { Log } from "../util/log"

export namespace BusEvent {
  const log = Log.create({ service: "event" })

  export type Definition = ReturnType<typeof define>

  const registry = new Map<string, Definition>()

  export function define<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
    const result = {
      type,
      properties,
    }
    registry.set(type, result)
    return result
  }

  export function payloads() {
    return z
      .discriminatedUnion(
        "type",
        registry
          .entries()
          .map(([type, def]) => {
            return z
              .object({
                type: z.literal(type),
                properties: def.properties,
              })
              .meta({
                ref: "Event" + "." + def.type,
              })
          })
          .toArray() as any,
      )
      .meta({
        ref: "Event",
      })
  }
}

// =================================================================
//                      NATIVE HOOK EVENTS
// =================================================================
/**
 * Namespaced events for the native hook system.
 * These enable external scripts to integrate with OpenCode's lifecycle
 * using Claude Code compatible naming conventions.
 * 
 * All 12 Claude Code hooks are supported:
 * - SessionStart, SessionStop (session lifecycle)
 * - PreToolUse, PostToolUse, PostToolUseFailure (tool execution)
 * - UserPromptSubmit (user input)
 * - Stop (automation loop)
 * - PermissionRequest (permission dialogs)
 * - SubagentStart, SubagentStop (subagent lifecycle)
 * - PreCompact (context compaction)
 * - Notification (notifications)
 */
export namespace HookEvent {
  // ===================== Session Lifecycle =====================
  
  /** Fired when a new session is initialized */
  export const SessionStart = BusEvent.define("hook:SessionStart", z.object({ 
    session: z.any() 
  }))

  /** Fired when a session reaches its final completed state */
  export const SessionStop = BusEvent.define("hook:SessionStop", z.object({ 
    session: z.any() 
  }))

  // ===================== Tool Execution =====================
  
  /** Fired before tool execution begins */
  export const PreToolUse = BusEvent.define("hook:PreToolUse", z.object({ 
    toolCall: z.any(), 
    sessionID: z.string() 
  }))

  /** Fired after tool execution completes successfully */
  export const PostToolUse = BusEvent.define("hook:PostToolUse", z.object({ 
    toolCall: z.any(), 
    sessionID: z.string() 
  }))

  /** Fired after tool execution fails */
  export const PostToolUseFailure = BusEvent.define("hook:PostToolUseFailure", z.object({ 
    toolCall: z.any(), 
    sessionID: z.string(),
    error: z.string().optional()
  }))

  // ===================== User Input =====================
  
  /** Fired when user submits a prompt */
  export const UserPromptSubmit = BusEvent.define("hook:UserPromptSubmit", z.object({ 
    prompt: z.string(),
    sessionID: z.string() 
  }))

  // ===================== Automation Loop =====================
  
  /** Fired when the automation loop ends */
  export const Stop = BusEvent.define("hook:Stop", z.object({ 
    sessionID: z.string(),
    reason: z.string().optional()
  }))

  // ===================== Permissions =====================
  
  /** Fired before a permission dialog appears */
  export const PermissionRequest = BusEvent.define("hook:PermissionRequest", z.object({ 
    permission: z.string(),
    sessionID: z.string(),
    metadata: z.any().optional()
  }))

  // ===================== Subagent Lifecycle =====================
  
  /** Fired when a subagent starts */
  export const SubagentStart = BusEvent.define("hook:SubagentStart", z.object({ 
    subagentID: z.string(),
    parentSessionID: z.string(),
    agentType: z.string().optional()
  }))

  /** Fired when a subagent stops */
  export const SubagentStop = BusEvent.define("hook:SubagentStop", z.object({ 
    subagentID: z.string(),
    parentSessionID: z.string(),
    agentType: z.string().optional()
  }))

  // ===================== Context Management =====================
  
  /** Fired before context compaction */
  export const PreCompact = BusEvent.define("hook:PreCompact", z.object({ 
    sessionID: z.string(),
    contextSize: z.number().optional()
  }))

  // ===================== Notifications =====================
  
  /** Fired for notifications */
  export const Notification = BusEvent.define("hook:Notification", z.object({ 
    message: z.string(),
    level: z.enum(["info", "warn", "error"]).optional(),
    sessionID: z.string().optional()
  }))
}

import z from "zod"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { DebugServer } from "../debug"
import { Permission } from "../permission"
import { Identifier } from "../id/id"
import { Bus } from "@/bus"

const log = Log.create({ service: "debug-watch" })

const DESCRIPTION = `
Collects and aggregates runtime logs from instrumented code.

Use AFTER debug_instrument. Returns an AGGREGATED SUMMARY, not raw logs.

Output format:
  === Debug Summary (487 logs over 14.2s) ===

  chat.tsx:277: 98x [A]
    - "Component RENDER"
    timestamp: 1767367474119 → 1767367488288

  chat.tsx:478: 52x [A]
    - "setMessages called"
    chunkLen: 2 → 16

This summary lets you see:
- Which code paths ran and how many times
- Value ranges for captured variables
- Timing patterns and sequences

WORKFLOW:
1. debug_instrument → get snippet, add logs
2. Tell user exact reproduction steps
3. debug_watch → wait for user, collect aggregated summary
4. Analyze summary to identify the ACTUAL issue
5. debug_cleanup → remove instrumentation

DO NOT GUESS before seeing the data. Let the summary reveal the problem.
`.trim()

export const DebugWatchTool = Tool.define("debug_watch", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      session_id: z
        .string()
        .optional()
        .describe("Debug session ID from debug_instrument. If not provided, a new session is created."),
      description: z
        .string()
        .describe("Brief description of what issue you're trying to debug (shown to user)"),
      export_to_file: z
        .boolean()
        .default(true)
        .describe("Whether to export collected logs to a file when done"),
      timeout_ms: z
        .number()
        .default(300000)
        .describe("Maximum time to wait for user in milliseconds (default: 5 minutes)"),
    }),
    async execute(params, ctx) {
      // Use provided session ID or generate a new one
      const debugSessionID = params.session_id ?? Identifier.ascending("debug")
      const isExistingSession = params.session_id != null && DebugServer.isActive(params.session_id)

      log.info("Starting debug watch session", { debugSessionID, isExistingSession, description: params.description })

      // Start the debug session if not already active
      if (!DebugServer.isActive(debugSessionID)) {
        DebugServer.startSession(debugSessionID)
      }

      // Get any logs already collected (if watching an existing session)
      const existingLogCount = DebugServer.getLogs(debugSessionID).length

      // Update metadata to show we're waiting
      ctx.metadata({
        title: isExistingSession ? `Watching session (${existingLogCount} logs already)...` : "Waiting for user to reproduce issue...",
        metadata: {
          debugSessionID,
          status: "waiting",
          logsReceived: existingLogCount,
        },
      })

      // Set up log counter for live updates
      let logCount = existingLogCount
      const unsubscribe = Bus.subscribe(DebugServer.Event.LogReceived, (event) => {
        if (event.properties.sessionID === debugSessionID) {
          logCount++
          ctx.metadata({
            title: `Collecting logs... (${logCount} received)`,
            metadata: {
              debugSessionID,
              status: "collecting",
              logsReceived: logCount,
            },
          })
        }
      })

      try {
        // Use Permission.ask to create an interactive prompt
        // This will show a UI element asking the user to reproduce the issue
        await Permission.ask({
          type: "debug_watch",
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          title: `Debug Session: ${params.description}`,
          pattern: debugSessionID,
          metadata: {
            debugSessionID,
            description: params.description,
            instructions: [
              "1. Run your application and reproduce the issue",
              "2. The instrumented code will send logs to OpenCode",
              "3. When you're done, click 'Continue' below",
            ].join("\n"),
          },
        })
      } catch (e) {
        unsubscribe()
        DebugServer.endSession(debugSessionID)
        DebugServer.clearSession(debugSessionID)
        if (e instanceof Permission.RejectedError) {
          throw new Error("Debug session was cancelled by user.")
        }
        throw e
      }

      unsubscribe()

      // Get aggregated summary BEFORE ending session
      const logsSummary = DebugServer.getLogsSummary(debugSessionID)

      // End the session and collect logs
      const logs = DebugServer.endSession(debugSessionID)

      log.info("Debug session completed", { debugSessionID, logCount: logs.length })

      // Export to file if requested (raw logs for detailed analysis)
      let logFilePath: string | undefined
      if (params.export_to_file && logs.length > 0) {
        logFilePath = await DebugServer.exportToFile(debugSessionID)
      }

      // Clean up session data
      DebugServer.clearSession(debugSessionID)

      const summary = `
Debug Session Complete
======================
Session ID: ${debugSessionID}
${logFilePath ? `Full logs exported to: ${logFilePath}` : ""}

${logsSummary}
`.trim()

      return {
        title: `Debug session complete (${logs.length} logs)`,
        metadata: {
          debugSessionID,
          logCount: logs.length,
          logFilePath,
        },
        output: summary,
      }
    },
  }
})

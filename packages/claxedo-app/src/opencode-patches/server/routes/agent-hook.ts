/**
 * Agent Hook Routes
 *
 * Receives lifecycle hook callbacks from CLI agents (Claude, Codex, etc.)
 * running in terminals and publishes events for the frontend to update
 * tab status indicators.
 */

import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Log } from "@/util/log"
import { lazy } from "@/util/lazy"
import { setupAgentHooks, getTerminalEnvVars, isSetupComplete } from "@/agent-hooks"
import z from "zod"

const log = Log.create({ service: "agent-hook" })
const DEBUG = process.env.CLAXEDO_DEBUG === "1"

/**
 * Agent lifecycle event types
 */
export const AgentEventType = z.enum(["Start", "Stop", "PermissionRequest"])
export type AgentEventType = z.infer<typeof AgentEventType>

/**
 * Agent lifecycle event payload
 */
export const AgentLifecyclePayload = z.object({
  tabId: z.string().describe("Tab ID in Claxedo UI"),
  terminalId: z.string().optional().describe("PTY terminal ID"),
  workspaceId: z.string().optional().describe("Workspace/project ID"),
  eventType: AgentEventType.describe("Lifecycle event type"),
})
export type AgentLifecyclePayload = z.infer<typeof AgentLifecyclePayload>

/**
 * Bus event definition for agent lifecycle
 */
export const AgentLifecycleEvent = BusEvent.define(
  "agent.lifecycle",
  AgentLifecyclePayload
)

export const AgentHookRoutes = lazy(() =>
  new Hono()
    // GET endpoint for curl from notify.sh (uses query params)
    .get(
      "/agent-lifecycle",
      describeRoute({
        summary: "Agent lifecycle hook callback",
        description:
          "Receives lifecycle events from CLI agents running in terminals. " +
          "Called by the notify.sh script when agents start, stop, or need permission.",
        operationId: "agentHook.lifecycle",
        responses: {
          200: {
            description: "Event received successfully",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    tabId: z.string().optional(),
                    eventType: z.string().optional(),
                  })
                ),
              },
            },
          },
          400: {
            description: "Invalid request",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    error: z.string(),
                  })
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const tabId = c.req.query("tabId")
        const terminalId = c.req.query("terminalId")
        const workspaceId = c.req.query("workspaceId")
        const eventType = c.req.query("eventType")

        if (DEBUG) {
          log.info("agent-lifecycle GET received", {
            tabId,
            terminalId,
            workspaceId,
            eventType,
            url: c.req.url,
          })
        }

        // Validate required params
        if (!tabId) {
          if (DEBUG) log.warn("Missing tabId in request")
          return c.json({ success: false, error: "Missing tabId" }, 400)
        }
        if (!eventType) {
          if (DEBUG) log.warn("Missing eventType in request")
          return c.json({ success: false, error: "Missing eventType" }, 400)
        }

        // Validate eventType
        const parsed = AgentEventType.safeParse(eventType)
        if (!parsed.success) {
          log.warn("Invalid eventType", { eventType, tabId })
          return c.json(
            { success: false, error: `Invalid eventType: ${eventType}` },
            400
          )
        }

        log.info("agent lifecycle", {
          tabId,
          terminalId,
          workspaceId,
          eventType: parsed.data,
        })

        // Publish event for frontend to consume via SSE
        // Use "global" directory so the frontend listener receives it
        const busPayload = {
          directory: "global",
          payload: {
            type: AgentLifecycleEvent.type,
            properties: {
              tabId,
              terminalId,
              workspaceId,
              eventType: parsed.data,
            },
          },
        }

        if (DEBUG) {
          log.info("Emitting to GlobalBus", busPayload)
        }

        GlobalBus.emit("event", busPayload)

        return c.json({
          success: true,
          tabId,
          eventType: parsed.data,
        })
      }
    )
    // POST endpoint for direct API calls
    .post(
      "/agent-lifecycle",
      describeRoute({
        summary: "Agent lifecycle hook callback (POST)",
        description:
          "Receives lifecycle events from CLI agents via POST with JSON body.",
        operationId: "agentHook.lifecyclePost",
        responses: {
          200: {
            description: "Event received successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
          400: {
            description: "Invalid request",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    error: z.string(),
                  })
                ),
              },
            },
          },
        },
      }),
      validator("json", AgentLifecyclePayload),
      async (c) => {
        const payload = c.req.valid("json")

        log.info("agent lifecycle (POST)", payload)

        // Publish event for frontend to consume via SSE
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: AgentLifecycleEvent.type,
            properties: payload,
          },
        })

        return c.json({ success: true })
      }
    )
    // Setup endpoint - initializes agent hooks infrastructure
    .post(
      "/setup",
      describeRoute({
        summary: "Initialize agent hooks",
        description:
          "Creates wrapper scripts and shell integration files in ~/.claxedo " +
          "for intercepting CLI agent binaries (Claude, Codex, etc.)",
        operationId: "agentHook.setup",
        responses: {
          200: {
            description: "Setup completed successfully",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    message: z.string(),
                  })
                ),
              },
            },
          },
          500: {
            description: "Setup failed",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    error: z.string(),
                  })
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          port: z.number().optional().describe("Server port for callbacks"),
          force: z.boolean().optional().describe("Force overwrite existing files"),
        })
      ),
      async (c) => {
        try {
          const body = c.req.valid("json")
          await setupAgentHooks({
            port: body.port,
            force: body.force,
          })
          return c.json({
            success: true,
            message: "Agent hooks initialized successfully",
          })
        } catch (error) {
          log.error("Setup failed", { error })
          return c.json(
            {
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            },
            500
          )
        }
      }
    )
    // Get status of agent hooks setup
    .get(
      "/setup/status",
      describeRoute({
        summary: "Get agent hooks status",
        description: "Check if agent hooks infrastructure is properly set up",
        operationId: "agentHook.setupStatus",
        responses: {
          200: {
            description: "Status retrieved",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ready: z.boolean(),
                  })
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ ready: isSetupComplete() })
      }
    )
    // Get terminal environment variables for agent hooks
    .get(
      "/terminal-env",
      describeRoute({
        summary: "Get terminal environment variables",
        description:
          "Returns environment variables to pass when creating PTY sessions " +
          "for agent hook integration",
        operationId: "agentHook.terminalEnv",
        responses: {
          200: {
            description: "Environment variables",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.string())),
              },
            },
          },
          400: {
            description: "Missing required parameters",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    error: z.string(),
                  })
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          tabId: z.string().describe("Tab ID for tracking"),
          terminalId: z.string().describe("Terminal/PTY ID"),
          workspaceId: z.string().optional().describe("Workspace ID"),
          port: z.coerce.number().describe("Server port"),
          shell: z.string().optional().describe("Shell path (e.g., /bin/zsh)"),
        })
      ),
      async (c) => {
        const query = c.req.valid("query")
        const env = getTerminalEnvVars({
          tabId: query.tabId,
          terminalId: query.terminalId,
          workspaceId: query.workspaceId || "",
          port: query.port,
          shell: query.shell,
        })
        return c.json(env)
      }
    )
)

import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { errors } from "./error"
import { CollaborationSession, Collaboration } from "@/collaboration"
import { CollaborationQueue } from "@/collaboration/queue"
import { CollaborationJoinCode } from "@/collaboration/join-code"

export const CollaborationRoute = new Hono()
  // Get collaboration state for a session
  .get(
    "/:sessionID/collaboration",
    describeRoute({
      summary: "Get collaboration state",
      description:
        "Get the collaborative session state including participants, queue, and typing statuses.",
      tags: ["Collaboration"],
      operationId: "collaboration.get",
      responses: {
        200: {
          description: "Collaboration state",
          content: {
            "application/json": {
              schema: resolver(Collaboration.SessionState),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const state = CollaborationSession.getSession(sessionID)
      return c.json(state)
    },
  )

  // Join a collaborative session
  .post(
    "/:sessionID/collaboration/join",
    describeRoute({
      summary: "Join collaborative session",
      description:
        "Join a session as a participant with a name. First participant becomes the driver.",
      tags: ["Collaboration"],
      operationId: "collaboration.join",
      responses: {
        200: {
          description: "Participant info",
          content: {
            "application/json": {
              schema: resolver(Collaboration.Participant),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "json",
      z.object({
        name: z.string().min(1).max(32),
        role: Collaboration.Role.optional(),
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const { name, role } = c.req.valid("json")
      const participant = CollaborationSession.join({ sessionID, name, role })
      return c.json(participant)
    },
  )

  // Leave a collaborative session
  .post(
    "/:sessionID/collaboration/leave",
    describeRoute({
      summary: "Leave collaborative session",
      description: "Leave the current collaborative session.",
      tags: ["Collaboration"],
      operationId: "collaboration.leave",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", z.object({ participantID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const { participantID } = c.req.valid("json")
      CollaborationSession.leave(sessionID, participantID)
      return c.json(true)
    },
  )

  // Get participants in a session
  .get(
    "/:sessionID/collaboration/participants",
    describeRoute({
      summary: "List participants",
      description: "Get all participants in a collaborative session.",
      tags: ["Collaboration"],
      operationId: "collaboration.participants",
      responses: {
        200: {
          description: "List of participants",
          content: {
            "application/json": {
              schema: resolver(Collaboration.Participant.array()),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const participants = CollaborationSession.participants(sessionID)
      return c.json(participants)
    },
  )

  // Update typing status
  .post(
    "/:sessionID/collaboration/typing",
    describeRoute({
      summary: "Update typing status",
      description: "Set typing indicator for a participant.",
      tags: ["Collaboration"],
      operationId: "collaboration.typing",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "json",
      z.object({
        participantID: z.string(),
        isTyping: z.boolean(),
        preview: z.string().optional(),
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")
      CollaborationSession.setTyping({ sessionID, ...body })
      return c.json(true)
    },
  )

  // Queue a collaborative message
  .post(
    "/:sessionID/collaboration/message",
    describeRoute({
      summary: "Queue collaborative message",
      description:
        "Add a message to the collaborative queue. Use ~directives to wait for other participants.",
      tags: ["Collaboration"],
      operationId: "collaboration.message",
      responses: {
        200: {
          description: "Queued message",
          content: {
            "application/json": {
              schema: resolver(Collaboration.QueuedMessage),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "json",
      z.object({
        participantID: z.string(),
        participantName: z.string(),
        text: z.string(),
        attachments: z.array(z.any()).optional(),
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")
      const message = CollaborationQueue.enqueue({ sessionID, ...body })
      return c.json(message)
    },
  )

  // Get the current queue
  .get(
    "/:sessionID/collaboration/queue",
    describeRoute({
      summary: "Get message queue",
      description: "Get the current message queue and pending waits.",
      tags: ["Collaboration"],
      operationId: "collaboration.queue",
      responses: {
        200: {
          description: "Queue state",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  messages: Collaboration.QueuedMessage.array(),
                  pendingWaits: Collaboration.PendingWait.array(),
                  shouldFlush: z.boolean(),
                }),
              ),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const messages = CollaborationQueue.getQueue(sessionID)
      const pendingWaits = CollaborationQueue.getPendingWaits(sessionID)
      const { flush } = CollaborationQueue.shouldFlush(sessionID)
      return c.json({
        messages,
        pendingWaits,
        shouldFlush: flush,
      })
    },
  )

  // Force flush the queue (driver only)
  .post(
    "/:sessionID/collaboration/flush",
    describeRoute({
      summary: "Force flush queue",
      description: "Force flush the message queue, bypassing pending waits. Driver only.",
      tags: ["Collaboration"],
      operationId: "collaboration.flush",
      responses: {
        200: {
          description: "Flush result",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  flushed: z.boolean(),
                  combinedMessage: z.string().optional(),
                  participants: z.array(z.string()).optional(),
                }),
              ),
            },
          },
        },
        ...errors(403),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", z.object({ participantID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const { participantID } = c.req.valid("json")

      // Get combined message before flushing
      const combined = CollaborationQueue.getCombinedMessage(sessionID)
      const flushed = CollaborationQueue.forceFlush(sessionID, participantID)

      if (flushed) {
        CollaborationQueue.clearQueue(sessionID)
        return c.json({
          flushed: true,
          combinedMessage: combined.text,
          participants: combined.participants,
        })
      }

      return c.json({ flushed: false })
    },
  )

  // Promote to driver
  .post(
    "/:sessionID/collaboration/driver",
    describeRoute({
      summary: "Change driver",
      description: "Handoff driver role to another participant. Current driver only.",
      tags: ["Collaboration"],
      operationId: "collaboration.driver",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 403),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "json",
      z.object({
        currentDriverID: z.string(),
        newDriverID: z.string(),
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const { currentDriverID, newDriverID } = c.req.valid("json")
      CollaborationSession.handoffDriver(sessionID, currentDriverID, newDriverID)
      return c.json(true)
    },
  )

  // Create join code
  .post(
    "/:sessionID/collaboration/code",
    describeRoute({
      summary: "Create join code",
      description: "Generate a shareable join code for the session.",
      tags: ["Collaboration"],
      operationId: "collaboration.code.create",
      responses: {
        200: {
          description: "Join code",
          content: {
            "application/json": {
              schema: resolver(
                Collaboration.JoinCode.extend({
                  link: z.string(),
                  formatted: z.string(),
                }),
              ),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", z.object({ participantID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const { participantID } = c.req.valid("json")
      const joinCode = CollaborationJoinCode.create({ sessionID, participantID })
      return c.json({
        ...joinCode,
        link: CollaborationJoinCode.getShareableLink(joinCode.code),
        formatted: CollaborationJoinCode.formatCode(joinCode.code),
      })
    },
  )

  // Get join code
  .get(
    "/:sessionID/collaboration/code",
    describeRoute({
      summary: "Get join code",
      description: "Get the current join code for a session.",
      tags: ["Collaboration"],
      operationId: "collaboration.code.get",
      responses: {
        200: {
          description: "Join code or null",
          content: {
            "application/json": {
              schema: resolver(
                Collaboration.JoinCode.extend({
                  link: z.string(),
                  formatted: z.string(),
                }).nullable(),
              ),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const joinCode = CollaborationJoinCode.get(sessionID)
      if (!joinCode) {
        return c.json(null)
      }
      return c.json({
        ...joinCode,
        link: CollaborationJoinCode.getShareableLink(joinCode.code),
        formatted: CollaborationJoinCode.formatCode(joinCode.code),
      })
    },
  )

  // Revoke join code
  .delete(
    "/:sessionID/collaboration/code",
    describeRoute({
      summary: "Revoke join code",
      description: "Revoke the current join code for the session.",
      tags: ["Collaboration"],
      operationId: "collaboration.code.revoke",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      CollaborationJoinCode.revoke(sessionID)
      return c.json(true)
    },
  )

  // Heartbeat for participant
  .post(
    "/:sessionID/collaboration/heartbeat",
    describeRoute({
      summary: "Participant heartbeat",
      description: "Update the last seen time for a participant.",
      tags: ["Collaboration"],
      operationId: "collaboration.heartbeat",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", z.object({ participantID: z.string() })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const { participantID } = c.req.valid("json")
      CollaborationSession.heartbeat(sessionID, participantID)
      return c.json(true)
    },
  )

// Separate route for validating join codes (not scoped to session)
export const CollaborationJoinRoute = new Hono().get(
  "/join/:code",
  describeRoute({
    summary: "Validate join code",
    description: "Validate a join code and get the session ID.",
    tags: ["Collaboration"],
    operationId: "collaboration.code.validate",
    responses: {
      200: {
        description: "Validation result",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                valid: z.boolean(),
                sessionID: z.string().optional(),
                error: z.string().optional(),
              }),
            ),
          },
        },
      },
    },
  }),
  validator("param", z.object({ code: z.string() })),
  async (c) => {
    const code = c.req.valid("param").code
    const result = CollaborationJoinCode.validate(code)
    return c.json(result)
  },
)

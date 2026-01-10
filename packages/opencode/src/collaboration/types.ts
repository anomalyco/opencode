import z from "zod"
import { Identifier } from "@/id/id"

export namespace Collaboration {
  /**
   * Participant role in a collaborative session
   * - driver: Can override waits and flush queue
   * - participant: Regular collaborator
   */
  export const Role = z.enum(["driver", "participant"])
  export type Role = z.infer<typeof Role>

  /**
   * A participant in a collaborative session
   */
  export const Participant = z
    .object({
      id: Identifier.schema("collab"),
      sessionID: Identifier.schema("session"),
      name: z.string().min(1).max(32),
      role: Role,
      color: z.string().optional(),
      time: z.object({
        joined: z.number(),
        lastSeen: z.number(),
      }),
    })
    .meta({
      ref: "CollaborationParticipant",
    })
  export type Participant = z.infer<typeof Participant>

  /**
   * Join code for a collaborative session (6-char alphanumeric)
   */
  export const JoinCode = z
    .object({
      code: z.string().length(6),
      sessionID: Identifier.schema("session"),
      createdBy: Identifier.schema("collab"),
      time: z.object({
        created: z.number(),
        expires: z.number(),
      }),
    })
    .meta({
      ref: "CollaborationJoinCode",
    })
  export type JoinCode = z.infer<typeof JoinCode>

  /**
   * Typing indicator status
   */
  export const TypingStatus = z
    .object({
      participantID: Identifier.schema("collab"),
      sessionID: Identifier.schema("session"),
      isTyping: z.boolean(),
      preview: z.string().optional(),
      time: z.number(),
    })
    .meta({
      ref: "CollaborationTypingStatus",
    })
  export type TypingStatus = z.infer<typeof TypingStatus>

  /**
   * A directive parsed from message text (~alice, ~all)
   */
  export const Directive = z
    .object({
      type: z.enum(["mention", "wait"]),
      target: z.string(),
      resolved: z.boolean().default(false),
    })
    .meta({
      ref: "CollaborationDirective",
    })
  export type Directive = z.infer<typeof Directive>

  /**
   * A queued message waiting for directive resolution
   */
  export const QueuedMessage = z
    .object({
      id: z.string(),
      sessionID: Identifier.schema("session"),
      participantID: Identifier.schema("collab"),
      participantName: z.string(),
      text: z.string(),
      directives: Directive.array(),
      time: z.object({
        queued: z.number(),
      }),
      attachments: z.array(z.any()).optional(),
    })
    .meta({
      ref: "CollaborationQueuedMessage",
    })
  export type QueuedMessage = z.infer<typeof QueuedMessage>

  /**
   * A pending wait condition
   */
  export const PendingWait = z
    .object({
      target: z.string(),
      waitingFor: z.string().array(),
      triggeredBy: z.string(),
    })
    .meta({
      ref: "CollaborationPendingWait",
    })
  export type PendingWait = z.infer<typeof PendingWait>

  /**
   * The collaborative session state (memory-only)
   */
  export const SessionState = z
    .object({
      sessionID: Identifier.schema("session"),
      participants: z.record(z.string(), Participant),
      joinCode: JoinCode.optional(),
      messageQueue: QueuedMessage.array(),
      typingStatuses: z.record(z.string(), TypingStatus),
      pendingWaits: PendingWait.array(),
    })
    .meta({
      ref: "CollaborationSessionState",
    })
  export type SessionState = z.infer<typeof SessionState>
}

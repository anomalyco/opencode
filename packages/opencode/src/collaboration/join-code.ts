import { Instance } from "@/project/instance"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { Collaboration } from "./types"
import { CollaborationSession } from "./index"

export namespace CollaborationJoinCode {
  const log = Log.create({ service: "collaboration.joincode" })

  // Default expiry: 24 hours
  const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000

  // Characters for code generation (exclude ambiguous: 0,O,1,I,L)
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  const CODE_LENGTH = 6

  // Memory-only storage for join codes (keyed by code)
  const codeState = Instance.state(
    () => new Map<string, Collaboration.JoinCode>(),
    async (codes) => codes.clear(),
  )

  /**
   * Generate a 6-character alphanumeric code
   */
  function generateCode(): string {
    let code = ""
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    }
    return code
  }

  /**
   * Create a join code for a session
   */
  export function create(input: {
    sessionID: string
    participantID: string
    expiresIn?: number
  }): Collaboration.JoinCode {
    const session = CollaborationSession.getSession(input.sessionID)

    // Return existing code if still valid
    if (session.joinCode && session.joinCode.time.expires > Date.now()) {
      return session.joinCode
    }

    // Generate unique code
    let code: string
    do {
      code = generateCode()
    } while (codeState().has(code))

    const joinCode: Collaboration.JoinCode = {
      code,
      sessionID: input.sessionID,
      createdBy: input.participantID,
      time: {
        created: Date.now(),
        expires: Date.now() + (input.expiresIn ?? DEFAULT_EXPIRY_MS),
      },
    }

    session.joinCode = joinCode
    codeState().set(code, joinCode)

    // Schedule cleanup
    const expiryMs = input.expiresIn ?? DEFAULT_EXPIRY_MS
    setTimeout(() => {
      const existingCode = codeState().get(code)
      if (existingCode && existingCode.time.expires <= Date.now()) {
        codeState().delete(code)
        const currentSession = CollaborationSession.getSession(input.sessionID)
        if (currentSession.joinCode?.code === code) {
          currentSession.joinCode = undefined
        }
        log.info("join code expired", { code, sessionID: input.sessionID })
      }
    }, expiryMs + 1000)

    Bus.publish(CollaborationSession.Event.JoinCodeCreated, {
      sessionID: input.sessionID,
      code,
    })
    log.info("join code created", { code, sessionID: input.sessionID })

    return joinCode
  }

  /**
   * Validation result
   */
  export interface ValidationResult {
    valid: boolean
    sessionID?: string
    error?: string
  }

  /**
   * Validate and get session for a join code
   */
  export function validate(code: string): ValidationResult {
    // Normalize code: uppercase, remove any non-alphanumeric
    const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "")
    const joinCode = codeState().get(normalizedCode)

    if (!joinCode) {
      return { valid: false, error: "Invalid join code" }
    }

    if (joinCode.time.expires <= Date.now()) {
      codeState().delete(normalizedCode)
      return { valid: false, error: "Join code has expired" }
    }

    return { valid: true, sessionID: joinCode.sessionID }
  }

  /**
   * Revoke a join code
   */
  export function revoke(sessionID: string): void {
    const session = CollaborationSession.getSession(sessionID)

    if (session.joinCode) {
      codeState().delete(session.joinCode.code)
      session.joinCode = undefined
      log.info("join code revoked", { sessionID })
    }
  }

  /**
   * Get the current join code for a session (if any)
   */
  export function get(sessionID: string): Collaboration.JoinCode | undefined {
    const session = CollaborationSession.getSession(sessionID)

    if (session.joinCode && session.joinCode.time.expires > Date.now()) {
      return session.joinCode
    }

    return undefined
  }

  /**
   * Generate a shareable link with the join code
   */
  export function getShareableLink(code: string, baseUrl?: string): string {
    const base = baseUrl ?? "opencode://join"
    return `${base}/${code}`
  }

  /**
   * Format code for display (with dashes for readability)
   */
  export function formatCode(code: string): string {
    if (code.length === 6) {
      return `${code.slice(0, 3)}-${code.slice(3)}`
    }
    return code
  }

  /**
   * Parse formatted code back to raw code
   */
  export function parseCode(formattedCode: string): string {
    return formattedCode.replace(/-/g, "").toUpperCase()
  }
}

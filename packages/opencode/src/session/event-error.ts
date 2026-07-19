import { Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"

/**
 * Wire-compatible error factory functions for session/message events.
 * These functions return plain objects with { name, data } structure
 * instead of NamedError instances, making them safe for wire transfer.
 */

/**
 * Creates a generic unknown error with a message.
 * @param message - Error message
 * @returns Wire-compatible error object
 */
export function unknown(message: string): Record<string, unknown> {
  return new NamedError.Unknown({ message }).toObject()
}

/**
 * Creates an agent not found error.
 * @param agent - Agent identifier
 * @param hint - Optional hint for the user
 * @returns Wire-compatible error object
 */
export function agentNotFound(agent: string, hint?: string): Record<string, unknown> {
  const message = `Agent not found: "${agent}"${hint ? `. ${hint}` : ""}`
  return new NamedError.Unknown({ message }).toObject()
}

/**
 * Creates a command not found error.
 * @param command - Command identifier
 * @param hint - Optional hint for the user
 * @returns Wire-compatible error object
 */
export function commandNotFound(command: string, hint?: string): Record<string, unknown> {
  const message = `Command not found: "${command}"${hint ? `. ${hint}` : ""}`
  return new NamedError.Unknown({ message }).toObject()
}

/**
 * Branded Types Utility
 *
 * Provides type-safe identifier branding to prevent mixing up different ID types
 * at compile time. This prevents bugs where a MessageID is accidentally passed
 * where a SessionID is expected.
 *
 * Usage:
 *   const sessionID = asSessionID("ses_abc123")
 *   const messageID = asMessageID("msg_xyz789")
 *
 *   // This would cause a TypeScript error:
 *   // someFunction(sessionID) where someFunction expects MessageID
 */

declare const __brand: unique symbol

/**
 * Generic brand type that adds a compile-time brand to a base type
 * The brand only exists at compile time and has no runtime overhead
 */
export type Brand<T, B> = T & { readonly [__brand]: B }

// Branded ID types
export type SessionID = Brand<string, "SessionID">
export type MessageID = Brand<string, "MessageID">
export type PartID = Brand<string, "PartID">
export type ProjectID = Brand<string, "ProjectID">
export type ToolCallID = Brand<string, "ToolCallID">
export type PermissionID = Brand<string, "PermissionID">
export type UserID = Brand<string, "UserID">

/**
 * Type guard functions for runtime validation and type assertion
 *
 * These functions cast a string to its branded type. They should be used
 * when you have a string ID and need to convert it to the appropriate
 * branded type. No runtime validation is performed - these are primarily
 * for compile-time type safety.
 *
 * For runtime validation with prefixes, combine with Identifier.schema()
 */

export function asSessionID(id: string): SessionID {
  return id as SessionID
}

export function asMessageID(id: string): MessageID {
  return id as MessageID
}

export function asPartID(id: string): PartID {
  return id as PartID
}

export function asProjectID(id: string): ProjectID {
  return id as ProjectID
}

export function asToolCallID(id: string): ToolCallID {
  return id as ToolCallID
}

export function asPermissionID(id: string): PermissionID {
  return id as PermissionID
}

export function asUserID(id: string): UserID {
  return id as UserID
}

/**
 * Helper to extract the underlying string from a branded type
 * This is useful when you need to pass the ID to external APIs
 * that expect a plain string
 */
export function unwrapID<T extends string>(id: T): string {
  return id
}

/**
 * Type-safe equality check for branded IDs
 * Ensures both IDs are of the same branded type
 */
export function isSameID<T extends string>(a: T, b: T): boolean {
  return a === b
}

// TODO: Gradual migration plan:
// 1. Start using branded types in new code
// 2. Update core interfaces (Session.Info, MessageV2.Info, etc.) to use branded types
// 3. Add branded type support to Identifier.ascending/descending return types
// 4. Gradually update existing usages as they are touched
// 5. Consider adding Zod schemas that parse to branded types

export * as ServerIdentity from "./server-identity.js"

import { Schema } from "effect"

import { ServerIdentity } from "@opencode/schema/server-identity"

export const Method = ServerIdentity.Method
export type Method = ServerIdentity.Method

export const SessionMethod = ServerIdentity.SessionMethod
export type SessionMethod = ServerIdentity.SessionMethod

export const UserStatus = ServerIdentity.UserStatus
export type UserStatus = ServerIdentity.UserStatus

export const UserID = ServerIdentity.UserID
export type UserID = ServerIdentity.UserID

export const SessionID = ServerIdentity.SessionID
export type SessionID = ServerIdentity.SessionID

/**
 * Server access authentication. `local` replaces the shared password with identities stored in this server's
 * database: access then requires a signed-in user (or a pairing link), and the password no longer grants any
 * request beyond issuing pairing links itself.
 */
export const Options = Schema.Struct({
  local: Schema.optional(Schema.Literal(true)),
})
export type Options = typeof Options.Type

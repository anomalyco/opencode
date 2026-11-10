export * as ServerIdentity from "./server-identity.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

/** Authentication methods that create a server identity. */
export const Method = Schema.Literals(["password", "ldap"]).annotate({ identifier: "ServerIdentity.Method" })
export type Method = typeof Method.Type

/** Ways a server session was issued. */
export const SessionMethod = Schema.Literals(["password", "ldap", "pairing"]).annotate({
  identifier: "ServerIdentity.SessionMethod",
})
export type SessionMethod = typeof SessionMethod.Type

export const UserStatus = Schema.Literals(["active", "disabled"]).annotate({
  identifier: "ServerIdentity.UserStatus",
})
export type UserStatus = typeof UserStatus.Type

export const UserID = Schema.String.pipe(
  Schema.brand("ServerIdentity.UserID"),
  Schema.annotate({ identifier: "ServerIdentity.UserID" }),
  statics((schema) => ({ create: () => schema.make("usr_" + ascending()) })),
)
export type UserID = typeof UserID.Type

export const SessionID = Schema.String.pipe(
  Schema.brand("ServerIdentity.SessionID"),
  Schema.annotate({ identifier: "ServerIdentity.SessionID" }),
  statics((schema) => ({ create: () => schema.make("sess_" + ascending()) })),
)
export type SessionID = typeof SessionID.Type

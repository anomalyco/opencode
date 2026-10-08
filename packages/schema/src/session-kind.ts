export * as SessionKind from "./session-kind.js"

import { Schema } from "effect"

/** A role fixed when the Session is created. Absent means an ordinary Session. */
export const Kind = Schema.Literals(["companion"]).annotate({ identifier: "Session.Kind" })
export type Kind = typeof Kind.Type

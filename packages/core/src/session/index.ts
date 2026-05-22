export * as Session from "."

import { Effect, Schema } from "effect"
import { AbsolutePath, RelativePath, withStatics } from "../schema"
import { Identifier } from "../util/identifier"
import { Project } from "../project"
import { Workspace } from "../workspace"
import type { ModelV2 } from "../model"
import { Location } from "../location"
import type { SessionMessage } from "./message"
import type { Prompt } from "./prompt"
import type { EventV2 } from "../event"

export const Delivery = Schema.Literals(["immediate", "deferred"]).annotate({
  identifier: "Session.Delivery",
})
export type Delivery = Schema.Schema.Type<typeof Delivery>

export const ID = Schema.String.check(Schema.isStartsWith("ses")).pipe(
  Schema.brand("SessionID"),
  withStatics((schema) => ({
    descending: (id?: string) => schema.make(id ?? "ses_" + Identifier.descending()),
  })),
)
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: ID,
  location: Location.Ref,
  subpath: RelativePath, // derived from location
  project: Project.ID, // derived from location
})
export type Info = typeof Info.Type

// get project -> project.locations
//
// get all sessions
//

// - by project
//   - by subpath
// - by workspace (home is special)

type Cursor = {}

type ListInput = {
  workspaceID?: Workspace.ID
  search?: string
  cursor?: Cursor
  limit?: number
  order?: "asc" | "desc"
} & (
  | {
      project: Project.ID
      subpath?: RelativePath
    }
  | {
      directory?: AbsolutePath
    }
)

type CreateInput = {
  id?: ID
  agent?: string
  model?: ModelV2.Ref
  location: Location.Ref
}

type MoveInput = {
  sessionID: ID
  location: Location.Ref
}

type CompactInput = {
  sessionID: ID
  prompt?: Prompt
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: ID,
}) {}

export type Error = NotFoundError

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<Info[]>
  readonly create: (input?: CreateInput) => Effect.Effect<Info>
  readonly move: (input: MoveInput) => Effect.Effect<void, NotFoundError>
  readonly get: (sessionID: ID) => Effect.Effect<Info, NotFoundError>
  readonly messages: (input: {
    sessionID: ID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      time: number
      direction: "previous" | "next"
    }
  }) => Effect.Effect<SessionMessage.Message[], NotFoundError>
  readonly context: (sessionID: ID) => Effect.Effect<SessionMessage.Message[], NotFoundError>
  readonly switchAgent: (input: { sessionID: ID; agent: string }) => Effect.Effect<void, never>
  readonly switchModel: (input: { sessionID: ID; model: ModelV2.Ref }) => Effect.Effect<void, never>
  readonly prompt: (input: {
    id?: EventV2.ID
    sessionID: ID
    prompt: Prompt
    delivery?: Delivery
    resume?: boolean
  }) => Effect.Effect<void, NotFoundError>
  readonly shell: (input: {
    id?: EventV2.ID
    sessionID: ID
    command: string
    delivery?: Delivery
    resume?: boolean
  }) => Effect.Effect<void, never>
  readonly skill: (input: {
    id?: EventV2.ID
    sessionID: ID
    skill: string
    delivery?: Delivery
    resume?: boolean
  }) => Effect.Effect<void, never>
  readonly compact: (input: CompactInput) => Effect.Effect<void, NotFoundError>
  readonly wait: (id: ID) => Effect.Effect<void, NotFoundError>
  readonly resume: (sessionID: ID) => Effect.Effect<void>
}

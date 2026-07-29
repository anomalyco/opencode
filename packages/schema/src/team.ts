export * as Team from "./team"

import { Schema } from "effect"
import { Agent } from "./agent"
import { descending } from "./identifier"
import { Model } from "./model"
import { DateTimeUtcFromMillis, optional, statics } from "./schema"
import { Session } from "./session"

const identifier = <Prefix extends string>(prefix: Prefix, brand: string) =>
  Schema.String.check(Schema.isStartsWith(prefix)).pipe(
    Schema.brand(brand),
    statics((schema) => ({ create: () => schema.make(prefix + descending()) })),
  )

export const ID = identifier("team_", "TeamID")
export type ID = typeof ID.Type

export const MessageID = identifier("teammsg_", "TeamMessageID")
export type MessageID = typeof MessageID.Type

export const TaskID = identifier("teamtask_", "TeamTaskID")
export type TaskID = typeof TaskID.Type

export const Status = Schema.Literals(["active", "paused", "completed", "error"])
export type Status = typeof Status.Type

export const MemberStatus = Schema.Literals([
  "starting",
  "busy",
  "idle",
  "waiting",
  "error",
  "stopped",
  "interrupted",
])
export type MemberStatus = typeof MemberStatus.Type

export const PermissionProfile = Schema.Literals(["lead", "writer", "reviewer"])
export type PermissionProfile = typeof PermissionProfile.Type

export interface Member extends Schema.Schema.Type<typeof Member> {}
export const Member = Schema.Struct({
  name: Schema.String,
  sessionID: Session.ID,
  agent: Agent.ID,
  model: Model.Ref,
  role: Schema.Literals(["lead", "teammate"]),
  permission: PermissionProfile,
  status: MemberStatus,
  currentTaskID: TaskID.pipe(optional),
  error: Schema.String.pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
  }),
}).annotate({ identifier: "Team.Member" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  leadSessionID: Session.ID,
  status: Status,
  members: Schema.Array(Member),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
  }),
}).annotate({ identifier: "Team.Info" })

export interface Message extends Schema.Schema.Type<typeof Message> {}
export const Message = Schema.Struct({
  id: MessageID,
  teamID: ID,
  from: Schema.String,
  to: Schema.String,
  text: Schema.String,
  delivered: Schema.Boolean,
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    delivered: DateTimeUtcFromMillis.pipe(optional),
  }),
}).annotate({ identifier: "Team.Message" })

export const TaskStatus = Schema.Literals(["pending", "blocked", "in_progress", "completed", "cancelled"])
export type TaskStatus = typeof TaskStatus.Type

export interface Task extends Schema.Schema.Type<typeof Task> {}
export const Task = Schema.Struct({
  id: TaskID,
  teamID: ID,
  title: Schema.String,
  description: Schema.String,
  status: TaskStatus,
  assignee: Schema.String.pipe(optional),
  dependencies: Schema.Array(TaskID),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
  }),
}).annotate({ identifier: "Team.Task" })

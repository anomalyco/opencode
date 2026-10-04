import type { OpenCodeClient, OpenCodeEvent, SessionActiveOutput, SessionInfo } from "../src/promise/index.js"
import type { createData } from "../src/solid/data.js"
import type { ProjectID } from "@opencode/schema/project-id"
import type { Effect } from "effect"
import type { Session, SessionMessage, SessionApi } from "../src/effect/index.js"

type Assert<T extends true> = T
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type GetInput = Parameters<SessionApi["get"]>[0]
type RevertInput = Parameters<SessionApi["revert"]["stage"]>[0]
type GetOutput = Effect.Success<ReturnType<SessionApi["get"]>>

// Compile against the public client and the generated API. A lost brand must fail
// package typecheck even though branded strings serialize identically over HTTP.
export type SessionInput = Assert<Equal<GetInput["sessionID"], Session.ID>>
export type SessionOutput = Assert<Equal<GetOutput["id"], Session.ID>>
export type MessageInput = Assert<Equal<RevertInput["messageID"], SessionMessage.ID>>
export type RejectMessageAsSession = Assert<SessionMessage.ID extends GetInput["sessionID"] ? false : true>
export type RejectSessionAsMessage = Assert<Session.ID extends RevertInput["messageID"] ? false : true>
export type RejectPlainSession = Assert<string extends GetInput["sessionID"] ? false : true>
export type RejectPlainMessage = Assert<string extends RevertInput["messageID"] ? false : true>

type PromiseGetInput = Parameters<OpenCodeClient["session"]["get"]>[0]
type PromiseRevertInput = Parameters<OpenCodeClient["session"]["revert"]["stage"]>[0]
type PromiseGetOutput = Awaited<ReturnType<OpenCodeClient["session"]["get"]>>
type Created = Extract<OpenCodeEvent, { type: "session.created" }>
type Data = ReturnType<typeof createData>
export type PromiseSessionInput = Assert<Equal<PromiseGetInput["sessionID"], Session.ID>>
export type PromiseSessionOutput = Assert<Equal<PromiseGetOutput["id"], Session.ID>>
export type PromiseMessageInput = Assert<Equal<PromiseRevertInput["messageID"], SessionMessage.ID>>
export type PromiseRejectMessage = Assert<SessionMessage.ID extends PromiseGetInput["sessionID"] ? false : true>
export type PromiseRejectSession = Assert<Session.ID extends PromiseRevertInput["messageID"] ? false : true>
export type PromiseRejectPlainString = Assert<string extends PromiseGetInput["sessionID"] ? false : true>
export type PromiseNestedEvent = Assert<Equal<Created["data"]["sessionID"], Session.ID>>
export type PromiseNestedProject = Assert<Equal<Created["data"]["projectID"], ProjectID>>
export type PromiseDateRemainsWire = Assert<Equal<SessionInfo["time"]["created"], number>>
export type ActiveMapKeys = Assert<Equal<keyof SessionActiveOutput, Session.ID>>
export type ActiveMapRejectMessage = Assert<SessionMessage.ID extends keyof SessionActiveOutput ? false : true>
export type DataSessionInput = Assert<Equal<Parameters<Data["session"]["get"]>[0], Session.ID>>
export type DataInboxInput = Assert<Equal<Parameters<Data["session"]["input"]["has"]>[1], SessionMessage.ID>>
export type DataRejectWrongInbox = Assert<Session.ID extends Parameters<Data["session"]["input"]["has"]>[1] ? false : true>

import { Effect } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import { makeRuntime } from "@/effect/run-service"
import { Instance } from "@/project/instance"
import { Session } from "./session"
import { SessionID } from "./schema"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

const runtime = makeRuntime(Session.Service, Session.defaultLayer)

function withInstance<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const ctx = Instance.current()
  return ctx ? effect.pipe(Effect.provideService(InstanceRef, ctx)) : effect
}

function run<A, E>(fn: (session: Session.Interface) => Effect.Effect<A, E, Session.Service>) {
  return runtime.runPromise((session) => withInstance(fn(session)))
}

export const create = (input?: Parameters<Session.Interface["create"]>[0]) => run((session) => session.create(input))

export const createNext = (input: Parameters<Session.Interface["createNext"]>[0]) =>
  run((session) => session.createNext(input))

export const get = (sessionID: string) => run((session) => session.get(SessionID.make(sessionID)))

export const messages = (input: { sessionID: string; limit?: number }) =>
  run((session) => session.messages({ ...input, sessionID: SessionID.make(input.sessionID) }))

export const remove = (sessionID: string) => run((session) => session.remove(SessionID.make(sessionID)))

export const update = async (sessionID: string, fn: (draft: Session.Info) => void) => {
  const draft = structuredClone(await get(sessionID))
  fn(draft)
  if (draft.permission !== undefined) {
    await run((session) =>
      session.setPermission({
        sessionID: SessionID.make(sessionID),
        permission: draft.permission ?? [],
      }),
    )
  }
  return draft
}

export const updateMessage = <T extends SessionV1.Info>(message: T) =>
  run((session) => session.updateMessage(message))

export const updatePart = <T extends SessionV1.Part>(part: T) => run((session) => session.updatePart(part))

export { Session }

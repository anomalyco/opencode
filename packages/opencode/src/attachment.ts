import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import { Context, Effect, Layer } from "effect"
import { randomUUID } from "crypto"

export const MAX_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024
export const TEXT_ATTACHMENT_TTL_MS = 15 * 60 * 1000

type Item = {
  sessionID: SessionID
  filename: string
  content: string
  expiresAt: number
}

export type UploadInput = {
  sessionID: SessionID
  filename: string
  content: string
}

export type StoredAttachment = Pick<Item, "filename" | "content">

export type Interface = {
  upload(input: UploadInput): Effect.Effect<{ id: string; url: string }, Error>
  consume(input: { sessionID: SessionID; id: string }): Effect.Effect<StoredAttachment | undefined>
  remove(input: { sessionID: SessionID; id: string }): Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/RemoteAttachment") {}

export function createStore(now = () => Date.now()) {
  const items = new Map<string, Item>()
  const cleanup = () => {
    const time = now()
    for (const [id, item] of items) {
      if (item.expiresAt <= time) items.delete(id)
    }
  }

  return {
    upload(input: UploadInput) {
      if (Buffer.byteLength(input.content, "utf8") > MAX_TEXT_ATTACHMENT_BYTES) {
        throw new Error(`Text attachment exceeds the ${MAX_TEXT_ATTACHMENT_BYTES} byte upload limit`)
      }
      cleanup()
      const id = `attachment_${randomUUID()}`
      items.set(id, {
        sessionID: input.sessionID,
        filename: input.filename,
        content: input.content,
        expiresAt: now() + TEXT_ATTACHMENT_TTL_MS,
      })
      return { id, url: `attachment://${id}` }
    },
    consume(input: { sessionID: SessionID; id: string }) {
      cleanup()
      const item = items.get(input.id)
      if (!item || item.sessionID !== input.sessionID) return
      items.delete(input.id)
      return { filename: item.filename, content: item.content }
    },
    remove(input: { sessionID: SessionID; id: string }) {
      cleanup()
      if (items.get(input.id)?.sessionID === input.sessionID) items.delete(input.id)
    },
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(Effect.fn("RemoteAttachment.state")(() => Effect.sync(() => createStore())))

    const store = Effect.fn("RemoteAttachment.store")(function* () {
      return yield* InstanceState.get(state)
    })

    return Service.of({
      upload: (input) =>
        store().pipe(
          Effect.flatMap((value) =>
            Effect.try({
              try: () => value.upload(input),
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            }),
          ),
        ),
      consume: (input) => store().pipe(Effect.map((value) => value.consume(input))),
      remove: (input) =>
        store().pipe(
          Effect.tap((value) => Effect.sync(() => value.remove(input))),
          Effect.asVoid,
        ),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as RemoteAttachment from "./attachment"

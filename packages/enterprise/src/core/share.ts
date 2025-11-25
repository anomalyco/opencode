import { FileDiff, Message, Model, Part, Session, SessionStatus } from "@opencode-ai/sdk"
import { fn } from "@opencode-ai/util/fn"
import { iife } from "@opencode-ai/util/iife"
import z from "zod"
import { Storage } from "./storage"

export namespace Share {
  export const Info = z.object({
    id: z.string(),
    secret: z.string(),
    sessionID: z.string(),
  })
  export type Info = z.infer<typeof Info>

  export const Data = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("session"),
      data: z.custom<Session>(),
    }),
    z.object({
      type: z.literal("message"),
      data: z.custom<Message>(),
    }),
    z.object({
      type: z.literal("part"),
      data: z.custom<Part>(),
    }),
    z.object({
      type: z.literal("session_diff"),
      data: z.custom<FileDiff[]>(),
    }),
    z.object({
      type: z.literal("model"),
      data: z.custom<Model[]>(),
    }),
  ])
  export type Data = z.infer<typeof Data>

  export const create = fn(z.object({ sessionID: z.string() }), async (body) => {
    const info: Info = {
      id: body.sessionID.slice(-8),
      sessionID: body.sessionID,
      secret: crypto.randomUUID(),
    }
    const exists = await get(info.id)
    if (exists) throw new Errors.AlreadyExists(info.id)
    await Storage.write(["share", info.id], info)
    console.log("created share", info.id)
    return info
  })

  export async function get(id: string) {
    return Storage.read<Info>(["share", id])
  }

  export const remove = fn(Info.pick({ id: true, secret: true }), async (body) => {
    const share = await get(body.id)
    if (!share) throw new Errors.NotFound(body.id)
    if (share.secret !== body.secret) throw new Errors.InvalidSecret(body.id)
    await Storage.remove(["share", body.id])
    const list = await Storage.list(["share_data", body.id])
    for (const item of list) {
      await Storage.remove(item)
    }
  })

  export async function data(id: string) {
    const list = await Storage.list(["share_data", id])
    const promises = []
    for (const item of list) {
      promises.push(
        iife(async () => {
          const [, , type] = item
          return {
            type: type as any,
            data: await Storage.read<any>(item),
          } as Data
        }),
      )
    }
    return await Promise.all(promises)
  }

  export const sync = fn(
    z.object({
      share: Info.pick({ id: true, secret: true }),
      data: Data.array(),
    }),
    async (input) => {
      const share = await get(input.share.id)
      if (!share) throw new Errors.NotFound(input.share.id)
      if (share.secret !== input.share.secret) throw new Errors.InvalidSecret(input.share.id)
      const promises = []
      for (const item of input.data) {
        promises.push(
          iife(async () => {
            switch (item.type) {
              case "session":
                await Storage.write(["share_data", input.share.id, "session"], item.data)
                break
              case "message":
                await Storage.write(["share_data", input.share.id, "message", item.data.id], item.data)
                break
              case "part":
                await Storage.write(
                  ["share_data", input.share.id, "part", item.data.messageID, item.data.id],
                  item.data,
                )
                break
              case "session_diff":
                await Storage.write(["share_data", input.share.id, "session_diff"], item.data)
                break
              case "model":
                await Storage.write(["share_data", input.share.id, "model"], item.data)
                break
            }
          }),
        )
      }
      await Promise.all(promises)
    },
  )

  export const Errors = {
    NotFound: class extends Error {
      constructor(public id: string) {
        super(`Share not found: ${id}`)
      }
    },
    InvalidSecret: class extends Error {
      constructor(public id: string) {
        super(`Share secret invalid: ${id}`)
      }
    },
    AlreadyExists: class extends Error {
      constructor(public id: string) {
        super(`Share already exists: ${id}`)
      }
    },
  }
}

import { FileDiff, Message, Model, Part, Session } from "@opencode-ai/sdk/v2"
import { fn } from "@opencode-ai/util/fn"
import { iife } from "@opencode-ai/util/iife"
import { Identifier } from "@opencode-ai/util/identifier"
import z from "zod"
import { Storage } from "./storage"
import { Binary } from "@opencode-ai/util/binary"

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
    const isTest = process.env.NODE_ENV === "test" || body.sessionID.startsWith("test_")
    const info: Info = {
      id: (isTest ? "test_" : "") + body.sessionID.slice(-8),
      sessionID: body.sessionID,
      secret: crypto.randomUUID(),
    }
    const exists = await get(info.id)
    if (exists) throw new Errors.AlreadyExists(info.id)
    await Storage.write(["share", info.id], info)
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
    const list = await Storage.list({ prefix: ["share_data", body.id] })
    for (const item of list) {
      await Storage.remove(item)
    }
  })

  export const sync = fn(
    z.object({
      share: Info.pick({ id: true, secret: true }),
      data: Data.array(),
    }),
    async (input) => {
      const share = await get(input.share.id)
      if (!share) throw new Errors.NotFound(input.share.id)
      if (share.secret !== input.share.secret) throw new Errors.InvalidSecret(input.share.id)
      await Storage.write(["share_event", input.share.id, Identifier.descending()], input.data)
    },
  )

  type Compaction = {
    event?: string
    data: Data[]
  }

  export async function data(shareID: string) {
    console.log("reading compaction")
    const compaction: Compaction = (await Storage.read<Compaction>(["share_compaction", shareID])) ?? {
      data: [],
      event: undefined,
    }
    console.log("reading pending events")
    const list = await Storage.list({
      prefix: ["share_event", shareID],
      before: compaction.event,
    }).then((x) => x.toReversed())

    console.log("compacting", list.length)

    if (list.length > 0) {
      const data = await Promise.all(list.map(async (event) => await Storage.read<Data[]>(event))).then((x) => x.flat())
      for (const item of data) {
        if (!item) continue
        const key = (item: Data) => {
          switch (item.type) {
            case "session":
              return "session"
            case "message":
              return `message/${item.data.id}`
            case "part":
              return `${item.data.messageID}/${item.data.id}`
            case "session_diff":
              return "session_diff"
            case "model":
              return "model"
          }
        }
        const id = key(item)
        const result = Binary.search(compaction.data, id, key)
        if (result.found) {
          compaction.data[result.index] = item
        } else {
          compaction.data.splice(result.index, 0, item)
        }
      }
      compaction.event = list.at(-1)?.at(-1)
      await Storage.write(["share_compaction", shareID], compaction)
    }
    return compaction.data
  }

  export const syncOld = fn(
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
              case "message": {
                const data = item.data as Message
                await Storage.write(["share_data", input.share.id, "message", data.id], item.data)
                break
              }
              case "part": {
                const data = item.data as Part
                await Storage.write(["share_data", input.share.id, "part", data.messageID, data.id], item.data)
                break
              }
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

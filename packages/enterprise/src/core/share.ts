import { Message, Model, Part, Session, SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import { createHash, timingSafeEqual } from "node:crypto"
import z from "zod"
import { Storage } from "./storage"

function fn<T extends z.ZodType, Result>(schema: T, cb: (input: z.infer<T>) => Result) {
  return (input: z.infer<T>) => cb(schema.parse(input))
}

function secretMatches(expected: string, actual: string) {
  const a = createHash("sha256").update(expected).digest()
  const b = createHash("sha256").update(actual).digest()
  return timingSafeEqual(a, b)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasString = (value: unknown, key: string) => isObject(value) && typeof value[key] === "string"

export namespace Share {
  export const MAX_SYNC_ITEMS = 2_000
  // A share's snapshot is re-uploaded in full on every sync and served whole by
  // `GET .../data`, so a single element, the item count and the serialized total all
  // need explicit bounds (O2-25 / DRIFT-5 / D2-03).
  export const MAX_ELEMENT_BYTES = 4 * 1024 * 1024
  export const MAX_SNAPSHOT_ITEMS = 20_000
  export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
  export const ShareID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
  export const SessionID = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)

  function elementBytes(value: unknown) {
    try {
      return Buffer.byteLength(JSON.stringify(value ?? null), "utf8")
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  function withinElementBudget(value: unknown) {
    return elementBytes(value) <= MAX_ELEMENT_BYTES
  }

  export const Info = z.object({
    id: ShareID,
    secret: z.string(),
    sessionID: SessionID,
  })
  export type Info = z.infer<typeof Info>

  export const Data = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("session"),
      data: z.custom<Session>((value) => hasString(value, "id") && withinElementBudget(value)),
    }),
    z.object({
      type: z.literal("message"),
      data: z.custom<Message>(
        (value) => hasString(value, "id") && hasString(value, "sessionID") && withinElementBudget(value),
      ),
    }),
    z.object({
      type: z.literal("part"),
      data: z.custom<Part>(
        (value) =>
          hasString(value, "id") &&
          hasString(value, "messageID") &&
          hasString(value, "type") &&
          withinElementBudget(value),
      ),
    }),
    z.object({
      type: z.literal("session_diff"),
      data: z.custom<SnapshotFileDiff[]>(
        (value) =>
          Array.isArray(value) && value.length <= MAX_SYNC_ITEMS && value.every(isObject) && withinElementBudget(value),
      ),
    }),
    z.object({
      type: z.literal("model"),
      data: z.custom<Model[]>(
        (value) =>
          Array.isArray(value) && value.length <= MAX_SYNC_ITEMS && value.every(isObject) && withinElementBudget(value),
      ),
    }),
  ])
  export type Data = z.infer<typeof Data>

  type Snapshot = {
    data: Data[]
  }

  type Compaction = {
    event?: string
    data: Data[]
  }

  function key(item: Data) {
    switch (item.type) {
      case "session":
        return "session"
      case "message":
        return `message/${item.data.id}`
      case "part":
        return `part/${item.data.messageID}/${item.data.id}`
      case "session_diff":
        return "session_diff"
      case "model":
        return "model"
    }
  }

  function merge(...items: Data[][]) {
    const map = new Map<string, Data>()
    for (const list of items) {
      for (const item of list) {
        map.set(key(item), item)
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, item]) => item)
  }

  function boundSnapshot(data: Data[]) {
    const sized = data.map((item) => ({ item, bytes: elementBytes(item) }))
    const total = sized.reduce((sum, entry) => sum + entry.bytes, 0)
    if (data.length <= MAX_SNAPSHOT_ITEMS && total <= MAX_SNAPSHOT_BYTES) return data
    // `data` is sorted by key and ids are time-sortable, so the earliest entries are the
    // oldest. Evict parts, then messages; never the singleton rows the page needs.
    const evict = new Set<string>()
    let remaining = total
    for (const type of ["part", "message"] as const) {
      for (const entry of sized) {
        if (entry.item.type !== type) continue
        if (data.length - evict.size <= MAX_SNAPSHOT_ITEMS && remaining <= MAX_SNAPSHOT_BYTES) break
        evict.add(key(entry.item))
        remaining -= entry.bytes
      }
    }
    return evict.size === 0 ? data : data.filter((item) => !evict.has(key(item)))
  }

  const locks = new Map<string, Promise<void>>()

  // Both create and sync read-modify-write the same snapshot; serialize per share so
  // concurrent requests cannot overwrite each other's merge.
  function serialize<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve()
    const run = previous.then(work, work)
    const tail = run.then(
      () => {},
      () => {},
    )
    locks.set(id, tail)
    tail.then(() => {
      if (locks.get(id) === tail) locks.delete(id)
    })
    return run
  }

  async function readSnapshot(shareID: string) {
    const data = (await Storage.read<Snapshot>(["share_snapshot", shareID]))?.data
    return data ? boundSnapshot(data) : data
  }

  async function writeSnapshot(shareID: string, data: Data[]) {
    await Storage.write<Snapshot>(["share_snapshot", shareID], { data: boundSnapshot(data) })
  }

  async function legacy(shareID: string) {
    const compaction: Compaction = (await Storage.read<Compaction>(["share_compaction", shareID])) ?? {
      data: [],
      event: undefined,
    }
    const list = await Storage.list({
      prefix: ["share_event", shareID],
      before: compaction.event,
    }).then((x) => x.toReversed())
    if (list.length === 0) {
      if (compaction.data.length > 0) await writeSnapshot(shareID, compaction.data)
      return boundSnapshot(compaction.data)
    }

    const next = boundSnapshot(
      merge(
        compaction.data,
        await Promise.all(list.map(async (event) => await Storage.read<Data[]>(event))).then((x) =>
          x.flatMap((item) => item ?? []),
        ),
      ),
    )

    await Promise.all([
      Storage.write(["share_compaction", shareID], {
        event: list.at(-1)?.at(-1),
        data: next,
      }),
      writeSnapshot(shareID, next),
    ])
    return next
  }

  const ID_ATTEMPTS = 5

  export const create = fn(z.object({ sessionID: SessionID }), async (body) => {
    const isTest = process.env.NODE_ENV === "test" || body.sessionID.startsWith("test_")
    // The id is the only handle needed to read a share, so it must not be derivable from
    // a non-secret input such as the session id (O2-45). Mint a random id and retry the
    // astronomically unlikely collision instead of failing the caller.
    for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
      const info: Info = {
        id: (isTest ? "test_" : "") + crypto.randomUUID().replace(/-/g, ""),
        sessionID: body.sessionID,
        secret: crypto.randomUUID(),
      }
      const created = await serialize(info.id, async () => {
        if (await get(info.id)) return undefined
        await Promise.all([Storage.write(["share", info.id], info), writeSnapshot(info.id, [])])
        return info
      })
      if (created) return created
    }
    throw new Errors.AlreadyExists(body.sessionID)
  })

  export async function get(id: string) {
    return Storage.read<Info>(["share", id])
  }

  export const remove = fn(Info.pick({ id: true, secret: true }), async (body) => {
    return serialize(body.id, async () => {
      const share = await get(body.id)
      if (!share) throw new Errors.NotFound(body.id)
      if (!secretMatches(share.secret, body.secret)) throw new Errors.InvalidSecret(body.id)
      // `share_snapshot`/`share_compaction` are scalar keys (`<id>.json`); the prefix
      // lists below only match the nested `share_event`/`share_data` keys, so without
      // these explicit removes a "deleted" share stayed world-readable (O2-03).
      await Promise.all([
        Storage.remove(["share", body.id]),
        Storage.remove(["share_snapshot", body.id]),
        Storage.remove(["share_compaction", body.id]),
      ])
      const groups = await Promise.all([
        Storage.list({ prefix: ["share_snapshot", body.id] }),
        Storage.list({ prefix: ["share_compaction", body.id] }),
        Storage.list({ prefix: ["share_event", body.id] }),
        Storage.list({ prefix: ["share_data", body.id] }),
      ])
      for (const item of groups.flat()) {
        await Storage.remove(item)
      }
    })
  })

  export const removeAdmin = fn(Info.pick({ id: true }), async (body) => {
    const share = await get(body.id)
    if (!share) throw new Errors.NotFound(body.id)
    await remove({ id: share.id, secret: share.secret })
  })

  export const sync = fn(
    z.object({
      share: Info.pick({ id: true, secret: true }),
      data: Data.array().max(MAX_SYNC_ITEMS),
    }),
    async (input) => {
      const share = await get(input.share.id)
      if (!share) throw new Errors.NotFound(input.share.id)
      if (!secretMatches(share.secret, input.share.secret)) throw new Errors.InvalidSecret(input.share.id)
      await serialize(input.share.id, async () => {
        // Re-check under the lock: the share may have been removed after the check
        // above but before this work ran, and writing a snapshot for a deleted share
        // would resurrect it (O2-47).
        if (!(await get(input.share.id))) throw new Errors.NotFound(input.share.id)
        const data = (await readSnapshot(input.share.id)) ?? (await legacy(input.share.id))
        await writeSnapshot(input.share.id, merge(data, input.data))
      })
    },
  )

  export async function data(shareID: string) {
    // Never serve a snapshot whose share row is gone; a partially failed delete or an
    // interleaved write must not leave the transcript reachable (O2-03).
    if (!(await get(shareID))) return []
    return (await readSnapshot(shareID)) ?? legacy(shareID)
  }

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

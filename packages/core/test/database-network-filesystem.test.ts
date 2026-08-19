import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { isNetworkFilesystemType } from "@opencode-ai/core/database/network-filesystem"
import { Global } from "@opencode-ai/util/global"
import { sql } from "drizzle-orm"
import { Effect } from "effect"

test.each([
  ["SMB", 0x0000517b],
  ["9P", 0x01021997],
  ["FUSE", 0x65735546],
  ["NFS", 0x00006969],
  ["CIFS", 0xff534d42],
])("disables WAL on %s", (_name, type) => {
  expect(isNetworkFilesystemType(type)).toBe(true)
})

test("keeps WAL on local filesystems", () => {
  expect(isNetworkFilesystemType(0xef53)).toBe(false)
})

test("allows WAL to be disabled explicitly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-database-"))
  try {
    const mode = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        return yield* database.db.all<{ journal_mode: string }>(sql`PRAGMA journal_mode`)
      }).pipe(
        Effect.provide(Database.layer({ path: join(directory, "opencode.db"), wal: false })),
        Effect.provideService(Global.Service, Global.make({ data: directory })),
        Effect.scoped,
      ),
    )
    expect(mode).toEqual([{ journal_mode: "delete" }])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

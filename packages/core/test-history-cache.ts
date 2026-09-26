/**
 * L1 history cache 正确性微测（真实会话 DB 副本）
 * 1. 首次全量加载 → 缓存建立
 * 2. 无新行再读 → 命中缓存，结果一致
 * 3. 追加 user 行（模拟 projector INSERT）→ 增量合并 == 无缓存全量真值
 * 4. 重写已读行 + drop（模拟 projector updateMessage 规则）→ 重建后读到新内容
 * 5. 追加 completed compaction（seq > watermark，providerContext 缺省即 local 边界）
 *    → 命中路径识别边界移动，按新边界全量重建
 * 6. 再读 → 新缓存命中，结果稳定
 */
import { and, asc, eq } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "./src/database/database.js"
import { SessionHistory } from "./src/session/history.js"
import { HistoryCache } from "./src/session/history-cache.js"
import { SessionMessageTable, SessionTable } from "./src/session/sql.js"
import { SessionMessage } from "@opencode/schema/session-message"

const SRC = process.argv[2]
const DB_PATH = process.argv[3] ?? "./test-cache.db"
if (!SRC) {
  console.error("usage: bun test-history-cache.ts <source-session.db> [dest.db]")
  process.exit(1)
}
await Bun.write(DB_PATH, new Uint8Array(await Bun.file(SRC).arrayBuffer()))

const encodeMessage = Schema.encodeSync(SessionMessage.Info)

let failures = 0
const assert = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : "  " + detail}`)
  if (!cond) failures++
}

const program = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const sessionRow = (yield* db.select().from(SessionTable).limit(1)) as any[]
  const sessionID = sessionRow[0].id
  const boundary = "local" as const
  const key = JSON.stringify(boundary)

  const runnerLoad = () => SessionHistory.entriesForRunner(db, sessionID, [], boundary).pipe(Effect.orDie)
  const truth = () => SessionHistory.load(db, sessionID, boundary).pipe(Effect.orDie)
  const maxSeq = () =>
    db
      .select({ seq: SessionMessageTable.seq })
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, sessionID))
      .orderBy(asc(SessionMessageTable.seq))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => (rows.length ? rows[rows.length - 1].seq : -1)),
      )
  const insertRow = (message: SessionMessage.Info, seq: number) => {
    const { id, type, ...data } = encodeMessage(message) as any
    return db
      .insert(SessionMessageTable)
      .values({
        id,
        session_id: sessionID,
        type,
        seq,
        data,
        time_created: DateTime.toEpochMillis(message.time.created),
      })
      .run()
      .pipe(Effect.orDie)
  }
  const rewriteRow = (message: SessionMessage.Info) => {
    const { id, type, ...data } = encodeMessage(message) as any
    return db
      .update(SessionMessageTable)
      .set({ type, data, time_created: DateTime.toEpochMillis(message.time.created) })
      .where(and(eq(SessionMessageTable.id, id), eq(SessionMessageTable.session_id, sessionID)))
      .run()
      .pipe(Effect.orDie)
  }
  const userMsg = (text: string) =>
    SessionMessage.User.make({
      id: SessionMessage.ID.create(),
      type: "user",
      text,
      metadata: {},
      time: { created: DateTime.makeUnsafe(Date.now()) },
    })

  // 场景 1: 首次全量加载
  HistoryCache.drop(sessionID)
  const r1 = yield* runnerLoad()
  const c1 = HistoryCache.get(sessionID, key)
  assert(
    "1 首次加载建立缓存",
    c1 !== undefined && c1.entries.length >= 1 && c1.watermark >= 0,
    `entries=${c1?.entries.length} watermark=${c1?.watermark}`,
  )
  const count1 = r1.entries.length
  const ids1 = JSON.stringify(r1.entries.map((e: any) => e.message.id))
  console.log(`   基线: entries=${count1} watermark=${c1?.watermark}`)

  // 场景 2: 无新行
  const r2 = yield* runnerLoad()
  assert("2 无新行命中缓存结果一致", JSON.stringify(r2.entries.map((e: any) => e.message.id)) === ids1)

  // 场景 3: 追加 user 行 → 增量合并
  const seqBefore = yield* maxSeq()
  const appended = userMsg("appended by cache test")
  yield* insertRow(appended, seqBefore + 1)
  const r3 = yield* runnerLoad()
  const t3 = yield* truth()
  assert("3 增量合并行数 +1", r3.entries.length === count1 + 1, `got=${r3.entries.length} want=${count1 + 1}`)
  assert(
    "3b 增量结果 == 全量真值",
    JSON.stringify(r3.entries.map((e: any) => e.message)) === JSON.stringify(t3),
  )
  const c3 = HistoryCache.get(sessionID, key)
  assert("3c watermark 前进", c3?.watermark === seqBefore + 1, `watermark=${c3?.watermark} want=${seqBefore + 1}`)

  // 场景 4: 重写已读行 + drop（模拟 projector 的 seq <= highWater 规则）
  yield* rewriteRow(
    SessionMessage.User.make({
      id: appended.id,
      type: "user",
      text: "rewritten by cache test",
      metadata: {},
      time: { created: DateTime.makeUnsafe(Date.now()) },
    }),
  )
  HistoryCache.drop(sessionID)
  const r4 = yield* runnerLoad()
  const r4appended = r4.entries.find((e: any) => e.message.id === appended.id)
  assert(
    "4 重写后重建读到新内容",
    (r4appended as any)?.message.text === "rewritten by cache test",
    `text=${JSON.stringify((r4appended as any)?.message.text)}`,
  )

  // 场景 5: 追加 completed compaction → 边界移动重建
  const seq5 = (yield* maxSeq()) + 1
  yield* insertRow(
    SessionMessage.CompactionCompleted.make({
      id: SessionMessage.ID.create(),
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "cache test summary",
      recent: "",
      time: { created: DateTime.makeUnsafe(Date.now()) },
    }),
    seq5,
  )
  const r5 = yield* runnerLoad()
  const first5 = (r5.entries as any[])[0]
  assert(
    "5 compaction 后按新边界重建",
    r5.entries.length === 1 && first5?.message.type === "compaction",
    `len=${r5.entries.length} type=${first5?.message.type}`,
  )
  const t5 = yield* truth()
  assert(
    "5b 与全量真值一致",
    JSON.stringify(r5.entries.map((e: any) => e.message)) === JSON.stringify(t5),
  )
  const c5 = HistoryCache.get(sessionID, key)
  assert(
    "5c 缓存按新边界建立",
    c5?.watermark === seq5 && c5?.entries.length === 1,
    `watermark=${c5?.watermark} entries=${c5?.entries.length}`,
  )

  // 场景 6: 新缓存命中
  const r6 = yield* runnerLoad()
  assert(
    "6 新缓存命中结果稳定",
    JSON.stringify(r6.entries.map((e: any) => e.message.id)) ===
      JSON.stringify(r5.entries.map((e: any) => e.message.id)),
  )

  console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`)
  if (failures > 0) process.exit(1)
})

await Effect.runPromise(
  Effect.gen(function* () {
    const context = yield* Layer.build(Database.layer({ path: DB_PATH }))
    yield* program.pipe(Effect.provide(context))
  }).pipe(Effect.scoped),
)

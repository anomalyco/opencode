/**
 * 微基准 v3：opencode v2.0.10 生产路径分段计时（真实会话 DB 副本）
 * A: drizzle 全量读（messageEntries 查询原样，含执行+行映射+JSON.parse）
 * B: Effect Schema 解码（decodeMessageRow 复刻，Effect.forEach 顺序执行）
 * A+B: SessionHistory.load；A+B+tx: 事务包裹（entriesForRunner 等价）
 * C: toLLMMessages（同步）；D: JSON.stringify(converted)（同步）
 * any 使用说明：一次性基准脚本，只关心运行时形状
 */
import { and, asc, eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { Database } from "./src/database/database.js"
import { SessionHistory } from "./src/session/history.js"
import { SessionMessageTable } from "./src/session/sql.js"
import { SessionMessage } from "@opencode/schema/session-message"
import { toLLMMessages } from "./src/session/runner/to-llm-message.js"

const DB_PATH = process.argv[2] ?? "/tmp/memstudy/bench.db"

const program = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const first = (yield* db.select().from(SessionMessageTable).limit(1)) as any[]
  const sessionID = first[0].session_id

  const readRows = () =>
    db
      .select()
      .from(SessionMessageTable)
      .where(and(eq(SessionMessageTable.session_id, sessionID)))
      .orderBy(asc(SessionMessageTable.seq))
      .all()
  const decode = Schema.decodeUnknownEffect(SessionMessage.Info)
  const decodeAll = (rs: any[]) =>
    Effect.forEach(rs, (row: any) => decode({ ...row.data, id: row.id, type: row.type }))
  const loadOnce = () => SessionHistory.load(db, sessionID, "local")
  const loadTx = () =>
    (db as any)
      .transaction(() => SessionHistory.load(db, sessionID, "local"))
      .pipe(Effect.orDie)

  // 预热
  let rows: any[] = []
  let decoded: any[] = []
  let model: any
  for (let i = 0; i < 20; i++) {
    rows = (yield* readRows()) as any[]
    decoded = yield* decodeAll(rows)
    model = decoded.find((m) => m.type === "assistant")?.model
  }
  const providerKey = String(model.providerID)
  const converted = toLLMMessages(decoded, model, providerKey)
  const N = rows.length

  const sizeOf = (v: unknown) => JSON.stringify(v).length
  console.log(`rows=${N} data=${(rows.reduce((s, r) => s + JSON.stringify(r.data).length, 0) / 1024) | 0}KB model=${model.providerID}/${model.id}`)
  console.log(`输出体积: A(rows)=${(sizeOf(rows) / 1024) | 0}KB B(decoded)=${(sizeOf(decoded) / 1024) | 0}KB C(converted)=${(sizeOf(converted) / 1024) | 0}KB`)

  const results: Record<string, number> = {}
  const report = (name: string, mean: number, iters: number, t: number[]) => {
    results[name] = mean
    console.log(`${name}: mean=${mean.toFixed(3)}ms p50=${t[(iters / 2) | 0].toFixed(3)}ms 每行=${((mean * 1000) / N).toFixed(1)}µs`)
  }
  // Effect 版：yield* 真执行，fiber 开销与生产路径一致
  function benchE(name: string, eff: () => any, iters: number) {
    return Effect.gen(function* () {
      for (let i = 0; i < 10; i++) yield* eff()
      const t: number[] = []
      for (let i = 0; i < iters; i++) {
        const s = performance.now()
        yield* eff()
        t.push(performance.now() - s)
      }
      t.sort((a, b) => a - b)
      report(name, t.reduce((a, b) => a + b, 0) / t.length, iters, t)
    })
  }
  // 同步版：给生产里就是同步调用的阶段（toLLMMessages / stringify）
  function bench(name: string, fn: () => unknown, iters: number) {
    for (let i = 0; i < 10; i++) void fn()
    const t: number[] = []
    for (let i = 0; i < iters; i++) {
      const s = performance.now()
      fn()
      t.push(performance.now() - s)
    }
    t.sort((a, b) => a - b)
    report(name, t.reduce((a, b) => a + b, 0) / t.length, iters, t)
  }

  console.log(`\n=== 全量历史 N=${N} ===`)
  yield* benchE("A 全量读(drizzle+parse)", () => readRows(), 200)
  yield* benchE("B Schema解码(forEach)", () => decodeAll(rows), 200)
  yield* benchE("A+B load生产路径", () => loadOnce(), 200)
  yield* benchE("A+B+tx 事务包裹", () => loadTx(), 150)
  bench("C toLLMMessages", () => toLLMMessages(decoded, model, providerKey), 200)
  bench("D stringify(converted)", () => JSON.stringify(converted), 200)

  // 线性验证：只取前一半行
  const half = N >> 1
  const readRowsHalf = () =>
    db
      .select()
      .from(SessionMessageTable)
      .where(and(eq(SessionMessageTable.session_id, sessionID)))
      .orderBy(asc(SessionMessageTable.seq))
      .limit(half)
      .all()
  console.log(`\n=== 子集 N=${half}（验证每行成本恒定） ===`)
  yield* benchE("A/2 全量读", () => readRowsHalf(), 200)
  yield* benchE("B/2 解码", () => decodeAll(rows.slice(0, half)), 200)
  bench("C/2 转换", () => toLLMMessages(decoded.slice(0, half), model, providerKey), 200)

  const ab = results["A+B load生产路径"]
  const c = results["C toLLMMessages"]
  const d = results["D stringify(converted)"]
  console.log(`\n=== 汇总（每步, N=${N}） ===`)
  console.log(`L1 目标(A+B)=${ab.toFixed(2)}ms | L2 目标(C)=${c.toFixed(2)}ms | 剩余地板(D)=${d.toFixed(2)}ms | 链合计=${(ab + c + d).toFixed(2)}ms`)
  console.log(`占比: L1=${((ab / (ab + c + d)) * 100).toFixed(0)}% L2=${((c / (ab + c + d)) * 100).toFixed(0)}% 地板=${((d / (ab + c + d)) * 100).toFixed(0)}%`)
})

await Effect.runPromise(
  Effect.gen(function* () {
    const context = yield* Layer.build(Database.layer({ path: DB_PATH }))
    yield* program.pipe(Effect.provide(context))
  }).pipe(Effect.scoped),
)

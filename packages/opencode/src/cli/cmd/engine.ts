import type { Argv } from "yargs"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"
import { Database } from "@opencode-ai/core/database/database"

const StatusCommand = effectCmd({
  command: "status",
  describe: "show engine database status",
  instance: false,
  handler: Effect.fn("Cli.engine.status")(function* () {
    const { db } = yield* Database.Service

    const tables = yield* db.all<{ name: string }>(
      sql.raw("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('event_log','checkpoint','capability_graph','session_memory','repair_memory','skill') ORDER BY name"),
    ).pipe(Effect.orDie)

    let eventCount = 0
    let checkpointCount = 0
    let capabilityCount = 0
    let memoryCount = 0
    let repairCount = 0
    let skillCount = 0

    try {
      const ec = yield* db.get<{ c: number }>(sql.raw("SELECT COUNT(*) as c FROM event_log")).pipe(Effect.orDie)
      eventCount = ec?.c ?? 0
    } catch { /* table may not exist */ }

    try {
      const cc = yield* db.get<{ c: number }>(sql.raw("SELECT COUNT(*) as c FROM checkpoint")).pipe(Effect.orDie)
      checkpointCount = cc?.c ?? 0
    } catch { /* table may not exist */ }

    try {
      const cac = yield* db.get<{ c: number }>(sql.raw("SELECT COUNT(*) as c FROM capability_graph")).pipe(Effect.orDie)
      capabilityCount = cac?.c ?? 0
    } catch { /* table may not exist */ }

    try {
      const mc = yield* db.get<{ c: number }>(sql.raw("SELECT COUNT(*) as c FROM session_memory")).pipe(Effect.orDie)
      memoryCount = mc?.c ?? 0
    } catch { /* table may not exist */ }

    try {
      const rc = yield* db.get<{ c: number }>(sql.raw("SELECT COUNT(*) as c FROM repair_memory")).pipe(Effect.orDie)
      repairCount = rc?.c ?? 0
    } catch { /* table may not exist */ }

    try {
      const sc = yield* db.get<{ c: number }>(sql.raw("SELECT COUNT(*) as c FROM skill")).pipe(Effect.orDie)
      skillCount = sc?.c ?? 0
    } catch { /* table may not exist */ }

    console.log("╔══════════════════════════════════════╗")
    console.log("║        Fengru Engine Status          ║")
    console.log("╠══════════════════════════════════════╣")
    console.log(`║ Database: ${Database.path().padEnd(29)}║`)
    console.log("╠══════════════════════════════════════╣")
    console.log(`║ Event Log:     ${String(eventCount).padStart(8)} events     ║`)
    console.log(`║ Checkpoints:   ${String(checkpointCount).padStart(8)} total      ║`)
    console.log(`║ Capabilities:  ${String(capabilityCount).padStart(8)} registered ║`)
    console.log(`║ Memories:      ${String(memoryCount).padStart(8)} stored      ║`)
    console.log(`║ Repair Rules:  ${String(repairCount).padStart(8)} learned     ║`)
    console.log(`║ Skills:        ${String(skillCount).padStart(8)} active      ║`)
    console.log("╠══════════════════════════════════════╣")
    const total = eventCount + checkpointCount + capabilityCount + memoryCount + repairCount + skillCount
    console.log(`║ Total Records: ${String(total).padStart(8)}            ║`)
    console.log("╚══════════════════════════════════════╝")
  }),
})

const EventsCommand = effectCmd({
  command: "events <sessionId>",
  describe: "list engine events for a session",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("sessionId", {
        type: "string",
        describe: "session ID",
        demandOption: true,
      })
      .option("limit", {
        type: "number",
        default: 50,
        describe: "maximum events to show",
      }),
  handler: Effect.fn("Cli.engine.events")(function* (args: { sessionId: string; limit: number }) {
    const { db } = yield* Database.Service

    const events = yield* db.all<{
      event_id: string
      event_type: string
      status: string
      token_cost: number
      duration_ms: number
      sequence_index: number
      timestamp: number
    }>(
      sql.raw(`SELECT event_id, event_type, status, token_cost, duration_ms, sequence_index, timestamp FROM event_log WHERE session_id = '${args.sessionId}' ORDER BY sequence_index LIMIT ${args.limit}`),
    ).pipe(Effect.orDie)

    if (events.length === 0) {
      console.log(`No events found for session: ${args.sessionId}`)
      return
    }

    console.log(`Events for session ${args.sessionId} (${events.length} shown):`)
    console.log("─".repeat(80))
    for (const event of events) {
      const time = new Date(event.timestamp).toISOString().replace("T", " ").slice(0, 19)
      const cost = event.token_cost > 0 ? `${event.token_cost}tok` : ""
      const dur = event.duration_ms > 0 ? `${event.duration_ms}ms` : ""
      console.log(
        `[${time}] #${String(event.sequence_index).padStart(3)} ${event.event_type.padEnd(18)} ${event.status.padEnd(8)} ${cost.padStart(8)} ${dur.padStart(6)}`,
      )
    }
    console.log("─".repeat(80))
  }),
})

const CheckpointsCommand = effectCmd({
  command: "checkpoints <sessionId>",
  describe: "list engine checkpoints for a session",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("sessionId", {
      type: "string",
      describe: "session ID",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.engine.checkpoints")(function* (args: { sessionId: string }) {
    const { db } = yield* Database.Service

    const checkpoints = yield* db.all<{
      checkpoint_id: string
      level: string
      context_hash: string
      git_head_hash: string | null
      created_at: number
    }>(
      sql.raw(`SELECT checkpoint_id, level, context_hash, git_head_hash, created_at FROM checkpoint WHERE session_id = '${args.sessionId}' ORDER BY created_at DESC`),
    ).pipe(Effect.orDie)

    if (checkpoints.length === 0) {
      console.log(`No checkpoints found for session: ${args.sessionId}`)
      return
    }

    console.log(`Checkpoints for session ${args.sessionId}:`)
    console.log("─".repeat(80))
    for (const cp of checkpoints) {
      const time = new Date(cp.created_at).toISOString().replace("T", " ").slice(0, 19)
      console.log(
        `[${time}] ${cp.checkpoint_id.padEnd(30)} L=${cp.level} hash=${cp.context_hash.slice(0, 8)} git=${cp.git_head_hash?.slice(0, 8) ?? "N/A"}`,
      )
    }
    console.log("─".repeat(80))
  }),
})

export const EngineCommand = {
  command: "engine",
  describe: "manage the Fengru execution engine",
  builder: (yargs: Argv) =>
    yargs.command(StatusCommand as never).command(EventsCommand as never).command(CheckpointsCommand as never).demandCommand(),
  async handler() {},
}

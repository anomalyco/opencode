import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import type { BriefBead } from "@/beads/beads"
import { Mapping, type MappingFile } from "@/beads/mapping"
import { BeadsSync } from "@/beads/sync"
import { Todo } from "@/session/todo"
import { SessionID } from "@/session/schema"
import { InstanceRef } from "@/effect/instance-ref"
import { UI } from "../ui"
import { which } from "@/util/which"
import { spawn } from "node:child_process"
import path from "path"

function parseBriefBead(raw: Record<string, unknown>): BriefBead | null {
  const id = String(raw.id ?? "")
  if (!id) return null
  return {
    id,
    title: String(raw.title ?? ""),
    status: String(raw.status ?? ""),
    priority: Number(raw.priority ?? 0),
    type: String(raw.issue_type ?? String(raw.type ?? "")),
  }
}

export const BeadsCommand = cmd({
  command: "beads",
  describe: "manage beads task integration",
  builder: (yargs: Argv) =>
    yargs.command(BeadsStatusCommand).command(BeadsSyncCommand).command(BeadsUnlinkCommand).command(BeadsListCommand).demandCommand(),
  async handler() {},
})

export const BeadsStatusCommand = effectCmd({
  command: "status",
  describe: "show beads sync status",
  handler: Effect.fn("Cli.beads.status")(function* () {
    const hasBd = yield* Effect.sync(() => which("bd") !== null)
    const available = hasBd
      ? (yield* (Effect.tryPromise(() =>
        new Promise<{ code: number }>((resolve) => {
          const child = spawn("bd", ["status"], { stdio: "ignore" })
          child.on("exit", (code) => resolve({ code: code ?? 1 }))
          child.on("error", () => resolve({ code: 1 }))
        }),
      ).pipe(Effect.catch(() => Effect.succeed({ code: 1 }))))).code === 0
      : false
    const ctx = yield* InstanceRef
    const dir = ctx ? path.join(ctx.directory, ".beads") : path.join(process.cwd(), ".beads")

    UI.println("Beads Sync Status")
    UI.println("─────────────────")
    UI.println(`  Enabled:    true`)
    UI.println(`  BD CLI:     ${available ? "available" : "not found"}`)
    UI.println(`  Beads Dir:  ${dir}`)

    if (available) {
      const result = yield* (Effect.tryPromise(() =>
        new Promise<{ code: number; text: string }>((resolve) => {
          const child = spawn("bd", ["list", "--json"], { stdio: ["inherit", "pipe", "pipe"] })
          let stdout = ""
          child.stdout.on("data", (d) => (stdout += d.toString()))
          child.on("exit", (code) => resolve({ code: code ?? 1, text: stdout }))
          child.on("error", () => resolve({ code: 1, text: "" }))
        }),
      ).pipe(Effect.catch(() => Effect.succeed({ code: 1, text: "" }))))
      const allBeads = result.code === 0 ? (JSON.parse(result.text) as Record<string, unknown>[]) : []
      const beads = allBeads.map(parseBriefBead).filter((b): b is BriefBead => b !== null)

      const cwd = process.cwd()
      const mapping = yield* Mapping.load(cwd).pipe(
        Effect.orElseSucceed(() => ({ version: 1, mapping: {} })),
      )

      const linkedBeads = Object.keys(mapping.mapping).length
      const openBeads = beads.filter((b) => b.status === "open").length
      const inProgressBeads = beads.filter((b) => b.status === "in_progress").length

      UI.println(`  Total Beads:  ${beads.length}`)
      UI.println(`  Open:         ${openBeads}`)
      UI.println(`  In Progress:  ${inProgressBeads}`)
      UI.println(`  Linked:       ${linkedBeads}`)
    }
  }),
})

export const BeadsSyncCommand = effectCmd({
  command: "sync",
  describe: "trigger full beads sync for all sessions",
  builder: (yargs) =>
    yargs.option("session", {
      describe: "session ID to sync",
      type: "string",
    }),
  handler: Effect.fn("Cli.beads.sync")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("No project context available")

    if (!args.session) return yield* fail("Session ID required. Use --session <id>")
    const sessionID = SessionID.make(args.session)
    const todoService = yield* Todo.Service
    const todos = yield* todoService.get(sessionID)
    if (todos.length === 0) return UI.println("No todos to sync")

    const service = yield* BeadsSync.Service
    yield* service.sync({ sessionID, todos: todos as { content: string; status: string; priority: string }[] })

    UI.println("Beads sync complete")
  }),
})

export const BeadsUnlinkCommand = effectCmd({
  command: "unlink <beadsId>",
  describe: "unlink a beads task from opencode sessions (does not close the beads task)",
  builder: (yargs) =>
    yargs.positional("beadsId", {
      describe: "beads task ID to unlink",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.beads.unlink")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("No project context available")

    const mappingPath = path.join(ctx.directory, ".opencode")
    let mapping: MappingFile
    try {
      mapping = yield* Mapping.load(mappingPath).pipe(
        Effect.catch(() => Effect.succeed({ version: 1, mapping: {} } as MappingFile)),
      )
    } catch {
      return yield* fail(`No mapping file found at ${mappingPath}`)
    }

    const entry = mapping.mapping[args.beadsId]
    if (!entry) return yield* fail(`Beads task not found in mapping: ${args.beadsId}`)

    const sessions = Object.keys(entry.sessions)
    const nextMapping = { ...mapping.mapping }
    delete nextMapping[args.beadsId]

    yield* Mapping.save(mappingPath, { ...mapping, mapping: nextMapping })

    UI.println(`Unlinked beads task ${args.beadsId} from ${sessions.length} session(s)`)
    if (sessions.length > 0) {
      UI.println(`  Sessions: ${sessions.join(", ")}`)
    }
  }),
})

export const BeadsListCommand = effectCmd({
  command: "list",
  describe: "list all synced beads tasks",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "output as JSON",
      type: "boolean",
      default: false,
    }),
  handler: Effect.fn("Cli.beads.list")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("No project context available")

    const mappingPath = path.join(ctx.directory, ".opencode")
    let mapping: MappingFile
    try {
      mapping = yield* Mapping.load(mappingPath).pipe(
        Effect.catch(() => Effect.succeed({ version: 1, mapping: {} } as MappingFile)),
      )
    } catch {
      return yield* fail(`No mapping file found at ${mappingPath}`)
    }

    const entries = Object.entries(mapping.mapping)
    if (entries.length === 0) return UI.println("No linked beads tasks")

    if (args.json) {
      UI.println(JSON.stringify({ version: mapping.version, mapping: mapping.mapping }, null, 2))
      return
    }

    UI.println("Linked Beads Tasks")
    UI.println("──────────────────")
    for (const [beadsId, entry] of entries) {
      UI.println(`\n  ${beadsId}`)
      UI.println(`  Title:    ${entry.title}`)
      UI.println(`  Status:   ${entry.status}`)
      UI.println(`  Priority: ${entry.priority}`)
      UI.println(`  Sessions: ${Object.keys(entry.sessions).length}`)
    }
  }),
})

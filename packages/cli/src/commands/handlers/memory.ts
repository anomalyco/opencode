import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const LIMIT = 120_000

type Entry = {
  file: string
  section: string
  key: string
  text: string
  updatedAt?: number
  sessionID?: string
  messageID?: string
}

type Digest = {
  id: string
  time: string
  topic?: string
  summary: string
}

/** Render stored memory entries and session digests as the evidence block for the why prompt. */
export function dossier(input: { entries: Entry[]; sessions: Digest[] }) {
  const entries = input.entries.map(
    (item) => `- [${item.file} > ${item.section} > ${item.key}]${stamp(item.updatedAt)}${taughtBy(item)} ${item.text}`,
  )
  const sessions = input.sessions.map(
    (item) => `- [session ${item.id}${item.topic ? ` > ${item.topic}` : ""}] learned ${item.time}: ${item.summary}`,
  )
  return [
    entries.length ? `## Memory entries\n${entries.join("\n")}` : "",
    sessions.length ? `## Session digests\n${sessions.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}

function stamp(ms?: number) {
  if (!ms || ms <= 0) return ""
  return ` (updated ${new Date(ms).toISOString().slice(0, 10)})`
}

function taughtBy(item: Entry) {
  if (!item.sessionID && !item.messageID) return ""
  const parts = [
    ...(item.sessionID ? [`session ${item.sessionID}`] : []),
    ...(item.messageID ? [`message ${item.messageID}`] : []),
  ]
  return ` (taught by ${parts.join(", ")})`
}

const INSTRUCTIONS = [
  "You are answering a question about this project's stored agent memory.",
  "Use only the memory dossier below as evidence. Do not use tools, read repository files, or invent memories.",
  "Answer the question, then cite the specific memory entries that support the answer: quote each supporting entry verbatim and name its file, section, and key.",
  "When an entry carries metadata such as an updated date or a session id, state where and when it was learned.",
  "If nothing in the dossier supports an answer, say plainly that stored memory does not cover it.",
].join("\n")

export const MemoryCommand = cmd({
  command: "memory",
  describe: "inspect project memory",
  builder: (yargs: Argv) =>
    yargs
      .command(MemoryWhyCommand)
      .command(MemoryTeamCommand)
      .command(MemoryDiffCommand)
      .command(MemoryReviewCommand)
      .command(MemorySearchCommand)
      .command(MemoryConflictsCommand)
      .command(MemoryExportCommand)
      .command(MemoryImportCommand)
      .demandCommand(),
  async handler() {},
})

export const MemoryExportCommand = effectCmd({
  command: "export",
  describe: "export project memory as a single markdown document",
  builder: (yargs) =>
    yargs.option("out", {
      alias: "o",
      type: "string",
      describe: "write the export to a file instead of stdout",
    }),
  handler: Effect.fn("Cli.memory.export")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const { Memory } = yield* Effect.promise(() => import("@bolt-ai/memory/memory"))
    const { MemoryPaths } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/paths"))
    const dumped = yield* Effect.promise(() => Memory.dump({ root: MemoryPaths.root({ ctx }) }))
    if (dumped.count === 0) return yield* fail("No project memory stored for this project yet.")
    if (!args.out) {
      UI.println(dumped.text)
      return
    }
    yield* Effect.promise(() => Bun.write(args.out!, dumped.text))
    UI.println(`Exported ${dumped.count} memory entries to ${args.out}`)
  }),
})

export const MemoryImportCommand = effectCmd({
  command: "import <file>",
  describe: "import memory entries from an exported markdown document",
  builder: (yargs) =>
    yargs.positional("file", {
      describe: "path to a markdown export produced by bolt memory export",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.memory.import")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const exists = yield* Effect.promise(() => Bun.file(args.file).exists())
    if (!exists) return yield* fail(`File not found: ${args.file}`)
    const text = yield* Effect.promise(() => Bun.file(args.file).text())

    const { Memory } = yield* Effect.promise(() => import("@bolt-ai/memory/memory"))
    const { MemoryPaths } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/paths"))
    const loaded = yield* Effect.promise(() => Memory.load({ root: MemoryPaths.root({ ctx }), text }))
    if (loaded.ops === 0) return yield* fail("No memory entries found in that file.")
    UI.println(`Imported ${loaded.applied} of ${loaded.ops} memory entries (${loaded.added} added).`)
    for (const name of loaded.skipped) {
      UI.println(`Skipped unknown memory file: ${name}`)
    }
  }),
})

export const MemoryTeamCommand = effectCmd({
  command: "team <action> [query]",
  describe: "opt-in shared project memory committed to the repository",
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "init creates .bolt/memory.md; share copies matching facts into it",
        type: "string",
        choices: ["init", "share"] as const,
        demandOption: true,
      })
      .positional("query", {
        describe: "key or id of the fact to share",
        type: "string",
      }),
  handler: Effect.fn("Cli.memory.team")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const { MemoryTeam } = yield* Effect.promise(() => import("@bolt-ai/memory/team"))
    if (args.action === "init") {
      const output = yield* Effect.promise(() => MemoryTeam.init(ctx.worktree))
      UI.println(
        output.created
          ? `Created ${output.file}. Commit it to share project memory with your team.`
          : `Team memory already exists at ${output.file}.`,
      )
      return
    }

    if (!args.query) return yield* fail("Pass the key or id of the fact to share.")
    const { MemoryFiles } = yield* Effect.promise(() => import("@bolt-ai/memory/store"))
    const { MemoryPaths } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/paths"))
    const inventory = yield* Effect.promise(() => MemoryFiles.deriveInventory(MemoryPaths.root({ ctx })))
    const matched = MemoryTeam.match({
      items: Object.entries(inventory.items).map(([id, item]) => ({
        id,
        file: item.file,
        section: item.section,
        key: item.key,
        text: item.text,
      })),
      query: args.query,
    })
    if (matched.length === 0) return yield* fail(`No stored fact matches "${args.query}".`)
    const shared = yield* Effect.promise(() =>
      MemoryTeam.share(
        ctx.worktree,
        matched.map((item) => ({ section: item.section, key: item.key, text: item.text })),
      ),
    )
    UI.println(`Shared ${shared.count} fact${shared.count === 1 ? "" : "s"} into ${shared.file}.`)
    UI.println("Commit the file so teammates pick it up in recall.")
  }),
})

export const MemoryDiffCommand = effectCmd({
  command: "diff",
  describe: "show memory staged by sessions before it persists",
  builder: (yargs) =>
    yargs
      .option("apply", { type: "boolean", default: false, describe: "persist the staged memory" })
      .option("discard", { type: "boolean", default: false, describe: "drop the staged memory" }),
  handler: Effect.fn("Cli.memory.diff")(function* (args) {
    if (args.apply && args.discard) return yield* fail("Pass only one of --apply or --discard.")
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const { Memory } = yield* Effect.promise(() => import("@bolt-ai/memory/memory"))
    const { MemoryPaths } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/paths"))
    const root = MemoryPaths.root({ ctx })
    const output = yield* Effect.promise(() => Memory.pending({ root }))
    if (output.items.length === 0) {
      UI.println(
        output.review
          ? "No staged memory. Review mode is on; session captures will queue here."
          : "No staged memory. Review mode is off; enable it with bolt memory review on.",
      )
      return
    }

    for (const line of output.diff) UI.println(line)
    if (args.apply) {
      const result = yield* Effect.promise(() => Memory.approve({ root }))
      UI.empty()
      UI.println(`Applied ${result.applied} staged operation${result.applied === 1 ? "" : "s"}.`)
      return
    }
    if (args.discard) {
      const result = yield* Effect.promise(() => Memory.discard({ root }))
      UI.empty()
      UI.println(`Discarded ${result.discarded} staged operation${result.discarded === 1 ? "" : "s"}.`)
      return
    }
    UI.empty()
    UI.println("Run bolt memory diff --apply to persist or bolt memory diff --discard to drop.")
  }),
})

export const MemoryReviewCommand = effectCmd({
  command: "review <mode>",
  describe: "toggle review mode for auto-captured memory",
  builder: (yargs) =>
    yargs.positional("mode", {
      describe: "on to stage session captures for review, off to persist them directly",
      type: "string",
      choices: ["on", "off"] as const,
      demandOption: true,
    }),
  handler: Effect.fn("Cli.memory.review")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const { Memory } = yield* Effect.promise(() => import("@bolt-ai/memory/memory"))
    const { MemoryPaths } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/paths"))
    const output = yield* Effect.promise(() =>
      Memory.review({ root: MemoryPaths.root({ ctx }), review: args.mode === "on" }),
    )
    UI.println(
      output.review
        ? "Review mode on: session captures stage in bolt memory diff before persisting."
        : `Review mode off: session captures persist directly.${output.staged ? ` ${output.staged} staged operation${output.staged === 1 ? "" : "s"} still pending in bolt memory diff.` : ""}`,
    )
  }),
})

export const MemorySearchCommand = effectCmd({
  command: "search <query>",
  describe: "search everything stored in project memory",
  builder: (yargs) =>
    yargs
      .positional("query", {
        describe: "what to search stored memory for",
        type: "string",
        demandOption: true,
      })
      .option("limit", {
        alias: "n",
        type: "number",
        default: 10,
        describe: "maximum results to print",
      }),
  handler: Effect.fn("Cli.memory.search")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const { MemorySearch } = yield* Effect.promise(() => import("@bolt-ai/memory/search"))
    const { MemoryPaths } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/paths"))
    const output = yield* Effect.promise(() =>
      MemorySearch.search({ root: MemoryPaths.root({ ctx }), query: args.query, limit: args.limit }),
    )
    if (!output.enabled) return yield* fail("Project memory is disabled. Enable it with /memory on or bolt learn.")
    if (output.hits.length === 0) {
      UI.println("No stored memory matches that query.")
      return
    }

    output.hits.forEach((hit, index) => {
      const doc = hit.doc
      const where = doc.source === "sessions" ? `session ${doc.key}` : `${doc.source} > ${doc.section} > ${doc.key}`
      UI.println(`${index + 1}. [${where}]${stamp(doc.updatedAt)} ${doc.text}`)
    })
  }),
})

function label(item: { file: string; section: string; key: string; text: string }) {
  return `[${item.file} > ${item.section} > ${item.key}] ${item.text}`
}

export const MemoryConflictsCommand = effectCmd({
  command: "conflicts",
  describe: "detect and resolve contradictory facts in project memory",
  builder: (yargs) =>
    yargs.option("fix", {
      type: "boolean",
      default: false,
      describe: "apply automatic resolutions (corrections win, else the newer fact)",
    }),
  handler: Effect.fn("Cli.memory.conflicts")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const { Memory } = yield* Effect.promise(() => import("@bolt-ai/memory/memory"))
    const { MemoryPaths } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/paths"))
    const output = yield* Effect.promise(() => Memory.conflicts({ root: MemoryPaths.root({ ctx }), fix: args.fix }))

    if (output.conflicts.length === 0) {
      UI.println("No conflicting facts found in project memory.")
      return
    }

    for (const conflict of output.conflicts) {
      UI.println(`conflict (${conflict.reason}):`)
      UI.println(`  ${label(conflict.left)}`)
      UI.println(`  ${label(conflict.right)}`)
    }
    UI.empty()
    for (const item of output.plan.resolutions) {
      UI.println(`resolution: keep ${label(item.keep)}`)
      UI.println(`            drop ${label(item.drop)}`)
    }
    for (const item of output.plan.unresolved) {
      UI.println(`unresolved (${item.reason}): ${label(item.left)} vs ${label(item.right)}`)
    }
    if (output.applied) {
      UI.empty()
      UI.println(
        `Removed ${output.result.result.removed} superseded ${output.result.result.removed === 1 ? "fact" : "facts"}.`,
      )
      return
    }
    if (output.plan.resolutions.length > 0) {
      UI.empty()
      UI.println("Run bolt memory conflicts --fix to apply these resolutions.")
    }
  }),
})

export const MemoryWhyCommand = effectCmd({
  command: "why <question>",
  describe: "ask why the agent believes something and where it learned it",
  builder: (yargs) =>
    yargs
      .positional("question", {
        describe: "what to ask stored memory about",
        type: "string",
        demandOption: true,
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.memory.why")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const { MemoryService } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/service"))
    const { MemoryPaths } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/paths"))
    const memory = MemoryService.make()
    const shown = yield* memory.show({ ctx }).pipe(Effect.orDie)
    const digests = yield* memory.recent({ root: MemoryPaths.root({ ctx }), limit: 10, max: 200 }).pipe(Effect.orDie)
    const { Memory } = yield* Effect.promise(() => import("@bolt-ai/memory/memory"))
    const taught = yield* Effect.promise(() => Memory.origins({ root: MemoryPaths.root({ ctx }) }))
    const entries = Object.entries(shown.inventory.items).map(([id, item]) => {
      const source = taught.items[id]
      return { ...item, sessionID: source?.sessionID, messageID: source?.messageID }
    })
    const evidence = dossier({ entries, sessions: digests })
    if (!evidence) {
      return yield* fail("No project memory stored for this project yet. Run bolt learn or save memories first.")
    }

    UI.println("Asking stored memory...")

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt memory why",
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "plan_enter", action: "deny", pattern: "*" },
        { permission: "plan_exit", action: "deny", pattern: "*" },
      ],
    })

    const capped = evidence.length > LIMIT ? `${evidence.slice(0, LIMIT)}\n[dossier truncated]` : evidence
    const result = yield* prompt
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "build",
        model: args.model ? parseModel(args.model) : undefined,
        parts: [
          {
            id: PartID.ascending(),
            type: "text",
            text: `${INSTRUCTIONS}\n\nQuestion:\n${args.question}\n\nMemory dossier:\n${capped}`,
          },
        ],
      })
      .pipe(Effect.orDie)

    if (result.info.role === "assistant" && result.info.error) {
      const err = result.info.error
      const message = "message" in err.data ? err.data.message : ""
      return yield* fail(`${err.name}: ${message}`)
    }

    const text = extractResponseText(result.parts) ?? ""
    if (!text) return yield* fail("The model returned an empty answer.")

    UI.empty()
    UI.println(UI.markdown(text))
  }),
})

import { LSP } from "@/lsp/lsp"
import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import { EOL } from "os"

export const LSPCommand = cmd({
  command: "lsp",
  describe: "LSP debugging utilities",
  builder: (yargs) =>
    yargs
      .command(DiagnosticsCommand)
      .command(SymbolsCommand)
      .command(DocumentSymbolsCommand)
      .command(ToolCommand)
      .demandCommand(),
  async handler() {},
})

const ToolCommand = effectCmd({
  command: "tool <operation>",
  describe: "run the lsp tool for one operation and report wall-clock timing",
  directory: () => process.env.LSP_BENCH_DIR || process.cwd(),
  builder: (yargs) =>
    yargs
      .positional("operation", { type: "string", demandOption: true })
      .option("symbol", { type: "string" })
      .option("filePath", { type: "string" })
      .option("query", { type: "string" })
      .option("line", { type: "number" })
      .option("character", { type: "number" })
      .option("newName", { type: "string" })
      .option("apply", { type: "boolean" })
      .option("solution", { type: "string" })
      .option("raw", { type: "boolean" })
      .option("repeat", { type: "number", default: 1 }),
  handler: Effect.fn("Cli.debug.lsp.tool")(function* (args) {
    const { LspTool } = yield* Effect.promise(() => import("@/tool/lsp"))
    const { SessionID, MessageID } = yield* Effect.promise(() => import("@/session/schema"))
    const input = args as unknown as {
      operation: string
      symbol?: string
      filePath?: string
      query?: string
      line?: number
      character?: number
      newName?: string
      apply?: boolean
      solution?: string
    }
    const info = yield* LspTool
    const def = yield* info.init()
    const ctx = {
      sessionID: SessionID.make("ses_bench"),
      messageID: MessageID.make("msg_bench"),
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => Effect.void,
      ask: () => Effect.void,
    }
    const raw = Boolean((args as unknown as { raw?: boolean }).raw)
    const repeat = Math.max(1, Number((args as unknown as { repeat?: number }).repeat ?? 1))
    const timings: number[] = []
    let result: { title: string; output: string } = { title: "", output: "" }
    for (let i = 0; i < repeat; i++) {
      const start = performance.now()
      result = yield* def.execute(input as never, ctx as never)
      timings.push(Math.round((performance.now() - start) * 10) / 10)
    }
    if (raw) {
      process.stdout.write(result.output + EOL)
      return
    }
    const warm = timings.slice(1)
    process.stdout.write(
      JSON.stringify(
        {
          first: timings[0],
          warm: warm.length ? Math.round((warm.reduce((a, b) => a + b, 0) / warm.length) * 10) / 10 : null,
          runs: timings,
          title: result.title,
          output: result.output.slice(0, 800),
        },
        null,
        2,
      ) + EOL,
    )
  }),
})

const DiagnosticsCommand = effectCmd({
  command: "diagnostics <file>",
  describe: "get diagnostics for a file",
  builder: (yargs) => yargs.positional("file", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.debug.lsp.diagnostics")(function* (args) {
    const out = yield* LSP.Service.use((lsp) =>
      Effect.gen(function* () {
        yield* lsp.touchFile(args.file, "full")
        return yield* lsp.diagnostics()
      }),
    )
    process.stdout.write(JSON.stringify(out, null, 2) + EOL)
  }),
})

export const SymbolsCommand = effectCmd({
  command: "symbols <query>",
  describe: "search workspace symbols",
  builder: (yargs) => yargs.positional("query", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.debug.lsp.symbols")(function* (args) {
    yield* Effect.logInfo("symbols")
    const results = yield* LSP.Service.use((lsp) => lsp.workspaceSymbol(args.query))
    process.stdout.write(JSON.stringify(results, null, 2) + EOL)
  }),
})

export const DocumentSymbolsCommand = effectCmd({
  command: "document-symbols <uri>",
  describe: "get symbols from a document",
  builder: (yargs) => yargs.positional("uri", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.debug.lsp.documentSymbols")(function* (args) {
    yield* Effect.logInfo("document-symbols")
    const results = yield* LSP.Service.use((lsp) => lsp.documentSymbol(args.uri))
    process.stdout.write(JSON.stringify(results, null, 2) + EOL)
  }),
})

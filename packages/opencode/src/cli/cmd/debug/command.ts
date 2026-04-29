import { EOL } from "os"
import { cmd } from "../cmd"

const ConfigCommand = cmd({
  command: "config",
  describe: "show resolved configuration",
  builder: (yargs) => yargs,
  handler: async () => {
    await import("./handler").then(({ configHandler }) => configHandler())
  },
})

const FileSearchCommand = cmd({
  command: "search <query>",
  describe: "search files by query",
  builder: (yargs) =>
    yargs.positional("query", {
      type: "string",
      demandOption: true,
      description: "Search query",
    }),
  handler: async (args) => {
    await import("./handler").then(({ fileSearchHandler }) => fileSearchHandler(args))
  },
})

const FileReadCommand = cmd({
  command: "read <path>",
  describe: "read file contents as JSON",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to read",
    }),
  handler: async (args) => {
    await import("./handler").then(({ fileReadHandler }) => fileReadHandler(args))
  },
})

const FileStatusCommand = cmd({
  command: "status",
  describe: "show file status information",
  builder: (yargs) => yargs,
  handler: async () => {
    await import("./handler").then(({ fileStatusHandler }) => fileStatusHandler())
  },
})

const FileListCommand = cmd({
  command: "list <path>",
  describe: "list files in a directory",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to list",
    }),
  handler: async (args) => {
    await import("./handler").then(({ fileListHandler }) => fileListHandler(args))
  },
})

const FileTreeCommand = cmd({
  command: "tree [dir]",
  describe: "show directory tree",
  builder: (yargs) =>
    yargs.positional("dir", {
      type: "string",
      description: "Directory to tree",
      default: process.cwd(),
    }),
  handler: async (args) => {
    await import("./handler").then(({ fileTreeHandler }) => fileTreeHandler(args))
  },
})

const FileCommand = cmd({
  command: "file",
  describe: "file system debugging utilities",
  builder: (yargs) =>
    yargs
      .command(FileReadCommand)
      .command(FileStatusCommand)
      .command(FileListCommand)
      .command(FileSearchCommand)
      .command(FileTreeCommand)
      .demandCommand(),
  handler: async () => {},
})

const LSPDiagnosticsCommand = cmd({
  command: "diagnostics <file>",
  describe: "get diagnostics for a file",
  builder: (yargs) => yargs.positional("file", { type: "string", demandOption: true }),
  handler: async (args) => {
    await import("./handler").then(({ lspDiagnosticsHandler }) => lspDiagnosticsHandler(args))
  },
})

const LSPSymbolsCommand = cmd({
  command: "symbols <query>",
  describe: "search workspace symbols",
  builder: (yargs) => yargs.positional("query", { type: "string", demandOption: true }),
  handler: async (args) => {
    await import("./handler").then(({ lspSymbolsHandler }) => lspSymbolsHandler(args))
  },
})

const LSPDocumentSymbolsCommand = cmd({
  command: "document-symbols <uri>",
  describe: "get symbols from a document",
  builder: (yargs) => yargs.positional("uri", { type: "string", demandOption: true }),
  handler: async (args) => {
    await import("./handler").then(({ lspDocumentSymbolsHandler }) => lspDocumentSymbolsHandler(args))
  },
})

const LSPCommand = cmd({
  command: "lsp",
  describe: "LSP debugging utilities",
  builder: (yargs) =>
    yargs.command(LSPDiagnosticsCommand).command(LSPSymbolsCommand).command(LSPDocumentSymbolsCommand).demandCommand(),
  handler: async () => {},
})

const RipgrepTreeCommand = cmd({
  command: "tree",
  describe: "show file tree using ripgrep",
  builder: (yargs) =>
    yargs.option("limit", {
      type: "number",
    }),
  handler: async (args) => {
    await import("./handler").then(({ rgTreeHandler }) => rgTreeHandler(args))
  },
})

const RipgrepFilesCommand = cmd({
  command: "files",
  describe: "list files using ripgrep",
  builder: (yargs) =>
    yargs
      .option("query", {
        type: "string",
        description: "Filter files by query",
      })
      .option("glob", {
        type: "string",
        description: "Glob pattern to match files",
      })
      .option("limit", {
        type: "number",
        description: "Limit number of results",
      }),
  handler: async (args) => {
    await import("./handler").then(({ rgFilesHandler }) => rgFilesHandler(args))
  },
})

const RipgrepSearchCommand = cmd({
  command: "search <pattern>",
  describe: "search file contents using ripgrep",
  builder: (yargs) =>
    yargs
      .positional("pattern", {
        type: "string",
        demandOption: true,
        description: "Search pattern",
      })
      .option("glob", {
        type: "array",
        description: "File glob patterns",
      })
      .option("limit", {
        type: "number",
        description: "Limit number of results",
      }),
  handler: async (args) => {
    await import("./handler").then(({ rgSearchHandler }) => rgSearchHandler(args))
  },
})

const RipgrepCommand = cmd({
  command: "rg",
  describe: "ripgrep debugging utilities",
  builder: (yargs) =>
    yargs.command(RipgrepTreeCommand).command(RipgrepFilesCommand).command(RipgrepSearchCommand).demandCommand(),
  handler: async () => {},
})

const ScrapCommand = cmd({
  command: "scrap",
  describe: "list all known projects",
  builder: (yargs) => yargs,
  handler: async () => {
    await import("./handler").then(({ scrapHandler }) => scrapHandler())
  },
})

const SkillCommand = cmd({
  command: "skill",
  describe: "list all available skills",
  builder: (yargs) => yargs,
  handler: async () => {
    await import("./handler").then(({ skillHandler }) => skillHandler())
  },
})

const SnapshotTrackCommand = cmd({
  command: "track",
  describe: "track current snapshot state",
  handler: async () => {
    await import("./handler").then(({ snapshotTrackHandler }) => snapshotTrackHandler())
  },
})

const SnapshotPatchCommand = cmd({
  command: "patch <hash>",
  describe: "show patch for a snapshot hash",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  handler: async (args) => {
    await import("./handler").then(({ snapshotPatchHandler }) => snapshotPatchHandler(args))
  },
})

const SnapshotDiffCommand = cmd({
  command: "diff <hash>",
  describe: "show diff for a snapshot hash",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  handler: async (args) => {
    await import("./handler").then(({ snapshotDiffHandler }) => snapshotDiffHandler(args))
  },
})

const SnapshotCommand = cmd({
  command: "snapshot",
  describe: "snapshot debugging utilities",
  builder: (yargs) =>
    yargs.command(SnapshotTrackCommand).command(SnapshotPatchCommand).command(SnapshotDiffCommand).demandCommand(),
  handler: async () => {},
})

const StartupCommand = cmd({
  command: "startup",
  describe: "print startup timing",
  builder: (yargs) => yargs,
  handler: () => {
    process.stdout.write(performance.now().toString() + EOL)
  },
})

const DebugAgentCommand = cmd({
  command: "agent <name>",
  describe: "show agent configuration details",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        description: "Agent name",
      })
      .option("tool", {
        type: "string",
        description: "Tool id to execute",
      })
      .option("params", {
        type: "string",
        description: "Tool params as JSON or a JS object literal",
      }),
  handler: async (args) => {
    await import("./handler").then(({ agentHandler }) => agentHandler(args))
  },
})

const PathsCommand = cmd({
  command: "paths",
  describe: "show global paths (data, config, cache, state)",
  handler: async () => {
    await import("./handler").then(({ pathsHandler }) => pathsHandler())
  },
})

const WaitCommand = cmd({
  command: "wait",
  describe: "wait indefinitely (for debugging)",
  handler: async () => {
    await import("./handler").then(({ waitHandler }) => waitHandler())
  },
})

export const DebugCommand = cmd({
  command: "debug",
  describe: "debugging and troubleshooting tools",
  builder: (yargs) =>
    yargs
      .command(ConfigCommand)
      .command(LSPCommand)
      .command(RipgrepCommand)
      .command(FileCommand)
      .command(ScrapCommand)
      .command(SkillCommand)
      .command(SnapshotCommand)
      .command(StartupCommand)
      .command(DebugAgentCommand)
      .command(PathsCommand)
      .command(WaitCommand)
      .demandCommand(),
  handler: async () => {},
})

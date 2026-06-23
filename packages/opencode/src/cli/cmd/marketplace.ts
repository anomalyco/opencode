import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Marketplace } from "@/marketplace"
import { UI } from "../ui"

export const MarketplaceCommand = cmd({
  command: "marketplace",
  aliases: ["market", "registry"],
  describe: "discover, install, and manage opencode packages",
  builder: (yargs) =>
    yargs
      .command(MarketplaceSearchCommand)
      .command(MarketplaceInstallCommand)
      .command(MarketplaceUninstallCommand)
      .command(MarketplaceListCommand)
      .command(MarketplaceInfoCommand)
      .demandCommand(),
  async handler() {},
})

const MarketplaceSearchCommand = effectCmd({
  command: "search [query]",
  describe: "search available packages",
  instance: false,
  builder: (yargs) =>
    yargs.positional("query", {
      type: "string",
      describe: "search query",
    }),
  handler: Effect.fn("Cli.marketplace.search")(function* (args) {
    const svc = yield* Marketplace.Service
    const query = String(args.query ?? "")
    const results = yield* svc.search(query)
    if (results.length === 0) {
      process.stdout.write("No packages found.\n")
      return
    }
    for (const pkg of results) {
      const src = pkg.source as { type: string; repo?: string; url?: string; path?: string }
      process.stdout.write(`${pkg.name}\n`)
      if (pkg.description) process.stdout.write(`  ${pkg.description}\n`)
      process.stdout.write(`  source: ${sourceLabel(src)}\n`)
      if (pkg.version) process.stdout.write(`  version: ${pkg.version}\n`)
      process.stdout.write("\n")
    }
  }),
})

const MarketplaceInstallCommand = effectCmd({
  command: "install <source>",
  aliases: ["i", "add"],
  describe: "install a package from a source",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("source", {
        type: "string",
        describe: "package source (github:user/repo, url, or local path)",
      })
      .option("name", {
        type: "string",
        alias: "n",
        describe: "package name (default: auto-detected)",
      }),
  handler: Effect.fn("Cli.marketplace.install")(function* (args) {
    const raw = String(args.source ?? "")
    if (!raw) return yield* fail("source is required (e.g. github:user/repo, url, or path)")

    const sourceStr = raw.startsWith("github:") || raw.startsWith("gh:")
      ? raw
      : raw.startsWith("http://") || raw.startsWith("https://")
        ? raw
        : raw

    const pkgName = String(args.name ?? sourceStr.split("/").pop() ?? sourceStr.split(":").pop() ?? "package")

    const svc = yield* Marketplace.Service
    yield* svc.install(pkgName, sourceStr)
    process.stdout.write(`Installed "${pkgName}" from ${sourceStr}\n`)
  }),
})

const MarketplaceUninstallCommand = effectCmd({
  command: "uninstall <name>",
  aliases: ["remove", "rm"],
  describe: "uninstall a package",
  instance: false,
  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      describe: "package name",
    }),
  handler: Effect.fn("Cli.marketplace.uninstall")(function* (args) {
    const name = String(args.name ?? "")
    if (!name) return yield* fail("package name is required")

    const svc = yield* Marketplace.Service
    yield* svc.uninstall(name)
    process.stdout.write(`Uninstalled "${name}"\n`)
  }),
})

const MarketplaceListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list installed packages",
  instance: false,
  handler: Effect.fn("Cli.marketplace.list")(function* () {
    const svc = yield* Marketplace.Service
    const list = yield* svc.list()

    if (list.length === 0) {
      process.stdout.write("No packages installed.\n")
      return
    }

    process.stdout.write("Installed packages:\n\n")
    for (const pkg of list) {
      process.stdout.write(`  ${pkg.name}`)
      process.stdout.write(`\n    source: ${pkg.sourceUrl}\n`)
      process.stdout.write(`    installed: ${new Date(pkg.installedAt).toISOString().slice(0, 10)}\n\n`)
    }
  }),
})

const MarketplaceInfoCommand = effectCmd({
  command: "info <name>",
  describe: "show details about an installed package",
  instance: false,
  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      describe: "package name",
    }),
  handler: Effect.fn("Cli.marketplace.info")(function* (args) {
    const name = String(args.name ?? "")
    if (!name) return yield* fail("package name is required")

    const svc = yield* Marketplace.Service
    const pkg = yield* svc.info(name)
    if (!pkg) return yield* fail(`package "${name}" not found`)

    process.stdout.write(`Package: ${pkg.name}\n`)
    process.stdout.write(`Source:  ${pkg.sourceUrl}\n`)
    process.stdout.write(`Installed: ${new Date(pkg.installedAt).toISOString()}\n`)
  }),
})

function sourceLabel(source: { type: string; repo?: string; url?: string; path?: string }) {
  switch (source.type) {
    case "github":
      return `github:${source.repo}`
    case "url":
      return source.url ?? "url"
    case "local":
      return source.path ?? "local"
    default:
      return "unknown"
  }
}

import path from "node:path"
import { Effect, Option, Schema } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { bucket, imports } from "./map"

const SKIP = new Set([".git", "node_modules", "dist", "build", ".turbo"])
const CONTRACT = "architecture.json"

export const Rule = Schema.Struct({
  from: Schema.String,
  allow: Schema.optional(Schema.Array(Schema.String)),
  deny: Schema.optional(Schema.Array(Schema.String)),
})

export const Contract = Schema.Struct({
  depth: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(2))),
  rules: Schema.Array(Rule),
})

export type Edge = { from: string; to: string; file: string; target: string }
export type Violation = { from: string; to: string; file: string; target: string; rule: string }

/** Decodes a parsed JSON value into a contract, or none when the shape is wrong. */
export function contract(input: unknown) {
  return Schema.decodeUnknownOption(Contract)(input)
}

/** True when a directory bucket falls under a contract pattern: exact match or a subdirectory of it. */
export function within(name: string, pattern: string) {
  return name === pattern || name.startsWith(`${pattern}/`)
}

/**
 * Evaluates directory-level import edges against the declared rules. The first
 * rule whose `from` covers the edge source applies: an `allow` list permits
 * only itself and listed targets, a `deny` list forbids listed targets, and
 * sources without a covering rule are unconstrained.
 */
export function violations(edges: Edge[], rules: readonly (typeof Rule.Type)[]) {
  return edges.flatMap((edge) => {
    const rule = rules.find((candidate) => within(edge.from, candidate.from))
    if (!rule) return []
    if (within(edge.to, rule.from)) return []
    const denied = rule.deny?.some((pattern) => within(edge.to, pattern)) ?? false
    if (denied) return [{ ...edge, rule: rule.from }]
    if (!rule.allow) return []
    const allowed = rule.allow.some((pattern) => within(edge.to, pattern))
    return allowed ? [] : [{ ...edge, rule: rule.from }]
  })
}

/** Renders violations grouped by offending directory pair, with the importing files as evidence. */
export function markdown(found: Violation[], checked: number) {
  if (found.length === 0) return `# Architectural drift\n\nNo drift: ${checked} import edges satisfy the contract.\n`
  const key = (violation: Violation) => `${violation.from} -> ${violation.to}`
  const groups = new Map<string, Violation[]>()
  for (const violation of found) {
    const list = groups.get(key(violation)) ?? []
    list.push(violation)
    groups.set(key(violation), list)
  }
  const sections = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .flatMap(([pair, list]) => [
      `## \`${pair}\` (${list.length} imports, rule \`${list[0].rule}\`)`,
      "",
      ...list.slice(0, 10).map((violation) => `- \`${violation.file}\` imports \`${violation.target}\``),
      ...(list.length > 10 ? [`- ...and ${list.length - 10} more`] : []),
      "",
    ])
  return ["# Architectural drift", "", `${found.length} imports violate the declared contract.`, "", ...sections].join(
    "\n",
  )
}

export const ArchCommand = effectCmd({
  command: "arch",
  describe: "detect imports that violate the declared module contract",
  instance: false,
  builder: (yargs) =>
    yargs.option("contract", {
      describe: "contract file declaring allowed directory dependencies",
      type: "string",
      default: CONTRACT,
    }),
  handler: Effect.fn("Cli.arch")(function* (args) {
    const cwd = process.cwd()
    const handle = Bun.file(path.join(cwd, args.contract))
    const exists = yield* Effect.promise(() => handle.exists())
    if (!exists)
      return yield* fail(
        `No contract at ${args.contract}. Declare one, e.g. {"depth":2,"rules":[{"from":"src/util","allow":[]}]}`,
      )
    const raw = yield* Effect.promise(() => handle.text())
    const decoded = Schema.decodeOption(Schema.UnknownFromJsonString)(raw).pipe(Option.flatMap(contract))
    if (Option.isNone(decoded))
      return yield* fail(`Invalid contract in ${args.contract}: expected {depth?, rules: [{from, allow?, deny?}]}`)
    const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}")
    const scanned = yield* Effect.promise(() => Array.fromAsync(glob.scan({ cwd })))
    const names = scanned
      .map((name) => name.replaceAll("\\", "/"))
      .filter((name) => !name.split("/").some((part) => SKIP.has(part)))
      .sort()
    const known = new Set(names)
    const edges: Edge[] = []
    for (const name of names) {
      const text = yield* Effect.promise(() => Bun.file(path.join(cwd, name)).text())
      for (const target of imports(name, text, known)) {
        const from = bucket(name, decoded.value.depth)
        const to = bucket(target, decoded.value.depth)
        if (from === to) continue
        edges.push({ from, to, file: name, target })
      }
    }
    const found = violations(edges, decoded.value.rules)
    process.stdout.write(markdown(found, edges.length))
    process.stderr.write(`Checked ${edges.length} edges against ${decoded.value.rules.length} rules\n`)
    if (found.length > 0) return yield* fail(`${found.length} architectural drift violations`)
  }),
})

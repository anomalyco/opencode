import path from "node:path"
import { Effect, Option, Schema } from "effect"
import { effectCmd, fail } from "../effect-cmd"

const SKIP = new Set([".git", "node_modules", "dist", "build", ".turbo"])

export const Manifest = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

export type Node = { name: string; dir: string; deps: string[] }
export type Order = { levels: string[][]; cyclic: string[] }

/**
 * Workspace nodes from a map of package.json path to parsed content. Only
 * dependencies on other workspace packages become edges; external packages
 * are irrelevant to build order.
 */
export function nodes(manifests: Record<string, unknown>) {
  const decoded = Object.keys(manifests)
    .sort()
    .flatMap((file) => {
      const parsed = Schema.decodeUnknownOption(Manifest)(manifests[file])
      if (Option.isNone(parsed)) return []
      return [{ file, manifest: parsed.value }]
    })
  const internal = new Set(decoded.map((entry) => entry.manifest.name))
  return decoded.map((entry) => {
    const manifest = entry.manifest
    const external = [
      manifest.dependencies ?? {},
      manifest.devDependencies ?? {},
      manifest.peerDependencies ?? {},
      manifest.optionalDependencies ?? {},
    ]
    const deps = [...new Set(external.flatMap((record) => Object.keys(record)))]
      .filter((name) => internal.has(name) && name !== manifest.name)
      .sort()
    return { name: manifest.name, dir: path.posix.dirname(entry.file), deps }
  })
}

/**
 * Kahn topological sort into parallel build levels: every package in level N
 * only depends on packages in levels below N. Packages caught in dependency
 * cycles never reach in-degree zero and are reported separately.
 */
export function order(graph: Node[]): Order {
  const names = new Set(graph.map((node) => node.name))
  const remaining = new Map(graph.map((node) => [node.name, new Set(node.deps.filter((dep) => names.has(dep)))]))
  const levels: string[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining.keys()].filter((name) => (remaining.get(name)?.size ?? 0) === 0).sort()
    if (ready.length === 0) break
    levels.push(ready)
    for (const name of ready) remaining.delete(name)
    for (const deps of remaining.values()) {
      for (const name of ready) deps.delete(name)
    }
  }
  return { levels, cyclic: [...remaining.keys()].sort() }
}

/** Renders the graph as markdown: mermaid edges, parallel build order, and any cycles. */
export function markdown(graph: Node[], built: Order) {
  if (graph.length === 0) return "# Package graph\n\nNo workspace packages found.\n"
  const ids = new Map(graph.map((node, index) => [node.name, `p${index}`]))
  const shapes = graph.map((node) => `  ${ids.get(node.name)}["${node.name}"]`)
  const arrows = graph.flatMap((node) => node.deps.map((dep) => `  ${ids.get(node.name)} --> ${ids.get(dep)}`))
  const rows = built.levels.map((level, index) => `| ${index + 1} | ${level.map((name) => `\`${name}\``).join(", ")} |`)
  const sections = [
    "# Package graph",
    "",
    `${graph.length} workspace packages.`,
    "",
    "```mermaid",
    "graph TD",
    ...shapes,
    ...arrows,
    "```",
    "",
    "## Build order",
    "",
    "Packages in the same level build in parallel; each level only depends on earlier levels.",
    "",
    "| Level | Packages |",
    "| --- | --- |",
    ...rows,
    "",
  ]
  if (built.cyclic.length > 0) {
    sections.push(
      "## Dependency cycles",
      "",
      `No valid build order for: ${built.cyclic.map((name) => `\`${name}\``).join(", ")}`,
      "",
    )
  }
  return sections.join("\n")
}

export const PackagesCommand = effectCmd({
  command: "packages",
  describe: "map the monorepo package graph and its build order",
  instance: false,
  builder: (yargs) =>
    yargs.option("out", {
      describe: "optional markdown output file, prints to stdout when omitted",
      type: "string",
    }),
  handler: Effect.fn("Cli.packages")(function* (args) {
    const cwd = process.cwd()
    const glob = new Bun.Glob("**/package.json")
    const scanned = yield* Effect.promise(() => Array.fromAsync(glob.scan({ cwd })))
    const names = scanned
      .map((name) => name.replaceAll("\\", "/"))
      .filter((name) => !name.split("/").some((part) => SKIP.has(part)))
      .sort()
    const manifests: Record<string, unknown> = {}
    for (const name of names) {
      const raw = yield* Effect.promise(() => Bun.file(path.join(cwd, name)).text())
      const parsed = Schema.decodeOption(Schema.UnknownFromJsonString)(raw)
      if (Option.isSome(parsed)) manifests[name] = parsed.value
    }
    const graph = nodes(manifests)
    if (graph.length === 0) return yield* fail("No workspace packages found under the current directory")
    const built = order(graph)
    const text = markdown(graph, built)
    if (args.out) {
      yield* Effect.promise(() => Bun.write(path.join(cwd, args.out ?? ""), text))
      process.stderr.write(`Wrote package graph for ${graph.length} packages to ${args.out}\n`)
      return
    }
    process.stdout.write(text)
    process.stderr.write(`Mapped ${graph.length} packages into ${built.levels.length} build levels\n`)
  }),
})

// P-ORACLE and P-FILE helper for F.5, driven by crates/local/tests/config_interop.rs. Run it from
// <ts-root>/packages/cli (`bun --cwd`), so the TUI sources it imports get their JSX settings.
//
//   bun F.5-config.ts <ts-root> jsonc            stdin: [{text, path, value?}]; modify + applyEdits, or parse when no path
//   bun F.5-config.ts <ts-root> decode           stdin: [value]; Config.Info decode, null when it fails
//   bun F.5-config.ts <ts-root> resolve          stdin: [info]; Config.resolve without keybinds
//   bun F.5-config.ts <ts-root> keys             stdin: null; every Config.Info key path and literal
//   bun F.5-config.ts <ts-root> migrate-v1       stdin: [{legacy, kv}]; migrateV1(decodeV1(legacy), kv)
//   bun F.5-config.ts <ts-root> config           stdin: [op]; Config get and update, XDG from the environment
//   bun F.5-config.ts <ts-root> model <file>     stdin: [op]; the model.json repository
//   bun F.5-config.ts <ts-root> storage <state> <channel>  stdin: [op]; TUI storage
//   bun F.5-config.ts <ts-root> jsonl            stdin: {history, stash, frecency}; the three parsers
//
// A config op is {get: true} or {update: [[path, value | null]]}, where null deletes. Every command
// prints one JSON array of results.

const [root, command, ...args] = process.argv.slice(2)
if (!root || !command) throw new Error("usage: F.5-config.ts <ts-root> <command> [args...]")

const load = (spec: string, from = "packages/cli/src") => import(Bun.resolveSync(spec, `${root}/${from}`))
const input = await Bun.stdin.json()
const output: unknown[] = []
const capture = async (run: () => unknown) => {
  try {
    return { ok: (await run()) ?? null }
  } catch (error) {
    return { error: String((error as Error)?.message ?? error) }
  }
}

if (command === "jsonc") {
  const { applyEdits, modify, parse } = await load("jsonc-parser")
  for (const item of input) {
    if (item.path === undefined) {
      const errors: unknown[] = []
      const value = parse(item.text, errors, { allowTrailingComma: true })
      output.push(errors.length ? null : value)
      continue
    }
    output.push(
      await capture(() =>
        applyEdits(
          item.text,
          modify(item.text, item.path, "value" in item ? item.value : undefined, {
            formattingOptions: { tabSize: 2, insertSpaces: true },
          }),
        ),
      ),
    )
  }
}

if (command === "decode" || command === "resolve") {
  const { Config } = await load("./config/config")
  const { Config: Tui } = await load("./config/index.tsx", "packages/tui/src")
  const { Schema, Option } = await load("effect")
  const decode = Schema.decodeUnknownOption(Config.Info)
  for (const value of input) {
    if (command === "decode") {
      output.push(Option.getOrNull(decode(value)))
      continue
    }
    const resolved = Tui.resolve(Option.getOrThrow(decode(value)), { terminalSuspend: true, environment: {} })
    delete resolved.keybinds
    output.push(resolved)
  }
}

// Every leaf key path of Config.Info, read from its JSON Schema, with the first sample value TypeScript decodes
// there. `keybinds` is one leaf: its names are generated (script/gen/config.ts). Prints
// [{paths, value, decoded, literals}]: value sets every leaf at once, and literals holds one config for each
// literal a leaf accepts, such as each `mini.work_spinner` name.
if (command === "keys") {
  const { Config } = await load("./config/config")
  const { Schema, Option } = await load("effect")
  type Node = { [key: string]: unknown }
  const decode = Schema.decodeUnknownOption(Config.Info)
  const document = Schema.toJsonSchemaDocument(Config.Info)
  const resolve = (node: Node): Node =>
    typeof node.$ref === "string" ? resolve(document.definitions[node.$ref.split("/").at(-1)!]) : node
  const literals = (node: unknown): unknown[] => {
    if (Array.isArray(node)) return node.flatMap(literals)
    if (typeof node !== "object" || node === null) return []
    const own = resolve(node as Node)
    return [
      ...(Array.isArray(own.enum) ? own.enum : []),
      ...("const" in own ? [own.const] : []),
      ...Object.values(own).flatMap(literals),
    ]
  }
  const nest = (path: string[], value: unknown): unknown =>
    path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value)
  const leaves: { path: string[]; value: unknown }[] = []
  const accepted: unknown[] = []
  const walk = (node: Node, path: string[]) => {
    const own = resolve(node)
    const struct = [own, ...((own.anyOf as Node[] | undefined) ?? []).map(resolve)].find((item) => item.properties)
    if (struct && path.at(-1) !== "keybinds") {
      for (const [key, child] of Object.entries(struct.properties as Record<string, Node>)) walk(child, [...path, key])
      return
    }
    const samples = [...literals(own), true, 1, "x", [], {}].filter((sample) => Option.isSome(decode(nest(path, sample))))
    if (samples.length === 0) throw new Error(`keys: no sample decodes at ${path.join(".")}`)
    leaves.push({ path, value: samples[0] })
    if (path.at(-1) !== "keybinds")
      accepted.push(...[...new Set(literals(own))].filter((sample) => samples.includes(sample)).map((sample) => nest(path, sample)))
  }
  walk(document.schema, [])
  const value: Record<string, unknown> = {}
  for (const leaf of leaves) {
    const parent = leaf.path
      .slice(0, -1)
      .reduce<Record<string, unknown>>((node, key) => (node[key] ??= {}) as Record<string, unknown>, value)
    parent[leaf.path.at(-1)!] = leaf.value
  }
  output.push({
    paths: leaves.map((leaf) => leaf.path.join(".")),
    value,
    decoded: Option.getOrNull(decode(value)),
    literals: accepted,
  })
}

if (command === "migrate-v1") {
  const { ConfigMigration } = await load("./config/migrate")
  const { TuiConfigV1 } = await load("./config/v1/index.tsx", "packages/tui/src")
  const { Schema, Option } = await load("effect")
  const decode = Schema.decodeUnknownOption(TuiConfigV1.Info)
  for (const item of input)
    output.push(ConfigMigration.migrateV1(Option.getOrUndefined(decode(item.legacy)), item.kv ?? {}))
}

if (command === "config") {
  const { Config } = await load("./config/config")
  const { Global } = await load("@opencode/util/global")
  const { Effect } = await load("effect")
  const { NodeServices } = await load("@effect/platform-node")
  const set = (draft: Record<string, unknown>, path: string[], value: unknown) => {
    const parent = path
      .slice(0, -1)
      .reduce<Record<string, unknown>>((node, key) => (node[key] ??= {}) as Record<string, unknown>, draft)
    if (value === null) delete parent[path.at(-1)!]
    else parent[path.at(-1)!] = value
  }
  for (const op of input) {
    const program = Effect.gen(function* () {
      const config = yield* Config.Service
      if (op.get) return yield* config.get()
      return yield* config.update((draft: Record<string, unknown>) => {
        for (const [path, value] of op.update) set(draft, path, value)
      })
    })
    output.push(
      await capture(() =>
        Effect.runPromise(
          program.pipe(
            Effect.provide(Config.layer),
            Effect.provide(Global.layerWith({})),
            Effect.provide(NodeServices.layer),
          ),
        ),
      ),
    )
  }
}

if (command === "model") {
  const { createModelPreferenceRepository } = await load("./model-preference.ts", "packages/tui/src")
  const repository = createModelPreferenceRepository(args[0])
  for (const op of input) {
    output.push(
      await capture(async () => {
        if (op.recent) return repository.addRecent(op.recent)
        if (op.favorite) return repository.setFavorite(op.favorite, op.enabled)
        if (op.variant) return repository.saveVariant(op.variant, op.value ?? undefined)
        return repository.load()
      }),
    )
  }
}

if (command === "storage") {
  const { createStorage } = await load("./context/storage.tsx", "packages/tui/src")
  const result = createStorage(args[0], args[1])
  for (const op of input) {
    const [store, update] = result.storage.store(op.key, { initial: op.initial })
    output.push(
      await capture(async () => {
        if (op.set) await update((draft: Record<string, unknown>) => Object.assign(draft, op.set))
        return JSON.parse(JSON.stringify(store))
      }),
    )
  }
  result.close()
}

if (command === "jsonl") {
  const { parsePromptHistory } = await load("./prompt/history.tsx", "packages/tui/src")
  const { parsePromptStash } = await load("./prompt/stash.tsx", "packages/tui/src")
  const { parseFrecency } = await load("./prompt/frecency.tsx", "packages/tui/src")
  output.push(parsePromptHistory(input.history), parsePromptStash(input.stash), parseFrecency(input.frecency))
}

console.log(JSON.stringify(output))

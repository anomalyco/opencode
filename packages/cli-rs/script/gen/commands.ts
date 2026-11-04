// Dumps the TypeScript CLI command tree (packages/cli/src/commands/commands.ts) to JSON. The Rust test
// crates/cli/tests/tree.rs compares the clap tree against it: names, aliases, descriptions, arguments, flags.
import { Effect, Exit, Option } from "effect"
import { GlobalFlag } from "effect/cli"
import { Commands, PrintLogs } from "../../../cli/src/commands/commands"

type Param = {
  readonly _tag: "Single" | "Map" | "Transform" | "Optional" | "Variadic"
  readonly kind: "flag" | "argument"
  readonly param: Param
  readonly name: string
  readonly description: Option.Option<string>
  readonly aliases: ReadonlyArray<string>
  readonly primitiveType: { readonly _tag: string; readonly choiceKeys?: ReadonlyArray<string> }
  readonly typeName?: string
  readonly hidden: boolean
  readonly optionalValue?: string
  readonly min: Option.Option<number>
  readonly max: Option.Option<number>
  readonly parse: (args: { flags: Record<string, string[]>; arguments: string[] }) => Effect.Effect<unknown, unknown>
}

type Spec = {
  readonly description?: string
  readonly config: { readonly flags: ReadonlyArray<Param>; readonly arguments: ReadonlyArray<Param> }
  readonly globalFlags: ReadonlyArray<{ readonly flag: Param }>
}

type Node = {
  readonly name: string
  readonly spec: Spec
  readonly commands: Record<string, Node>
  readonly aliases: ReadonlyArray<Node>
}

function walk(param: Param, state = { optional: false, min: undefined as number | undefined, max: undefined as number | undefined, repeated: false }): { single: Param; optional: boolean; repeated: boolean; min?: number; max?: number } {
  if (param._tag === "Single") return { single: param, ...state }
  if (param._tag === "Optional") return walk(param.param, { ...state, optional: true })
  if (param._tag === "Variadic")
    return walk(param.param, {
      ...state,
      repeated: true,
      min: Option.getOrUndefined(param.min),
      max: Option.getOrUndefined(param.max),
    })
  return walk(param.param, state)
}

// withDefault wraps the parser, so the default is what the param parses to with no input.
function fallback(param: Param) {
  const exit = Effect.runSyncExit(param.parse({ flags: {}, arguments: [] }) as Effect.Effect<readonly [unknown, unknown]>)
  if (!Exit.isSuccess(exit)) return undefined
  const value = exit.value[1]
  if (Option.isOption(value)) return undefined
  return value
}

function flag(param: Param) {
  const info = walk(param)
  const value = fallback(param)
  return {
    name: info.single.name,
    aliases: info.single.aliases,
    type: info.single.typeName ?? info.single.primitiveType._tag,
    choices: info.single.primitiveType.choiceKeys ?? [],
    description: Option.getOrElse(info.single.description, () => ""),
    hidden: info.single.hidden,
    optional: info.optional || value !== undefined,
    repeated: info.repeated,
    min: info.min,
    max: info.max,
    optionalValue: info.single.optionalValue !== undefined,
    default: Array.isArray(value) && value.length === 0 ? undefined : value,
  }
}

function argument(param: Param) {
  const info = walk(param)
  return {
    name: info.single.name,
    type: info.single.typeName ?? info.single.primitiveType._tag,
    choices: info.single.primitiveType.choiceKeys ?? [],
    description: Option.getOrElse(info.single.description, () => ""),
    optional: info.optional,
    variadic: info.repeated,
    min: info.min,
    max: info.max,
  }
}

function node(input: Node, aliases: ReadonlyArray<string>): unknown {
  const spec = input.spec as Spec & { readonly alias?: string }
  return {
    name: input.name,
    aliases: [spec.alias, ...aliases].filter((alias) => alias !== undefined),
    description: spec.description ?? "",
    globalFlags: spec.globalFlags.map((global) => walk(global.flag).single.name),
    arguments: spec.config.arguments.map(argument),
    flags: spec.config.flags.map(flag),
    commands: Object.values(input.commands).map((child) =>
      node(
        child,
        child.aliases.map((alias) => alias.name),
      ),
    ),
  }
}

const root = node(Commands as unknown as Node, [])
const builtins = [...GlobalFlag.BuiltIns, PrintLogs].map((global) => flag(global.flag as unknown as Param))
const tree = { builtins, root }

const output = new URL("../../crates/cli/tests/fixtures/commands.json", import.meta.url).pathname
await Bun.write(output, JSON.stringify(tree, null, 2) + "\n")
console.log(`commands: wrote ${output}`)

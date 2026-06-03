import * as Effect from "effect/Effect"
import * as Command from "effect/unstable/cli/Command"
import { CliApi } from "./cli-api"

export type Input<Value> =
  Value extends CliApi.Node<infer _Name, infer Spec, infer _Commands>
    ? Input<Spec>
    : Value extends Command.Command<infer _Name, infer Input, infer _Context, infer _Error, infer _Requirements>
      ? Input
      : never

type RuntimeHandler = (input: unknown) => Effect.Effect<void, unknown>
type Loader<Node extends CliApi.Any> = () => Promise<{ default: (input: Input<Node>) => Effect.Effect<void, any> }>
type ProvidedCommand = Command.Command<string, unknown, unknown, unknown, never>

export type Handlers<Node extends CliApi.Any> = keyof Node["commands"] extends never
  ? Loader<Node>
  : { readonly $?: Loader<Node> } & { readonly [Key in keyof Node["commands"]]: Handlers<Node["commands"][Key]> }

interface LazyHandler {
  readonly spec: Command.Command.Any
  readonly load: () => Promise<{ default: RuntimeHandler }>
}

type RuntimeHandlers =
  | (() => Promise<{ default: RuntimeHandler }>)
  | {
      readonly $?: () => Promise<{ default: RuntimeHandler }>
      readonly [key: string]: RuntimeHandlers | (() => Promise<{ default: RuntimeHandler }>) | undefined
    }

export function handler<const Node extends CliApi.Any, Error>(
  _node: Node,
  run: (input: Input<Node>) => Effect.Effect<void, Error>,
) {
  return run
}

export function handlers<const Root extends CliApi.Any>(root: Root, handlers: Handlers<Root>) {
  const result: LazyHandler[] = []

  function add(node: CliApi.Any, value: RuntimeHandlers) {
    if (typeof value === "function") {
      result.push({ spec: node.spec, load: value as () => Promise<{ default: RuntimeHandler }> })
      return
    }
    if (value.$) result.push({ spec: node.spec, load: value.$ as () => Promise<{ default: RuntimeHandler }> })
    for (const [name, child] of Object.entries(node.commands)) add(child, value[name] as RuntimeHandlers)
  }

  add(root, handlers as RuntimeHandlers)
  return result
}

export function run(api: CliApi.Any, handlers: ReadonlyArray<LazyHandler>, options: { readonly version: string }) {
  return Command.run(provide(api, handlers), options) as Effect.Effect<void, unknown, Command.Environment>
}

function provide(node: CliApi.Any, handlers: ReadonlyArray<LazyHandler>): ProvidedCommand {
  const spec: Command.Command.Any = Object.keys(node.commands).length
    ? (node.spec as Command.Command<string, unknown>).pipe(
        Command.withSubcommands(Object.values(node.commands).map((child) => provide(child, handlers))),
      )
    : node.spec
  const handler = handlers.find((handler) => handler.spec === node.spec)
  if (!handler) return spec as ProvidedCommand
  return spec.pipe(
    Command.withHandler((input) => Effect.flatMap(Effect.promise(handler.load), (module) => module.default(input))),
  ) as ProvidedCommand
}

export * as CliBuilder from "./cli-builder"

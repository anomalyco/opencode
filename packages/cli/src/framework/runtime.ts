import * as Effect from "effect/Effect"
import * as Command from "effect/unstable/cli/Command"
import { Spec } from "./spec"
import { Daemon } from "../services/daemon"

export type Input<Value> =
  Value extends Spec.Node<infer _Name, infer Command, infer _Commands>
    ? Input<Command>
    : Value extends Command.Command<infer _Name, infer Input, infer _Context, infer _Error, infer _Requirements>
      ? Input
      : never

type RuntimeHandler = (input: unknown) => Effect.Effect<void, unknown, Daemon.Service>
type Loader<Node extends Spec.Any> = () => Promise<{
  default: (input: Input<Node>) => Effect.Effect<void, any, Daemon.Service>
}>
type ProvidedCommand = Command.Command<string, unknown, unknown, unknown, Daemon.Service>

export type Handlers<Node extends Spec.Any> = keyof Node["commands"] extends never
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

export function handler<const Node extends Spec.Any, Error, Requirements>(
  _node: Node,
  run: (input: Input<Node>) => Effect.Effect<void, Error, Requirements>,
) {
  return run
}

export function handlers<const Root extends Spec.Any>(root: Root, handlers: Handlers<Root>) {
  const result: LazyHandler[] = []

  function add(node: Spec.Any, value: RuntimeHandlers) {
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

export function run(commands: Spec.Any, handlers: ReadonlyArray<LazyHandler>, options: { readonly version: string }) {
  return Command.run(provide(commands, handlers), options) as Effect.Effect<void, unknown, Command.Environment>
}

function provide(node: Spec.Any, handlers: ReadonlyArray<LazyHandler>): ProvidedCommand {
  const handler = handlers.find((handler) => handler.spec === node.spec)
  const spec = handler
    ? node.spec.pipe(
        Command.withHandler((input) =>
          Effect.gen(function* () {
            yield* Effect.flatMap(Effect.promise(handler.load), (module) => module.default(input))
          }),
        ),
      )
    : node.spec
  if (!Object.keys(node.commands).length) return spec as ProvidedCommand
  return spec.pipe(
    Command.withSubcommands(Object.values(node.commands).map((child) => provide(child, handlers))),
  ) as ProvidedCommand
}

export * as Runtime from "./runtime"

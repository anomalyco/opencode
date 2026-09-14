import { Command } from "effect/unstable/cli"

type Options<Config extends Command.Command.Config, Commands extends ReadonlyArray<Any>> = {
  readonly description?: string
  readonly aliases?: ReadonlyArray<string>
  readonly params?: Config
  readonly commands?: Commands
}

export interface Node<
  Name extends string,
  Spec extends Command.Command<Name, any, any, any, any>,
  Commands extends Children,
> {
  readonly name: Name
  readonly spec: Spec
  readonly commands: Commands
  readonly aliases: ReadonlyArray<Any>
}

export type Any = Node<string, Command.Command<any, any, any, any, any>, Children>
export type Children = Readonly<Record<string, Any>>

export function make<
  const Name extends string,
  const Config extends Command.Command.Config = {},
  const Commands extends ReadonlyArray<Any> = [],
>(name: Name, options: Options<Config, Commands> = {}) {
  const aliases = options.aliases ?? []
  const params = options.params ?? ({} as Config)
  const command = Command.make(name, params)
  const described = options.description ? command.pipe(Command.withDescription(options.description)) : command
  // Effect supports a single native alias, shown inline as `name, alias` in help.
  // Extra aliases become sibling commands sharing params and subcommands.
  const spec = aliases.length > 0 ? described.pipe(Command.withAlias(aliases[0])) : described
  const commands = Object.fromEntries(
    (options.commands ?? []).map((command) => [command.name, command]),
  ) as ChildrenOf<Commands>
  const extra = aliases.slice(1).map((alias) => {
    const aliasCommand = Command.make(alias, params)
    const aliasSpec = options.description
      ? aliasCommand.pipe(Command.withDescription(options.description))
      : aliasCommand
    return { name: alias, spec: aliasSpec, commands, aliases: [] }
  })
  return {
    name,
    spec,
    commands,
    aliases: extra,
  }
}

type ChildrenOf<Commands extends ReadonlyArray<Any>> = {
  readonly [Node in Commands[number] as Node["name"]]: Node
}

export * as Spec from "./spec"

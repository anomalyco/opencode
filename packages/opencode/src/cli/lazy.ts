import type { Argv, ArgumentsCamelCase, CommandModule } from "yargs"

/**
 * Metadata yargs needs synchronously to register a top-level command:
 *  - `command` / `aliases` — to match argv and drive completion
 *  - `describe` — to render the top-level `--help` listing
 *  - `deprecated` — to render the deprecation marker in help
 *
 * Everything else (`builder`, `handler`) can be async, which is what lets us
 * defer loading the implementation module until the command actually fires.
 */
export type LazyMeta = {
  readonly command: string | readonly string[]
  readonly aliases?: string | readonly string[]
  readonly describe?: string | false
  readonly deprecated?: boolean | string
}

/**
 * Register a yargs `CommandModule` whose implementation module is loaded
 * lazily. The metadata above ships eagerly so `--help`, completion, and argv
 * matching cost nothing extra; the first invocation of `builder` or `handler`
 * triggers a single shared `load()` that subsequent calls reuse.
 *
 * If `load()` rejects (e.g. a missing chunk in a compiled binary) the error
 * is rewrapped with the command name so the failure points at the right call
 * site instead of an anonymous dynamic-import frame.
 */
export function lazy<U = unknown>(
  meta: LazyMeta,
  load: () => Promise<CommandModule<unknown, U>>,
): CommandModule<unknown, U> {
  let cached: Promise<CommandModule<unknown, U>> | undefined
  const get = () =>
    (cached ??= load().catch((cause: unknown) => {
      const name = typeof meta.command === "string" ? meta.command : meta.command[0]
      throw new Error(`Failed to lazy-load command "${name}"`, { cause })
    }))

  return {
    command: meta.command,
    aliases: meta.aliases,
    describe: meta.describe,
    deprecated: meta.deprecated,
    builder: async (yargs: Argv): Promise<Argv<U>> => {
      const mod = await get()
      const builder = mod.builder
      if (typeof builder === "function") return builder(yargs)
      // Object-builder form: yargs treats `{ [k]: Options }` as shorthand for
      // `.options(b)`. The loaded module already constrains `U`; yargs' public
      // types just cannot express that relationship back out here.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      if (builder) return yargs.options(builder) as Argv<U>
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      return yargs as Argv<U>
    },
    handler: async (args: ArgumentsCamelCase<U>): Promise<void> => {
      const mod = await get()
      await mod.handler(args)
    },
  }
}

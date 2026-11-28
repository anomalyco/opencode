import { ConfigFlag } from "@opencode/schema/config/flag"

/**
 * Whether feature flag `key` is on in this TUI. It resolves like the server's `Flag.resolve`, but from the TUI's own
 * settings: `OPENCODE_FLAGS` (`key` or `-key`, then `all`), then `experimental.<key>` and then `experimental.all_flags`
 * in the TUI config, then on in local and dev builds. An opt-in-only flag skips `all`, `all_flags` and the build
 * default, so only its own name turns it on, and a local-only flag is off outside local and dev builds whatever sets it.
 * The server resolves the same key from its own config, so the two can differ.
 */
export function flagEnabled(input: {
  readonly key: ConfigFlag.Key
  readonly experimental: Readonly<Record<string, boolean>> | undefined
  readonly channel: string
  readonly overrides: string | undefined
}) {
  if (ConfigFlag.localOnly.has(input.key) && !ConfigFlag.onByDefault(input.channel)) return false
  const optInOnly = ConfigFlag.optInOnly.has(input.key)
  const env = ConfigFlag.overrides(input.overrides)
  const override = env.get(input.key) ?? (env.get(ConfigFlag.wildcard) === true && !optInOnly ? true : undefined)
  if (override !== undefined) return override
  return (
    input.experimental?.[input.key] ??
    (!optInOnly && (input.experimental?.all_flags === true || ConfigFlag.onByDefault(input.channel)))
  )
}

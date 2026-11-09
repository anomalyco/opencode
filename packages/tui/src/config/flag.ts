import { ConfigFlag } from "@opencode/schema/config/flag"

/**
 * Whether feature flag `key` is on in this TUI. It resolves like the server's `Flag.resolve`, but from the TUI's own
 * settings: `OPENCODE_FLAGS` (`-key`, then `all`), then `experimental.<key>` and then `experimental.all_flags` in the
 * TUI config, then on in local and dev builds. The server resolves the same key from its own config, so the two can
 * differ.
 */
export function flagEnabled(input: {
  readonly key: ConfigFlag.Key
  readonly experimental: Readonly<Record<string, boolean>> | undefined
  readonly channel: string
  readonly overrides: string | undefined
}) {
  const env = new Map(
    (input.overrides ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item): [string, boolean] => (item.startsWith("-") ? [item.slice(1), false] : [item, true])),
  )
  const override = env.get(input.key) ?? (env.get(ConfigFlag.wildcard) === true ? true : undefined)
  if (override !== undefined) return override
  return (
    input.experimental?.[input.key] ??
    (input.experimental?.all_flags === true || input.channel === "local" || input.channel === "dev")
  )
}

import { markRedacted, REDACTED, redactSecrets } from "@opencode/util/redact"

// `service set <key> <value>` and `service set env <name> <value>` carry secrets such as the password or a provider
// key; keep values out of the logged arguments. Flags and their values may come first, so find the pair anywhere.
// Redact known token formats and URL userinfo from all remaining arguments as well.
export function loggedArgs(args: ReadonlyArray<string>): string[] {
  const set = args.findIndex((arg, index) => arg === "service" && args[index + 1] === "set")
  const kept = set === -1 ? args.length : set + (args[set + 2] === "env" ? 4 : 3)
  return markRedacted(args.map((arg, index) => (index < kept ? redactSecrets(arg) : REDACTED)))
}

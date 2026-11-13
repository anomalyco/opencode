import { Flag } from "effect/cli"

// `--name` and `--name=` parse as `true`, `--name=value` as the value. Like git's `--color[=when]`, the value must be
// attached with `=`: the next argument is never consumed, so `opencode run -w "fix it"` keeps "fix it" positional.
export function optionalValue(name: string, metavar: string) {
  return Flag.String(name).pipe(
    Flag.withOptionalValue(""),
    Flag.withMetavar(metavar),
    Flag.map((value): string | true => value || true),
    Flag.optional,
  )
}

export * as CliFlag from "./flag"

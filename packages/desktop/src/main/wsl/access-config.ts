import type { WslServerAccessConfig } from "../../preload/types"
import { Option, Schema } from "effect"

const WslServerPort = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65535))

const WslServerAccessConfigSchema = Schema.Struct({
  port: Schema.optional(Schema.NullOr(WslServerPort)),
  username: Schema.optional(Schema.NullOr(Schema.String)),
  password: Schema.optional(Schema.NullOr(Schema.String)),
})

const decodeWslServerAccessConfigOption = Schema.decodeUnknownOption(WslServerAccessConfigSchema)
const decodeWslServerAccessConfigSync = Schema.decodeUnknownSync(WslServerAccessConfigSchema)

export function decodeWslServerAccessConfig(input: unknown = {}) {
  return cleanAccessConfig(decodeWslServerAccessConfigSync(input ?? {}))
}

export function decodePersistedWslServerAccessConfig(input: unknown) {
  return cleanAccessConfig(Option.getOrElse(decodeWslServerAccessConfigOption(input), () => ({})))
}

function cleanAccessConfig(input: WslServerAccessConfig) {
  const port = input.port ?? undefined
  const username = input.username?.trim()
  const password = input.password?.trim()
  return {
    ...(port === undefined ? {} : { port }),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  }
}

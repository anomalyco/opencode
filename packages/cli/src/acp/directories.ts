import { isAbsolute, join, resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import type { OpenCodeClient } from "@opencode/client/effect"
import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Option, Schema } from "effect"
import { ACPClient } from "./client"
import { ACPError } from "./error"

const key = "opencode.acp.additionalDirectories"
const decodeStored = Schema.decodeUnknownOption(Schema.Array(Schema.String))

// Permission resources treat `*` and `?` as wildcards.
export const parse = Effect.fnUntraced(function* (cwd: string, directories: readonly string[] = []) {
  const invalid = directories.find((directory) => !isAbsolute(directory) || /[*?]/.test(directory))
  if (invalid !== undefined) return yield* new ACPError.InvalidAdditionalDirectoryError({ directory: invalid })
  const root = FSUtil.resolve(cwd)
  return [...new Set(directories.map((directory) => resolve(FSUtil.windowsPath(directory))))].filter(
    (directory) => FSUtil.resolve(directory) !== root,
  )
})

export function grant(directories: readonly string[]) {
  if (directories.length === 0) return {}
  return { permissions: rules(directories), metadata: { [key]: [...directories] } }
}

export function list(session: Pick<Session.Info, "metadata">) {
  return [...Option.getOrElse(decodeStored(session.metadata?.[key]), () => [])]
}

export const activate = Effect.fnUntraced(function* (
  client: OpenCodeClient,
  session: Session.Info,
  directories: readonly string[],
) {
  const previous = list(session)
  const owned = rules(previous)
  const current = session.permissions ?? []
  // ACP rules lead so the session's other rules keep precedence for the same paths.
  const permissions = [
    ...rules(directories),
    ...current.filter((rule) => !owned.some((item) => isDeepStrictEqual(item, rule))),
  ]
  const metadata: Session.Metadata = {
    ...Object.fromEntries(Object.entries(session.metadata ?? {}).filter(([name]) => name !== key)),
    ...(directories.length > 0 ? { [key]: [...directories] } : {}),
  }
  const permissionsChanged = !isDeepStrictEqual(permissions, current)
  const metadataChanged = !isDeepStrictEqual(previous, directories)
  if (!permissionsChanged && !metadataChanged) return
  yield* client.session
    .update({
      sessionID: session.id,
      ...(permissionsChanged ? { permissions } : {}),
      ...(metadataChanged ? { metadata } : {}),
    })
    .pipe(Effect.catch(ACPClient.classify))
})

// Tools compare the written path without following symlinks, so both spellings of a root are granted.
function rules(directories: readonly string[]): Permission.Rule[] {
  return [...new Set(directories.flatMap((directory) => [directory, FSUtil.resolve(directory)]))].map((directory) => ({
    action: "external_directory",
    resource: join(directory, "*"),
    effect: "allow",
  }))
}

export * as ACPDirectories from "./directories"

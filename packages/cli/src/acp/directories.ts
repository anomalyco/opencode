import { isAbsolute, join, resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import type { OpenCodeClient, PermissionRule, SessionInfo, SessionMetadata } from "@opencode/client/promise"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Option, Schema } from "effect"
import { ACPError } from "./error"
import { ACPPromise } from "./promise"

const key = "opencode.acp.additionalDirectories"
const decodeStored = Schema.decodeUnknownOption(Schema.Array(Schema.String))

/**
 * Normalizes additional workspace roots without following symlinks, keeping the spelling tools will see, and
 * drops duplicates and roots that resolve to cwd. Glob characters are rejected because permission resources
 * would treat them as wildcards. The ACP SDK has already dropped entries that are not strings and replaced a
 * value that is not an array with `[]`.
 */
export const parse = Effect.fnUntraced(function* (cwd: string, directories: readonly string[] = []) {
  const invalid = directories.find((directory) => !isAbsolute(directory) || /[*?]/.test(directory))
  if (invalid !== undefined) return yield* new ACPError.InvalidAdditionalDirectoryError({ directory: invalid })
  const root = FSUtil.resolve(cwd)
  return [...new Set(directories.map((directory) => resolve(FSUtil.windowsPath(directory))))].filter(
    (directory) => FSUtil.resolve(directory) !== root,
  )
})

/** Session create fields that grant these directories. */
export function grant(directories: readonly string[]) {
  if (directories.length === 0) return {}
  return { permissions: rules(directories), metadata: { [key]: [...directories] } }
}

/** The additional directories ACP last activated for the session, in request order. */
export function list(session: Pick<SessionInfo, "metadata">) {
  return [...Option.getOrElse(decodeStored(session.metadata?.[key]), () => [])]
}

/**
 * Replaces the rules granted for the previously activated directories with grants for these directories.
 * Grants persist on the server session, so they also apply when it is used from other clients, and child
 * sessions copy them when they are created; a child created earlier keeps roots its parent later dropped.
 * Session rules are evaluated after agent and config rules, so a grant overrides config `external_directory`
 * rules inside the root, while read, edit, and shell rules still apply.
 */
export const activate = Effect.fnUntraced(function* (
  client: OpenCodeClient,
  session: SessionInfo,
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
  const metadata: SessionMetadata = {
    ...Object.fromEntries(Object.entries(session.metadata ?? {}).filter(([name]) => name !== key)),
    ...(directories.length > 0 ? { [key]: [...directories] } : {}),
  }
  const permissionsChanged = !isDeepStrictEqual(permissions, current)
  const metadataChanged = !isDeepStrictEqual(previous, directories)
  if (!permissionsChanged && !metadataChanged) return
  yield* ACPPromise.promise(() =>
    client.session.update({
      sessionID: session.id,
      ...(permissionsChanged ? { permissions } : {}),
      ...(metadataChanged ? { metadata } : {}),
    }),
  )
})

// Tools compare the written path without following symlinks, so both spellings of a root are granted.
function rules(directories: readonly string[]): PermissionRule[] {
  return [...new Set(directories.flatMap((directory) => [directory, FSUtil.resolve(directory)]))].map((directory) => ({
    action: "external_directory",
    resource: join(directory, "*"),
    effect: "allow",
  }))
}

export * as ACPDirectories from "./directories"

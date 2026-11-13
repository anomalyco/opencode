import { Option, Schema } from "effect"
import type { Extension } from "electron"

const ManifestAction = Schema.Struct({
  default_title: Schema.optional(Schema.String),
  default_popup: Schema.optional(Schema.String),
})

const Command = Schema.Struct({ description: Schema.optional(Schema.String) })

// Lists keep any entry, so an unusual value never makes the rest of a manifest unreadable.
const Fields = Schema.Struct({
  manifest_version: Schema.optional(Schema.Number),
  permissions: Schema.optional(Schema.Array(Schema.Unknown)),
  host_permissions: Schema.optional(Schema.Array(Schema.Unknown)),
  action: Schema.optional(ManifestAction),
  browser_action: Schema.optional(ManifestAction),
  page_action: Schema.optional(ManifestAction),
  icons: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  commands: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

const decode = Schema.decodeUnknownOption(Fields)

/**
 * What the extension APIs read from an extension's manifest, decoded in this one place: its manifest version, the
 * permissions it requires, the host patterns it has access to (Manifest V2 lists them among its permissions), its
 * toolbar button, its icons by size and its commands.
 */
export type ApiManifest = {
  readonly version: number | undefined
  readonly permissions: readonly string[]
  readonly hosts: readonly string[]
  readonly action: typeof ManifestAction.Type | undefined
  readonly icons: Readonly<Record<string, string>>
  readonly commands: readonly { readonly name: string; readonly description: string }[]
}

export function apiManifest(manifest: unknown): ApiManifest {
  const fields = Option.getOrUndefined(decode(manifest))
  const permissions = (fields?.permissions ?? []).filter(Schema.is(Schema.String))
  const hosts = (fields?.host_permissions ?? []).filter(Schema.is(Schema.String))

  return {
    version: fields?.manifest_version,
    permissions,
    hosts: [...hosts, ...permissions.filter((item) => item.includes("://") || item === "<all_urls>")],
    action: fields?.action ?? fields?.browser_action ?? fields?.page_action,
    icons: fields?.icons ?? {},
    commands: Object.entries(fields?.commands ?? {}).map(([name, command]) => ({
      name,
      description: Schema.is(Command)(command) ? (command.description ?? "") : "",
    })),
  }
}

/** Reads an extension's `ApiManifest`, once per extension and version. */
export type Manifests = (extension: Pick<Extension, "id" | "version" | "manifest">) => ApiManifest

export function createManifests(): Manifests {
  const known = new Map<string, ApiManifest>()

  return (extension) => {
    const key = `${extension.id}\n${extension.version}`
    const cached = known.get(key)

    if (cached) return cached
    const value = apiManifest(extension.manifest)
    known.set(key, value)

    return value
  }
}

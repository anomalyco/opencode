import type { Extension } from "electron"
import { Option, Schema } from "effect"
import { globMatch, matchesHost } from "./match-pattern"

const Group = Schema.Struct({ resources: Schema.Array(Schema.String), matches: Schema.optional(Schema.Array(Schema.String)), use_dynamic_url: Schema.optional(Schema.Boolean) })

const Manifest = Schema.Struct({ manifest_version: Schema.Number, web_accessible_resources: Schema.optional(Schema.Array(Schema.Unknown)) })

/** A main-process load has no Chromium initiator. Never lend it browser privileges on behalf of a frame or API caller. */
export function extensionResource(raw: string, origin: string, lookup: (id: string) => Pick<Extension, "manifest"> | null | undefined) {
  const target = URL.parse(raw)

  if (target?.protocol !== "chrome-extension:" || target.username || target.password || target.port) return false
  const extension = lookup(target.hostname)

  if (!extension) return false
  const from = URL.parse(origin)

  if (from?.protocol === "chrome-extension:") return from.host === target.host

  if (!from || !["https:", "http:"].includes(from.protocol)) return false
  // Match only unambiguous package paths. Encoded separators, alternate streams and native path aliases must not
  // turn a public path into a different file once Chromium hands it to the filesystem.
  const file = target.pathname.slice(1)

  if (!file || /[%\\:~]/.test(file) || file.split("/").some((segment) => !segment || /[. ]$/.test(segment))) return false
  const manifest = Option.getOrUndefined(Schema.decodeUnknownOption(Manifest)(extension.manifest))

  if (!manifest) return false
  const resource = (pattern: string) => globMatch(pattern.replace(/^\//, ""), file)

  return (manifest.web_accessible_resources ?? []).some((entry) => manifest.manifest_version === 2
    ? Schema.is(Schema.String)(entry) && resource(entry)
    : manifest.manifest_version === 3 && Schema.is(Group)(entry) && !entry.use_dynamic_url &&
      matchesHost(entry.matches ?? [], from.origin + "/") && entry.resources.some(resource))
}

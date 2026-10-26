import { Schema } from "effect"
import { ExtensionError } from "./error"

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

const path = text(1_024)

/** `manifest.json` at the root of an installed extension archive. */
export const Manifest = Schema.Struct({
  schema: Schema.Literal("opencode.gui-extension/1"),
  id: text(128).check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/)),
  name: text(256),
  version: text(128),
  /** CommonJS bundle the renderer host evaluates. */
  renderer: path,
  /** CommonJS bundle the main host evaluates; it exports `default` (the setup) and optionally `i18n`. */
  main: Schema.optionalKey(path),
  style: Schema.optionalKey(path),
  /** Modules each bundle may `require`; the hosts supply them. */
  imports: Schema.Struct({
    renderer: Schema.Array(Schema.String),
    main: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
})

export type Manifest = typeof Manifest.Type

export const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest))

/** Archive paths are relative, slash-separated, and never climb out of the archive. */
export function archivePath(value: string) {
  if (
    !value ||
    value.includes("\\") ||
    value.includes(":") ||
    /[\u0000-\u001f]/.test(value) ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new ExtensionError("invalidPath")

  return value
}

import * as Schema from "effect/Schema"
import { EndpointCompatibility } from "../simulation/connector.js"

const absolutePathCheck = Schema.makeFilter<string>(
  (path) => isAbsolutePath(path),
  { expected: "an absolute POSIX or Windows path without NUL bytes" },
)

/** A fully rooted POSIX or Windows filesystem path. */
export const AbsolutePath = Schema.String.check(absolutePathCheck).pipe(
  Schema.brand("OpenCodeDrive.AbsolutePath"),
)
export type AbsolutePath = typeof AbsolutePath.Type

/** The compact evidence returned after a Drive run settles. */
export const RunReport = Schema.Struct({
  artifacts: AbsolutePath,
  retained: Schema.Boolean,
  recordings: Schema.Array(AbsolutePath),
  compatibility: Schema.Array(EndpointCompatibility),
})
export interface RunReport extends Schema.Schema.Type<typeof RunReport> {}

export const decodeAbsolutePath = Schema.decodeUnknownEffect(AbsolutePath)
export const decodeRunReport = Schema.decodeUnknownEffect(RunReport)

function isAbsolutePath(path: string): boolean {
  if (path.length === 0 || path.includes("\0")) return false
  if (path.startsWith("/")) return true
  if (/^[A-Za-z]:[\\/]/.test(path)) return true
  if (/^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(path)) return true
  return /^\\\\[?.]\\(?:[A-Za-z]:\\|UNC\\[^\\]+\\[^\\]+(?:\\|$))/.test(
    path,
  )
}

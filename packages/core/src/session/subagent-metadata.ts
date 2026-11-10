export * as SubagentMetadata from "./subagent-metadata.js"

import type { SessionSchema } from "./schema.js"

/** Per-link switch for reporting a subagent's idle transition to its parent. */
export const KEY = "subagent.notify"

/** Absence means loud: only an explicit `false` silences the link. */
export function notify(metadata: SessionSchema.Metadata | undefined): boolean {
  return metadata?.[KEY] !== false
}

/**
 * Strips the per-link switch when metadata moves to a child or fork. Host
 * annotations belong to the family, but a silent link must not silence the
 * sessions created beneath it.
 */
export function inherit(metadata: SessionSchema.Metadata | undefined): SessionSchema.Metadata | undefined {
  if (metadata === undefined || !Object.hasOwn(metadata, KEY)) return metadata
  const { [KEY]: _notify, ...rest } = metadata
  return Object.keys(rest).length === 0 ? undefined : rest
}

/** Writes the switch, keeping default-loud sessions free of redundant keys. */
export function apply(
  metadata: SessionSchema.Metadata | undefined,
  value: boolean,
): SessionSchema.Metadata | undefined {
  if (value === false) return { ...metadata, [KEY]: false }
  return inherit(metadata)
}

/** Metadata for a child created from `metadata` with the requested link state. */
export function withNotify(
  metadata: SessionSchema.Metadata | undefined,
  value: boolean,
): SessionSchema.Metadata | undefined {
  return apply(inherit(metadata), value)
}

/**
 * Metadata to persist with `sessions.setMetadata` on an existing session.
 * `undefined` means the requested state already holds, so the caller can skip
 * the write; `{}` clears the last key.
 */
export function update(
  metadata: SessionSchema.Metadata | undefined,
  value: boolean,
): SessionSchema.Metadata | undefined {
  if (notify(metadata) === value) return undefined
  return apply(metadata, value) ?? {}
}

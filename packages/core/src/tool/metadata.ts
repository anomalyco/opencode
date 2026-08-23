/**
 * Permission metadata is persisted and served as JSON, so absent optional
 * fields must be omitted rather than stored as `undefined`.
 */
export function jsonMetadata(fields: Record<string, string | number | undefined>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string | number] => entry[1] !== undefined),
  )
}

export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

// Decide the next `time.archived` value when toggling a session. A non-null current
// timestamp means the session is archived, so toggling clears it (unarchive); otherwise
// we stamp `now` to archive. Guard with `!= null` so an epoch-zero timestamp still counts
// as archived rather than collapsing into the active bucket.
export function nextArchivedAt(current: number | null | undefined, now: number) {
  return current != null ? null : now
}

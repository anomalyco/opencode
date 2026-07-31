const pattern = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function sessionTitle(title?: string, parentID?: string) {
  if (!title) return parentID ? "Child session" : "New session"
  const match = title.match(pattern)
  return match?.[1] ?? title
}

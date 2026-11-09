export function arrayMove<T>(items: T[], from: number, to: number) {
  if (from === to) return items

  const next = items.slice()
  next.splice(to, 0, ...next.splice(from, 1))

  return next
}

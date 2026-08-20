export function formatTaskSubtitle(value: string | undefined, isAsync: boolean) {
  if (!value || !isAsync) return value
  return `${value} (async)`
}

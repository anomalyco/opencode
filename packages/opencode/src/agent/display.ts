const LEADING_INVISIBLE_SORT_PREFIX = /^[\u200B\u200C\u200D\uFEFF]+/

export function displayName(name: string) {
  const next = name.replace(LEADING_INVISIBLE_SORT_PREFIX, "")
  return next.length === 0 ? name : next
}

export function mention(name: string) {
  return `@${displayName(name)}`
}

export function title(name: string) {
  return displayName(name).replace(/\b\w/g, (c) => c.toUpperCase())
}

export * as AgentDisplay from "./display"

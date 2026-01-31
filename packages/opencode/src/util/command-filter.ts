export function compileCommandFilter(list?: string[]) {
  if (!list || list.length === 0) return [] as RegExp[]
  return list.map((pattern) => new RegExp(pattern))
}

export function isCommandHidden(names: string[], rules: RegExp[]) {
  if (rules.length === 0) return false
  return rules.some((rule) => names.some((name) => rule.test(name)))
}

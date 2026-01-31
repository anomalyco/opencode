import { isCommandHidden } from "@/util/command-filter"

type Slash = { name: string; aliases?: string[] }
type Option = { value: string; slash?: Slash }

export function commandNames(option: Option) {
  const base = option.slash?.name ?? option.value
  const aliases = option.slash?.aliases ?? []
  return [base, ...aliases]
}

export function isCommandAllowed(option: Option, rules: RegExp[]) {
  if (rules.length === 0) return true
  return !isCommandHidden(commandNames(option), rules)
}

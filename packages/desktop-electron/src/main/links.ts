import { statSync } from "node:fs"

export function projectLink(input: string) {
  const stat = statSync(input, { throwIfNoEntry: false })
  if (!stat?.isDirectory()) return
  return `opencode://open-project?directory=${encodeURIComponent(input)}`
}

export function projectLinks(input: string[]) {
  return input.map(projectLink).filter((link): link is string => !!link)
}

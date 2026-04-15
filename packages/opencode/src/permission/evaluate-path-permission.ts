import path from "path"
import { minimatch } from "minimatch"
import { Wildcard } from "@/util"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

function normalizeForGlob(input: string) {
  return input.replaceAll("\\", "/")
}

export function evaluatePathPermission(
  permission: string,
  paths: { absolutePath: string; relativePath: string },
  ...rulesets: Rule[][]
): Rule {
  const rules = rulesets.flat()
  const match = rules.findLast((rule) => {
    if (!Wildcard.match(permission, rule.permission)) return false
    // As an exception to the proper globbing rules, treat "*" as meaning 'match *any* file or directory'.
    if (rule.pattern === "*") return true
    const filepath = path.isAbsolute(rule.pattern) ? paths.absolutePath : paths.relativePath
    return minimatch(normalizeForGlob(filepath), normalizeForGlob(rule.pattern))
  })
  return match ?? { action: "ask", permission, pattern: "*" }
}

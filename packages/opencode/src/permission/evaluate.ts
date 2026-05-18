import { Wildcard } from "@/util/wildcard"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export function evaluate(permission: string, pattern: string | string[], ...rulesets: Rule[][]): Rule {
  const candidates = Array.isArray(pattern) ? pattern : [pattern]
  const rules = rulesets.flat()
  const match = rules.findLast(
    (rule) =>
      Wildcard.match(permission, rule.permission) && candidates.some((c) => Wildcard.match(c, rule.pattern)),
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}

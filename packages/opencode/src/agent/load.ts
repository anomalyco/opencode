import { Config } from "@/config/config"
import { Permission } from "@/permission"
import BUG_REPORT_PROMPT from "./prompt/bug-report.txt"
import { helperAgent } from "./helper-agent"
import { primitive } from "./primitive"
import { sub } from "./sub"
import { from } from "./permission"

const agents = {
  ...helperAgent,
  ...primitive,
  ...sub,
}

export function agentPermissionDefaults() {
  return {
    "atlas-plan-follow": "deny",
    "main-plan": "deny",
    task_async: "deny",
  } as const satisfies Config.Permission
}

export function loadAgents(input: { defaults: Permission.Ruleset; user: Permission.Ruleset }) {
  return Object.fromEntries(
    Object.values(agents).map((item) => [
      item.name,
      (() => {
        const permission = Permission.merge(
          input.defaults,
          from(item.permission),
          Permission.fromConfig({ bug_report: "allow" }),
          input.user,
        )
        const bugReportAllowed = Permission.evaluate("bug_report", "*", permission).action === "allow"
        return {
          ...item,
          options: item.options ?? {},
          permission,
          prompt: bugReportAllowed && item.prompt ? `${item.prompt}\n\n${BUG_REPORT_PROMPT}` : item.prompt,
        }
      })(),
    ]),
  )
}

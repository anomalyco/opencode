import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { PermissionNext } from "@/permission/next"
import { Agent } from "@/agent/agent"

export const PermissionCommand = cmd({
  command: "permission [agent]",
  describe: "show all permissions with sources",
  builder: (yargs) =>
    yargs.positional("agent", {
      describe: "agent name (default: build)",
      type: "string",
      default: "build",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const agent = args.agent as string

      console.log(`\n=== Permission Report for Agent: ${agent} ===\n`)

      const allPerms = await PermissionNext.all(agent)

      // Group by source
      const bySource = {
        default: [] as PermissionNext.RuleWithSource[],
        global: [] as PermissionNext.RuleWithSource[],
        project: [] as PermissionNext.RuleWithSource[],
        session: [] as PermissionNext.RuleWithSource[],
      }

      for (const rule of allPerms) {
        bySource[rule.source].push(rule)
      }

      // Print by source
      for (const [source, rules] of Object.entries(bySource)) {
        if (rules.length === 0) continue

        console.log(`\n[${source.toUpperCase()}] - ${rules.length} rules:`)
        console.log("─".repeat(60))

        // Group by permission type
        const byPermission = new Map<string, PermissionNext.RuleWithSource[]>()
        for (const rule of rules) {
          if (!byPermission.has(rule.permission)) {
            byPermission.set(rule.permission, [])
          }
          byPermission.get(rule.permission)!.push(rule)
        }

        for (const [permission, perms] of byPermission) {
          console.log(`\n  ${permission}:`)
          for (const perm of perms) {
            const icon = perm.action === "allow" ? "✓" : perm.action === "deny" ? "✗" : "?"
            const readonly = perm.readonly ? "[readonly]" : "[editable]"
            console.log(`    ${icon} ${perm.action.padEnd(5)} ${perm.pattern.padEnd(30)} ${readonly}`)
          }
        }
      }

      console.log(`\n\nTotal rules: ${allPerms.length}`)
      console.log("  Default:  ", bySource.default.length)
      console.log("  Global:   ", bySource.global.length)
      console.log("  Project:  ", bySource.project.length)
      console.log("  Session:  ", bySource.session.length)
    })
  },
})

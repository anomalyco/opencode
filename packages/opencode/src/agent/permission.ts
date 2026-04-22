import { Config } from "@/config/config"
import { agentPermissionGroups } from "@/permission/groups"
import { Permission } from "@/permission"

export function from(permission?: Config.Permission) {
  const seen = new Set<string>()
  const groups: Record<string, readonly string[]> = agentPermissionGroups
  return Permission.fromConfig(permission ?? {}).flatMap((rule) => {
    const group = groups[rule.permission] ?? []
    return [rule.permission, ...group].flatMap((permission) => {
      const key = `${permission}\0${rule.pattern}\0${rule.action}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{
        ...rule,
        permission,
      }]
    })
  })
}

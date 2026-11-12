import type { Key } from "../i18n"

export const methodologyItems = [
  ["methodology.updatesLabel", "methodology.updates"],
  ["methodology.tokensLabel", "methodology.tokens"],
  ["methodology.usersLabel", "methodology.users"],
  ["methodology.costLabel", "methodology.cost"],
  ["methodology.retentionLabel", "methodology.retention"],
  ["methodology.citeLabel", "methodology.cite"],
] as const satisfies readonly (readonly [Key, Key])[]

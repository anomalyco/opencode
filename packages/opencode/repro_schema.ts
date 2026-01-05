import z from "zod"

const PermissionAction = z.enum(["ask", "allow", "deny"])
const PermissionObject = z.record(z.string(), PermissionAction)
const PermissionRule = z.union([PermissionAction, PermissionObject])

const Permission = z
  .object({
    read: PermissionRule.optional(),
    edit: PermissionRule.optional(),
    bash: PermissionRule.optional(),
  })
  .catchall(PermissionRule)
  .or(PermissionAction)

const Agent = z.object({
  permission: Permission.optional(),
})

const Config = z.object({
  agent: z.record(z.string(), Agent).optional(),
})

// Test case 1: Valid object permission
const case1 = {
  agent: {
    plan: {
      permission: {
        edit: { "*.md": "allow" },
      },
    },
  },
}

// Test case 2: Invalid action in object
const case2 = {
  agent: {
    plan: {
      permission: {
        edit: { "*.md": "invalid_action" },
      },
    },
  },
}

// Test case 4: Object passed to Enum-only schema
const EnumOnly = z.object({
  edit: PermissionAction,
})
const case4 = { edit: { "*.md": "allow" } }

console.log("--- Testing Case 1 (Valid Object) ---")
const result1 = Config.safeParse(case1)
if (result1.success) console.log("Success!")
else console.log(JSON.stringify(result1.error.issues, null, 2))

console.log("\n--- Testing Case 2 (Invalid Action in Object) ---")
const result2 = Config.safeParse(case2)
if (result2.success) console.log("Success!")
else console.log(JSON.stringify(result2.error.issues, null, 2))

console.log("\n--- Testing Case 4 (Object passed to Enum-only) ---")
const result4 = EnumOnly.safeParse(case4)
if (result4.success) console.log("Success!")
else console.log(JSON.stringify(result4.error.issues, null, 2))

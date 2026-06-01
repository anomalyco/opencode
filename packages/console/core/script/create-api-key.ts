import { Resource } from "@opencode-ai/console-resource"
import { and, Database, eq, isNull } from "../src/drizzle/index.js"
import { Identifier } from "../src/identifier.js"
import { AccountTable } from "../src/schema/account.sql.js"
import { AuthTable } from "../src/schema/auth.sql.js"
import { BillingTable } from "../src/schema/billing.sql.js"
import { KeyTable } from "../src/schema/key.sql.js"
import { UserTable } from "../src/schema/user.sql.js"
import { WorkspaceTable } from "../src/schema/workspace.sql.js"
import { centsToMicroCents } from "../src/util/price.js"

const args = parseArgs(process.argv.slice(2))
if (!args.email) {
  console.error(
    "Usage: bun script/create-api-key.ts --email <email> [--workspace-id <wrk_...>] [--workspace-name <name>] [--key-name <name>] [--balance-dollars <amount>] [--allow-production]",
  )
  process.exit(1)
}
if (Resource.App.stage === "production" && !args.allowProduction) {
  throw new Error("Refusing to create a production API key without --allow-production")
}

const result = await Database.transaction(async (tx) => {
  const auth = await tx
    .select()
    .from(AuthTable)
    .where(and(eq(AuthTable.provider, "email"), eq(AuthTable.subject, args.email)))
    .then((rows) => rows[0])
  const accountID = auth?.accountID ?? Identifier.create("account")
  if (!auth) {
    await tx.insert(AccountTable).values({ id: accountID })
    await tx.insert(AuthTable).values({
      id: Identifier.create("auth"),
      provider: "email",
      subject: args.email,
      accountID,
    })
  }

  const workspace = args.workspaceID
    ? await tx
        .select()
        .from(WorkspaceTable)
        .where(eq(WorkspaceTable.id, args.workspaceID))
        .then((rows) => rows[0])
    : await tx
        .select({ workspace: WorkspaceTable })
        .from(UserTable)
        .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, UserTable.workspaceID))
        .where(and(eq(UserTable.accountID, accountID), isNull(UserTable.timeDeleted)))
        .then((rows) => rows[0]?.workspace)
  if (args.workspaceID && !workspace) throw new Error(`Workspace not found: ${args.workspaceID}`)
  const workspaceID = workspace?.id ?? Identifier.create("workspace")
  if (!workspace) {
    await tx.insert(WorkspaceTable).values({
      id: workspaceID,
      slug: null,
      name: args.workspaceName ?? `${args.email} manual`,
    })
  }

  const user = await tx
    .select()
    .from(UserTable)
    .where(
      and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.accountID, accountID), isNull(UserTable.timeDeleted)),
    )
    .then((rows) => rows[0])
  const userID = user?.id ?? Identifier.create("user")
  if (!user) {
    await tx.insert(UserTable).values({
      id: userID,
      workspaceID,
      accountID,
      email: args.email,
      name: args.email,
      role: "admin",
    })
  }

  const balance = centsToMicroCents(args.balanceDollars * 100)
  const billing = await tx
    .select()
    .from(BillingTable)
    .where(eq(BillingTable.workspaceID, workspaceID))
    .then((rows) => rows[0])
  if (!billing) {
    await tx.insert(BillingTable).values({
      id: Identifier.create("billing"),
      workspaceID,
      balance,
    })
  } else if (billing.balance < balance) {
    await tx.update(BillingTable).set({ balance }).where(eq(BillingTable.workspaceID, workspaceID))
  }

  const secretKey = createSecretKey()
  const keyID = Identifier.create("key")
  await tx.insert(KeyTable).values({
    id: keyID,
    workspaceID,
    userID,
    name: args.keyName ?? "Manual API Key",
    key: secretKey,
    timeUsed: null,
  })

  return { accountID, workspaceID, userID, keyID, secretKey }
})

console.log(JSON.stringify({ stage: Resource.App.stage, ...result }, null, 2))

function createSecretKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const values = new Uint32Array(64)
  crypto.getRandomValues(values)
  return `sk-${Array.from(values, (value) => chars[value % chars.length]).join("")}`
}

function parseArgs(argv: string[]) {
  const parsed = {
    email: "",
    workspaceID: "",
    workspaceName: "",
    keyName: "",
    balanceDollars: 100,
    allowProduction: false,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--email") parsed.email = requiredValue(argv, ++index, arg)
    if (arg === "--workspace-id") parsed.workspaceID = requiredValue(argv, ++index, arg)
    if (arg === "--workspace-name") parsed.workspaceName = requiredValue(argv, ++index, arg)
    if (arg === "--key-name") parsed.keyName = requiredValue(argv, ++index, arg)
    if (arg === "--balance-dollars") parsed.balanceDollars = Number(requiredValue(argv, ++index, arg))
    if (arg === "--allow-production") parsed.allowProduction = true
  }
  if (!Number.isFinite(parsed.balanceDollars) || parsed.balanceDollars < 0) throw new Error("Invalid --balance-dollars")
  return parsed
}

function requiredValue(argv: string[], index: number, arg: string) {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`)
  return value
}

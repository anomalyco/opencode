import { Resource } from "@opencode-ai/console-resource"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { action, json, query } from "@solidjs/router"
import { withActor } from "~/context/auth.withActor"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { User } from "@opencode-ai/console-core/user.js"
import { and, Database, desc, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"

export function formatDateForTable(date: Date) {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }
  return date.toLocaleDateString(undefined, options).replace(",", ",")
}

export function formatDateUTC(date: Date) {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    timeZone: "UTC",
  }
  return date.toLocaleDateString("en-US", options)
}

export function formatBalance(amount: number) {
  const balance = ((amount ?? 0) / 100000000).toFixed(2)
  return balance === "-0.00" ? "0.00" : balance
}

export async function getLastSeenWorkspaceID() {
  "use server"
  return withActor(async () => {
    const actor = Actor.assert("account")
    return Database.use(async (tx) =>
      tx
        .select({ id: WorkspaceTable.id })
        .from(UserTable)
        .innerJoin(WorkspaceTable, eq(UserTable.workspaceID, WorkspaceTable.id))
        .where(
          and(
            eq(UserTable.accountID, actor.properties.accountID),
            isNull(UserTable.timeDeleted),
            isNull(WorkspaceTable.timeDeleted),
          ),
        )
        .orderBy(desc(UserTable.timeSeen))
        .limit(1)
        .then((x) => x[0]?.id),
    )
  })
}

export const querySessionInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(() => {
    return {
      isAdmin: Actor.userRole() === "admin",
      isBeta: Resource.App.stage === "production" ? workspaceID === "wrk_01K46JDFR0E75SG2Q8K172KF3Y" : true,
    }
  }, workspaceID)
}, "session.get")

export const createCheckoutUrl = action(
  async (workspaceID: string, amount: number, successUrl: string, cancelUrl: string) => {
    "use server"
    return json(
      await withActor(
        () =>
          Billing.generateCheckoutUrl({ amount, successUrl, cancelUrl })
            .then((data) => ({ error: undefined, data }))
            .catch((e) => ({
              error: e.message as string,
              data: undefined,
            })),
        workspaceID,
      ),
    )
  },
  "checkoutUrl",
)

export const queryBillingInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const billing = await Billing.get()
    return {
      ...billing,
      reloadAmount: billing.reloadAmount ?? Billing.RELOAD_AMOUNT,
      reloadAmountMin: Billing.RELOAD_AMOUNT_MIN,
      reloadTrigger: billing.reloadTrigger ?? Billing.RELOAD_TRIGGER,
      reloadTriggerMin: Billing.RELOAD_TRIGGER_MIN,
    }
  }, workspaceID)
}, "billing.get")

import { Resource } from "@opencode-ai/console-resource"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { action, query } from "@solidjs/router"
import { withActor } from "~/context/auth.withActor"
import { Billing } from "@opencode-ai/console-core/billing.js"

export function formatDateForTable(date: Date) {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }
  return date.toLocaleDateString("en-GB", options).replace(",", ",")
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

export const queryIsLoggedIn = query(async () => {
  "use server"
  return withActor(() => {
    try {
      Actor.assert("account")
      return true
    } catch {
      return false
    }
  })
}, "isLoggedIn.get")

export const querySessionInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(() => {
    return {
      isAdmin: Actor.userRole() === "admin",
      isBeta: Resource.App.stage === "production" ? workspaceID === "wrk_01K46JDFR0E75SG2Q8K172KF3Y" : true,
    }
  }, workspaceID)
}, "session.get")

export const createCheckoutUrl = action(async (workspaceID: string, successUrl: string, cancelUrl: string) => {
  "use server"
  return withActor(() => Billing.generateCheckoutUrl({ successUrl, cancelUrl }), workspaceID)
}, "checkoutUrl")

export const queryBillingInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(() => Billing.get(), workspaceID)
}, "billing.get")

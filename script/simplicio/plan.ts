#!/usr/bin/env bun
// Show the current Simplicio plan + upgrade link.
//   bun script/simplicio/plan.ts
//   bun script/simplicio/plan.ts --jwt $TOKEN --secret $SECRET   # verify JWT
//
// Used by the TUI badge and as a debug utility.

import { PLAN_PRICE_USD_MONTH, capabilities, resolvePlan } from "../../packages/simpliciocode/src/billing/gate"

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const plan = await resolvePlan({
  jwt: arg("--jwt"),
  jwtSecret: arg("--secret") ?? process.env.SIMPLICIO_JWT_SECRET,
})
const caps = capabilities(plan)
const label = plan === "pro" ? "Pro" : plan === "plus" ? "Plus" : "Free"
const price = PLAN_PRICE_USD_MONTH[plan]

console.log(`Plan          : ${label}${price > 0 ? ` (US$${price}/mo)` : ""}`)
console.log(`Remote models : ${caps.remoteModels ? "enabled (Simplicio1 Pro gateway)" : "disabled — local Simplicio1 only"}`)
console.log(`Unlimited tok : ${caps.unlimitedTokens ? "yes" : "no"}`)
console.log(`Auto-Sprints  : ${caps.autoSprintWatcher ? "enabled (sendsprint watch)" : "disabled — use /sprint run manually"}`)
console.log(`Manual Sprint : ${caps.manualSprintRun ? "yes" : "no"}`)

if (plan === "free") {
  console.log()
  console.log("Upgrade:")
  console.log("  • SimplicioCode Plus (US$20/mo) — unlimited tokens + Simplicio1 Pro.")
  console.log("  • SimplicioCode Pro  (US$50/mo) — adds Auto-Sprints (sendsprint watch).")
  console.log("  → https://opencode.ai/pricing")
} else if (plan === "plus") {
  console.log()
  console.log("Want Auto-Sprints? Upgrade to Pro: https://opencode.ai/pricing")
}

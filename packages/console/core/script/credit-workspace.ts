import { Billing } from "../src/billing.js"

// get input from command line
const workspaceID = process.argv[2]
const dollarAmount = process.argv[3]

if (!workspaceID || !dollarAmount) {
  console.error("Usage: bun credit-workspace.ts <workspaceID> <dollarAmount>")
  process.exit(1)
}

const amountInDollars = parseFloat(dollarAmount)
if (isNaN(amountInDollars) || amountInDollars <= 0) {
  console.error("Error: dollarAmount must be a positive number")
  process.exit(1)
}

await Billing.grantCredit(workspaceID, amountInDollars)

console.log(`Added payment of $${amountInDollars.toFixed(2)} to workspace ${workspaceID}`)

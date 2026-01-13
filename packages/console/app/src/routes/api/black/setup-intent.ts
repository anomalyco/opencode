import type { APIEvent } from "@solidjs/start/server"
import { Billing } from "@opencode-ai/console-core/billing.js"

export async function POST(event: APIEvent) {
  try {
    const body = (await event.request.json()) as { plan: string }
    const plan = body.plan

    if (!plan || !["20", "100", "200"].includes(plan)) {
      return Response.json({ error: "Invalid plan" }, { status: 400 })
    }

    const amount = parseInt(plan) * 100

    const intent = await Billing.stripe().setupIntents.create({
      payment_method_types: ["card"],
      metadata: {
        plan,
        amount: amount.toString(),
      },
    })

    return Response.json({
      clientSecret: intent.client_secret,
    })
  } catch (error) {
    console.error("Error creating setup intent:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

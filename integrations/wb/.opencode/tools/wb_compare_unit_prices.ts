import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Compare two or more offers using user-supplied prices in RUB and quantities in the same unit.",
  args: {
    unit: tool.schema.enum(["piece", "gram", "milliliter", "meter"]),
    offers: tool.schema
      .array(
        tool.schema.object({
          name: tool.schema.string().regex(/\S/).max(120),
          priceRub: tool.schema.number().min(0).max(1_000_000_000),
          quantity: tool.schema.number().min(0.001).max(1_000_000_000),
        }),
      )
      .min(2)
      .max(20),
  },
  async execute({ unit, offers }) {
    const ranked = offers
      .map((offer) => ({ ...offer, rubPerUnit: offer.priceRub / offer.quantity }))
      .sort((left, right) => left.rubPerUnit - right.rubPerUnit)

    return JSON.stringify({
      status: "success",
      summary: "Offers sorted by rising price per unit",
      next_actions: [],
      artifacts: [],
      unit,
      offers: ranked,
    })
  },
})

import { tool } from "@opencode-ai/plugin"
import { create } from "@finny-ai/integrations/orders"
import { guard } from "../guard"

export const orders = tool({
  description: "Create an order via the finny server",
  args: {
    symbol: tool.schema.string(),
    side: tool.schema.enum(["buy", "sell"]),
    qty: tool.schema.number(),
    type: tool.schema.enum(["market", "limit"]),
    price: tool.schema.number().optional(),
  },
  async execute(args) {
    await guard({ action: "write", name: "orders.create" })
    const data = await create({
      symbol: args.symbol,
      side: args.side,
      qty: args.qty,
      type: args.type,
      price: args.price,
    })
    return JSON.stringify(data, null, 2)
  },
})

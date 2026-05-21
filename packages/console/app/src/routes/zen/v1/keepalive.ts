import { createHash } from "crypto"
import { ZenData } from "@opencode-ai/console-core/model.js"

export async function GET() {
  const zenData = ZenData.list("full")
  return new Response(
    JSON.stringify({
      hash: createHash("sha1").update(JSON.stringify(zenData)).digest("hex"),
      timestamp: Date.now(),
      check1: "alpha-di-k2.6" in zenData.models,
      check2: "qwen3.6-plus-free" in zenData.models,
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  )
}

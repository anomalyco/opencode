// @ts-nocheck
import { env } from "cloudflare:workers"
import { createHash } from "crypto"
import { ZenData } from "@opencode-ai/console-core/model.js"

export async function GET() {
  const zenData = ZenData.list("full")
  return new Response(
    JSON.stringify(
      {
        hash: createHash("sha1").update(JSON.stringify(zenData)).digest("hex"),
        timestamp: Date.now(),
        FOO: env.FOO,
        SST_RESOURCE_FOO: env.SST_RESOURCE_FOO,
        check1: zenData.models["alpha-di-k2.6"],
        check2: zenData.models["qwen3.6-plus-free"],
      },
      null,
      2,
    ),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  )
}

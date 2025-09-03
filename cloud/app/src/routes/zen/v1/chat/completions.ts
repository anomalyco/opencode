import { Resource } from "@opencode/cloud-resource"
import type { APIEvent } from "@solidjs/start/server"
import { Database, eq, sql } from "@opencode/cloud-core/drizzle/index.js"
import { KeyTable } from "@opencode/cloud-core/schema/key.sql.js"
import { BillingTable, UsageTable } from "@opencode/cloud-core/schema/billing.sql.js"
import { centsToMicroCents } from "@opencode/cloud-core/util/price.js"
import { Identifier } from "@opencode/cloud-core/identifier.js"

const MODELS = {
  //  "anthropic/claude-sonnet-4": {
  //    auth: true,
  //    api: "https://api.anthropic.com",
  //    apiKey: Resource.ANTHROPIC_API_KEY.value,
  //    model: "claude-sonnet-4-20250514",
  //    cost: {
  //      input: 0.0000015,
  //      output: 0.000006,
  //      reasoning: 0.0000015,
  //      cacheRead: 0.0000001,
  //      cacheWrite: 0.0000001,
  //    },
  //    headerMappings: {},
  //  },
  "qwen/qwen3-coder": {
    id: "qwen/qwen3-coder",
    auth: true,
    api: "https://inference.baseten.co",
    apiKey: Resource.BASETEN_API_KEY.value,
    model: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    cost: {
      input: 0.00000038,
      output: 0.00000153,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    headerMappings: {},
  },
  "grok-code": {
    id: "x-ai/grok-code-fast-1",
    auth: false,
    api: "https://api.x.ai",
    apiKey: Resource.XAI_API_KEY.value,
    model: "grok-code",
    cost: {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    headerMappings: {
      "x-grok-conv-id": "x-opencode-session",
      "x-grok-req-id": "x-opencode-request",
    },
  },
}

const FREE_WORKSPACES = [
  "wrk_01K46JDFR0E75SG2Q8K172KF3Y", // frank
]

class AuthError extends Error {}
class CreditsError extends Error {}
class ModelError extends Error {}

export async function POST(input: APIEvent) {
  try {
    const url = new URL(input.request.url)
    const body = await input.request.json()
    const MODEL = validateModel()
    const apiKey = await authenticate()
    const isFree = FREE_WORKSPACES.includes(apiKey?.workspaceID ?? "")
    await checkCredits()

    // Request to model provider
    const res = await fetch(new URL(url.pathname.replace(/^\/zen/, "") + url.search, MODEL.api), {
      method: "POST",
      headers: (() => {
        const headers = input.request.headers
        headers.delete("host")
        headers.delete("content-length")
        headers.set("authorization", `Bearer ${MODEL.apiKey}`)
        Object.entries(MODEL.headerMappings ?? {}).forEach(([k, v]) => {
          headers.set(k, headers.get(v)!)
        })
        return headers
      })(),
      body: JSON.stringify({
        ...body,
        model: MODEL.model,
        stream_options: {
          include_usage: true,
        },
      }),
    })

    // Scrub response headers
    const resHeaders = new Headers()
    const keepHeaders = ["content-type", "cache-control"]
    for (const [k, v] of res.headers.entries()) {
      if (keepHeaders.includes(k.toLowerCase())) {
        resHeaders.set(k, v)
      }
    }

    // Handle non-streaming response
    if (!body.stream) {
      const body = await res.json()
      await trackUsage(body)
      return new Response(JSON.stringify(body), {
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
      })
    }

    // Handle streaming response
    const stream = new ReadableStream({
      start(c) {
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        function pump(): Promise<void> {
          return (
            reader?.read().then(async ({ done, value }) => {
              if (done) {
                c.close()
                return
              }

              buffer += decoder.decode(value, { stream: true })

              const parts = buffer.split("\n\n")
              buffer = parts.pop() ?? ""

              const usage = parts
                .map((part) => part.trim())
                .filter((part) => part.startsWith("data: "))
                .map((part) => {
                  try {
                    return JSON.parse(part.slice(6))
                  } catch (e) {
                    return {}
                  }
                })
                .find((part) => part.usage)
              if (usage) await trackUsage(usage)

              c.enqueue(value)

              return pump()
            }) || Promise.resolve()
          )
        }

        return pump()
      },
    })

    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    })

    function validateModel() {
      if (!(body.model in MODELS)) {
        throw new ModelError(`Model ${body.model} not supported`)
      }
      return MODELS[body.model as keyof typeof MODELS]
    }

    async function authenticate() {
      try {
        const authHeader = input.request.headers.get("authorization")
        if (!authHeader || !authHeader.startsWith("Bearer ")) throw new AuthError("Missing API key.")

        const apiKey = authHeader.split(" ")[1]
        const key = await Database.use((tx) =>
          tx
            .select({
              id: KeyTable.id,
              workspaceID: KeyTable.workspaceID,
            })
            .from(KeyTable)
            .where(eq(KeyTable.key, apiKey))
            .then((rows) => rows[0]),
        )

        if (!key) throw new AuthError("Invalid API key.")
        return key
      } catch (e) {
        console.log(e)
        // ignore error if model does not require authentication
        if (!MODEL.auth) return
        throw e
      }
    }

    async function checkCredits() {
      if (!apiKey || !MODEL.auth || isFree) return

      const billing = await Database.use((tx) =>
        tx
          .select({
            balance: BillingTable.balance,
          })
          .from(BillingTable)
          .where(eq(BillingTable.workspaceID, apiKey.workspaceID))
          .then((rows) => rows[0]),
      )

      if (billing.balance <= 0) throw new CreditsError("Insufficient balance")
    }

    async function trackUsage(chunk: any) {
      console.log(`trackUsage ${apiKey}`)

      if (!apiKey) return

      const usage = chunk.usage
      const inputTokens = usage.prompt_tokens ?? 0
      const outputTokens = usage.completion_tokens ?? 0
      const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0
      const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0
      //const cacheWriteTokens = providerMetadata?.["anthropic"]?.["cacheCreationInputTokens"] ?? 0
      const cacheWriteTokens = 0

      const inputCost = MODEL.cost.input * inputTokens
      const outputCost = MODEL.cost.output * outputTokens
      const reasoningCost = MODEL.cost.reasoning * reasoningTokens
      const cacheReadCost = MODEL.cost.cacheRead * cacheReadTokens
      const cacheWriteCost = MODEL.cost.cacheWrite * cacheWriteTokens
      const costInCents = (inputCost + outputCost + reasoningCost + cacheReadCost + cacheWriteCost) * 100
      const cost = isFree ? 0 : centsToMicroCents(costInCents)

      await Database.transaction(async (tx) => {
        await tx.insert(UsageTable).values({
          workspaceID: apiKey.workspaceID,
          id: Identifier.create("usage"),
          model: MODEL.id,
          inputTokens,
          outputTokens,
          reasoningTokens,
          cacheReadTokens,
          cacheWriteTokens,
          cost,
        })
        await tx
          .update(BillingTable)
          .set({
            balance: sql`${BillingTable.balance} - ${cost}`,
          })
          .where(eq(BillingTable.workspaceID, apiKey.workspaceID))
      })

      await Database.use((tx) =>
        tx
          .update(KeyTable)
          .set({ timeUsed: sql`now()` })
          .where(eq(KeyTable.id, apiKey.id)),
      )
    }
  } catch (error: any) {
    if (error instanceof AuthError) {
      return new Response(
        JSON.stringify({
          error: {
            message: error.message,
            type: "invalid_request_error",
            param: null,
            code: "unauthorized",
          },
        }),
        {
          status: 401,
        },
      )
    }

    if (error instanceof CreditsError) {
      return new Response(
        JSON.stringify({
          error: {
            message: error.message,
            type: "insufficient_quota",
            param: null,
            code: "insufficient_quota",
          },
        }),
        {
          status: 401,
        },
      )
    }

    if (error instanceof ModelError) {
      return new Response(JSON.stringify({ error: { message: error.message } }), {
        status: 401,
      })
    }

    console.log(error)
    return new Response(JSON.stringify({ error: { message: error.message } }), {
      status: 500,
    })
  }
}

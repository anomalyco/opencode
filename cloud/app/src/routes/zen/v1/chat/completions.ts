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
    id: "qwen/qwen3-coder" as const,
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
    id: "x-ai/grok-code-fast-1" as const,
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
    logMetric({
      is_tream: !!body.stream,
      session: input.request.headers.get("x-opencode-session"),
      request: input.request.headers.get("x-opencode-request"),
    })
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
      const json = await res.json()
      const body = JSON.stringify(json)
      logMetric({ response_length: body.length })
      await trackUsage(json)
      return new Response(body, {
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
        let responseLength = 0
        let startTimestamp = Date.now()
        let receivedFirstByte = false

        function pump(): Promise<void> {
          return (
            reader?.read().then(async ({ done, value }) => {
              if (done) {
                logMetric({ response_length: responseLength })
                c.close()
                return
              }

              if (!receivedFirstByte) {
                receivedFirstByte = true
                logMetric({ time_to_first_byte: Date.now() - startTimestamp })
              }

              buffer += decoder.decode(value, { stream: true })
              responseLength += value.length

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
      const model = MODELS[body.model as keyof typeof MODELS]
      logMetric({ model: model.id })
      return model
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
        logMetric({
          api_key: key.id,
          workspace: key.workspaceID,
        })
        return key
      } catch (e) {
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
      const usage = chunk.usage
      const inputTokens = usage.prompt_tokens ?? 0
      const outputTokens = usage.completion_tokens ?? 0
      const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0
      const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0
      //const cacheWriteTokens = providerMetadata?.["anthropic"]?.["cacheCreationInputTokens"] ?? 0
      const cacheWriteTokens = 0

      const inputCost = MODEL.cost.input * inputTokens * 100
      const outputCost = MODEL.cost.output * outputTokens * 100
      const reasoningCost = MODEL.cost.reasoning * reasoningTokens * 100
      const cacheReadCost = MODEL.cost.cacheRead * cacheReadTokens * 100
      const cacheWriteCost = MODEL.cost.cacheWrite * cacheWriteTokens * 100
      const totalCostInCent = inputCost + outputCost + reasoningCost + cacheReadCost + cacheWriteCost

      logMetric({
        "tokens.input": inputTokens,
        "tokens.output": outputTokens,
        "tokens.reasoning": reasoningTokens,
        "tokens.cache_read": cacheReadTokens,
        "tokens.cache_write": cacheWriteTokens,
        "cost.input": Math.round(inputCost),
        "cost.output": Math.round(outputCost),
        "cost.reasoning": Math.round(reasoningCost),
        "cost.cache_read": Math.round(cacheReadCost),
        "cost.cache_write": Math.round(cacheWriteCost),
        "cost.total": Math.round(totalCostInCent),
      })

      if (!apiKey) return

      const cost = isFree ? 0 : centsToMicroCents(totalCostInCent)
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
    logMetric({
      "error.type": error.constructor.name,
      "error.message": error.message,
    })

    if (error instanceof AuthError || error instanceof CreditsError || error instanceof ModelError)
      return new Response(JSON.stringify({ error: { message: error.message } }), { status: 401 })

    return new Response(JSON.stringify({ error: { message: error.message } }), { status: 500 })
  }

  function logMetric(values: Record<string, any>) {
    console.log(`_metric:${JSON.stringify(values)}`)
  }
}

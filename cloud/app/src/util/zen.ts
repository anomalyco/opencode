import type { APIEvent } from "@solidjs/start/server"
import { Database, eq, sql } from "@opencode/cloud-core/drizzle/index.js"
import { KeyTable } from "@opencode/cloud-core/schema/key.sql.js"
import { BillingTable, UsageTable } from "@opencode/cloud-core/schema/billing.sql.js"
import { centsToMicroCents } from "@opencode/cloud-core/util/price.js"
import { Identifier } from "@opencode/cloud-core/identifier.js"
import { Resource } from "@opencode/cloud-resource"

export async function handler(
  input: APIEvent,
  opts: {
    transformBody?: (body: any) => any
    parseUsageChunk: (chunk: string) => string | undefined
    buildUsage: (body: any) => {
      inputTokens: number
      outputTokens: number
      reasoningTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
    }
  },
) {
  class AuthError extends Error {}
  class CreditsError extends Error {}
  class ModelError extends Error {}

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
    "gpt-5": {
      id: "gpt-5" as const,
      auth: true,
      api: "https://api.openai.com",
      apiKey: Resource.OPENAI_API_KEY.value,
      model: "gpt-5",
      cost: {
        input: 0.00000125,
        output: 0.00001,
        reasoning: 0.00001,
        cacheRead: 0.000000125,
        cacheWrite: 0,
      },
      headerMappings: {},
    },
    "qwen3-coder": {
      id: "qwen3-coder" as const,
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
    "kimi-k2": {
      id: "kimi-k2" as const,
      auth: true,
      api: "https://inference.baseten.co",
      apiKey: Resource.BASETEN_API_KEY.value,
      model: "moonshotai/Kimi-K2-Instruct-0905",
      cost: {
        input: 0.0000006,
        output: 0.0000025,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      headerMappings: {},
    },
    "grok-code": {
      id: "grok-code" as const,
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
    // deprecated
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
  }

  const FREE_WORKSPACES = [
    "wrk_01K46JDFR0E75SG2Q8K172KF3Y", // frank
  ]

  const logger = {
    metric: (values: Record<string, any>) => {
      console.log(`_metric:${JSON.stringify(values)}`)
    },
    log: console.log,
    debug: (message: string) => {
      if (Resource.App.stage === "production") return
      console.debug(message)
    },
  }

  try {
    const url = new URL(input.request.url)
    const body = await input.request.json()
    logger.debug(JSON.stringify(body))
    logger.metric({
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
        ...(opts.transformBody?.(body) ?? body),
        model: MODEL.model,
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
      logger.metric({ response_length: body.length })
      logger.debug(body)
      await trackUsage(json.usage)
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
                logger.metric({ response_length: responseLength })
                c.close()
                return
              }

              if (!receivedFirstByte) {
                receivedFirstByte = true
                logger.metric({ time_to_first_byte: Date.now() - startTimestamp })
              }

              buffer += decoder.decode(value, { stream: true })
              responseLength += value.length

              const parts = buffer.split("\n\n")
              buffer = parts.pop() ?? ""

              for (const part of parts) {
                logger.debug(part)
                const usage = opts.parseUsageChunk(part.trim())
                if (usage) await trackUsage(usage)
              }

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
      logger.metric({ model: model.id })
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
        logger.metric({
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

    async function trackUsage(usage: any) {
      const { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens } = opts.buildUsage(usage)

      const inputCost = MODEL.cost.input * inputTokens * 100
      const outputCost = MODEL.cost.output * outputTokens * 100
      const reasoningCost = MODEL.cost.reasoning * reasoningTokens * 100
      const cacheReadCost = MODEL.cost.cacheRead * cacheReadTokens * 100
      const cacheWriteCost = MODEL.cost.cacheWrite * cacheWriteTokens * 100
      const totalCostInCent = inputCost + outputCost + reasoningCost + cacheReadCost + cacheWriteCost

      logger.metric({
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
    logger.metric({
      "error.type": error.constructor.name,
      "error.message": error.message,
    })

    if (error instanceof AuthError || error instanceof CreditsError || error instanceof ModelError)
      return new Response(JSON.stringify({ error: { message: error.message } }), { status: 401 })

    return new Response(JSON.stringify({ error: { message: error.message } }), { status: 500 })
  }
}

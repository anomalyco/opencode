import type { APIEvent } from "@solidjs/start/server"
import path from "node:path"
import { and, Database, eq, isNull, lt, or, sql } from "@opencode/cloud-core/drizzle/index.js"
import { KeyTable } from "@opencode/cloud-core/schema/key.sql.js"
import { BillingTable, PaymentTable, UsageTable } from "@opencode/cloud-core/schema/billing.sql.js"
import { centsToMicroCents } from "@opencode/cloud-core/util/price.js"
import { Identifier } from "@opencode/cloud-core/identifier.js"
import { Resource } from "@opencode/cloud-resource"
import { Billing } from "../../../../core/src/billing"
import { Actor } from "@opencode/cloud-core/actor.js"

type ModelCost = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite5m?: number
  cacheWrite1h?: number
}

type Model = {
  id: string
  auth: boolean
  cost: ModelCost | ((usage: any) => ModelCost)
  headerMappings: Record<string, string>
  providers: Record<
    string,
    {
      api: string
      apiKey: string
      model: string
      weight?: number
    }
  >
}

export async function handler(
  input: APIEvent,
  opts: {
    modifyBody?: (body: any) => any
    setAuthHeader: (headers: Headers, apiKey: string) => void
    parseApiKey: (headers: Headers) => string | undefined
    onStreamPart: (chunk: string) => void
    getStreamUsage: () => any
    normalizeUsage: (body: any) => {
      inputTokens: number
      outputTokens: number
      reasoningTokens?: number
      cacheReadTokens?: number
      cacheWrite5mTokens?: number
      cacheWrite1hTokens?: number
    }
  },
) {
  class AuthError extends Error {}
  class CreditsError extends Error {}
  class MonthlyLimitError extends Error {}
  class ModelError extends Error {}

  const MODELS: Record<string, Model> = {
    "claude-opus-4-1": {
      id: "claude-opus-4-1" as const,
      auth: true,
      cost: {
        input: 0.000015,
        output: 0.000075,
        cacheRead: 0.0000015,
        cacheWrite5m: 0.00001875,
        cacheWrite1h: 0.00003,
      },
      headerMappings: {},
      providers: {
        anthropic: {
          api: "https://api.anthropic.com",
          apiKey: Resource.ANTHROPIC_API_KEY.value,
          model: "claude-opus-4-1-20250805",
        },
      },
    },
    "claude-sonnet-4": {
      id: "claude-sonnet-4" as const,
      auth: true,
      cost: (usage: any) => {
        const totalInputTokens =
          usage.inputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens
        return totalInputTokens <= 200_000
          ? {
              input: 0.000003,
              output: 0.000015,
              cacheRead: 0.0000003,
              cacheWrite5m: 0.00000375,
              cacheWrite1h: 0.000006,
            }
          : {
              input: 0.000006,
              output: 0.0000225,
              cacheRead: 0.0000006,
              cacheWrite5m: 0.0000075,
              cacheWrite1h: 0.000012,
            }
      },
      headerMappings: {},
      providers: {
        anthropic: {
          api: "https://api.anthropic.com",
          apiKey: Resource.ANTHROPIC_API_KEY.value,
          model: "claude-sonnet-4-20250514",
        },
      },
    },
    "claude-3-5-haiku": {
      id: "claude-3-5-haiku" as const,
      auth: true,
      cost: {
        input: 0.0000008,
        output: 0.000004,
        cacheRead: 0.00000008,
        cacheWrite5m: 0.000001,
        cacheWrite1h: 0.0000016,
      },
      headerMappings: {},
      providers: {
        anthropic: {
          api: "https://api.anthropic.com",
          apiKey: Resource.ANTHROPIC_API_KEY.value,
          model: "claude-3-5-haiku-20241022",
        },
      },
    },
    "gpt-5": {
      id: "gpt-5" as const,
      auth: true,
      cost: {
        input: 0.00000125,
        output: 0.00001,
        cacheRead: 0.000000125,
      },
      headerMappings: {},
      providers: {
        openai: {
          api: "https://api.openai.com",
          apiKey: Resource.OPENAI_API_KEY.value,
          model: "gpt-5",
        },
      },
    },
    "qwen3-coder": {
      id: "qwen3-coder" as const,
      auth: true,
      cost: {
        input: 0.00000045,
        output: 0.0000018,
      },
      headerMappings: {},
      providers: {
        baseten: {
          api: "https://inference.baseten.co",
          apiKey: Resource.BASETEN_API_KEY.value,
          model: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
          weight: 4,
        },
        fireworks: {
          api: "https://api.fireworks.ai/inference",
          apiKey: Resource.FIREWORKS_API_KEY.value,
          model: "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct",
          weight: 1,
        },
      },
    },
    "kimi-k2": {
      id: "kimi-k2" as const,
      auth: true,
      cost: {
        input: 0.0000006,
        output: 0.0000025,
      },
      headerMappings: {},
      providers: {
        baseten: {
          api: "https://inference.baseten.co",
          apiKey: Resource.BASETEN_API_KEY.value,
          model: "moonshotai/Kimi-K2-Instruct-0905",
          weight: 4,
        },
        fireworks: {
          api: "https://api.fireworks.ai/inference",
          apiKey: Resource.FIREWORKS_API_KEY.value,
          model: "accounts/fireworks/models/kimi-k2-instruct-0905",
          weight: 1,
        },
      },
    },
    "grok-code": {
      id: "grok-code" as const,
      auth: false,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
      },
      headerMappings: {
        "x-grok-conv-id": "x-opencode-session",
        "x-grok-req-id": "x-opencode-request",
      },
      providers: {
        xai: {
          api: "https://api.x.ai",
          apiKey: Resource.XAI_API_KEY.value,
          model: "grok-code",
        },
      },
    },
    // deprecated
    "qwen/qwen3-coder": {
      id: "qwen/qwen3-coder" as const,
      auth: true,
      cost: {
        input: 0.00000038,
        output: 0.00000153,
      },
      headerMappings: {},
      providers: {
        baseten: {
          api: "https://inference.baseten.co",
          apiKey: Resource.BASETEN_API_KEY.value,
          model: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
          weight: 5,
        },
        fireworks: {
          api: "https://api.fireworks.ai/inference",
          apiKey: Resource.FIREWORKS_API_KEY.value,
          model: "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct",
          weight: 1,
        },
      },
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
    await checkCreditsAndLimit()
    const providerName = selectProvider()
    const providerData = MODEL.providers[providerName]
    logger.metric({ provider: providerName })

    // Request to model provider
    const startTimestamp = Date.now()
    const res = await fetch(path.posix.join(providerData.api, url.pathname.replace(/^\/zen/, "") + url.search), {
      method: "POST",
      headers: (() => {
        const headers = input.request.headers
        headers.delete("host")
        headers.delete("content-length")
        opts.setAuthHeader(headers, providerData.apiKey)
        Object.entries(MODEL.headerMappings ?? {}).forEach(([k, v]) => {
          headers.set(k, headers.get(v)!)
        })
        return headers
      })(),
      body: JSON.stringify({
        ...(opts.modifyBody?.(body) ?? body),
        model: providerData.model,
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
      await reload()
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

        function pump(): Promise<void> {
          return (
            reader?.read().then(async ({ done, value }) => {
              if (done) {
                logger.metric({ response_length: responseLength })
                const usage = opts.getStreamUsage()
                if (usage) {
                  await trackUsage(usage)
                  await reload()
                }
                c.close()
                return
              }

              if (responseLength === 0) {
                logger.metric({ time_to_first_byte: Date.now() - startTimestamp })
              }
              responseLength += value.length
              buffer += decoder.decode(value, { stream: true })

              const parts = buffer.split("\n\n")
              buffer = parts.pop() ?? ""

              for (const part of parts) {
                logger.debug(part)
                opts.onStreamPart(part.trim())
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
        const apiKey = opts.parseApiKey(input.request.headers)
        if (!apiKey) throw new AuthError("Missing API key.")

        const key = await Database.use((tx) =>
          tx
            .select({
              id: KeyTable.id,
              workspaceID: KeyTable.workspaceID,
            })
            .from(KeyTable)
            .where(and(eq(KeyTable.key, apiKey), isNull(KeyTable.timeDeleted)))
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

    async function checkCreditsAndLimit() {
      if (!apiKey || !MODEL.auth || isFree) return

      const billing = await Database.use((tx) =>
        tx
          .select({
            balance: BillingTable.balance,
            monthlyLimit: BillingTable.monthlyLimit,
            monthlyUsage: BillingTable.monthlyUsage,
            timeMonthlyUsageUpdated: BillingTable.timeMonthlyUsageUpdated,
          })
          .from(BillingTable)
          .where(eq(BillingTable.workspaceID, apiKey.workspaceID))
          .then((rows) => rows[0]),
      )

      if (billing.balance <= 0) throw new CreditsError("Insufficient balance")
      if (
        billing.monthlyLimit &&
        billing.monthlyUsage &&
        billing.timeMonthlyUsageUpdated &&
        billing.monthlyUsage >= centsToMicroCents(billing.monthlyLimit * 100)
      ) {
        const now = new Date()
        const currentYear = now.getUTCFullYear()
        const currentMonth = now.getUTCMonth()
        const dateYear = billing.timeMonthlyUsageUpdated.getUTCFullYear()
        const dateMonth = billing.timeMonthlyUsageUpdated.getUTCMonth()
        if (currentYear === dateYear && currentMonth === dateMonth)
          throw new MonthlyLimitError(`You have reached your monthly spending limit of $${billing.monthlyLimit}.`)
      }
    }

    function selectProvider() {
      const picks = Object.entries(MODEL.providers).flatMap(([name, provider]) =>
        Array<string>(provider.weight ?? 1).fill(name),
      )
      return picks[Math.floor(Math.random() * picks.length)]
    }

    async function trackUsage(usage: any) {
      const { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens } =
        opts.normalizeUsage(usage)

      const modelCost = typeof MODEL.cost === "function" ? MODEL.cost(usage) : MODEL.cost

      const inputCost = modelCost.input * inputTokens * 100
      const outputCost = modelCost.output * outputTokens * 100
      const reasoningCost = (() => {
        if (!reasoningTokens) return undefined
        return modelCost.output * reasoningTokens * 100
      })()
      const cacheReadCost = (() => {
        if (!cacheReadTokens) return undefined
        if (!modelCost.cacheRead) return undefined
        return modelCost.cacheRead * cacheReadTokens * 100
      })()
      const cacheWrite5mCost = (() => {
        if (!cacheWrite5mTokens) return undefined
        if (!modelCost.cacheWrite5m) return undefined
        return modelCost.cacheWrite5m * cacheWrite5mTokens * 100
      })()
      const cacheWrite1hCost = (() => {
        if (!cacheWrite1hTokens) return undefined
        if (!modelCost.cacheWrite1h) return undefined
        return modelCost.cacheWrite1h * cacheWrite1hTokens * 100
      })()
      const totalCostInCent =
        inputCost +
        outputCost +
        (reasoningCost ?? 0) +
        (cacheReadCost ?? 0) +
        (cacheWrite5mCost ?? 0) +
        (cacheWrite1hCost ?? 0)

      logger.metric({
        "tokens.input": inputTokens,
        "tokens.output": outputTokens,
        "tokens.reasoning": reasoningTokens,
        "tokens.cache_read": cacheReadTokens,
        "tokens.cache_write_5m": cacheWrite5mTokens,
        "tokens.cache_write_1h": cacheWrite1hTokens,
        "cost.input": Math.round(inputCost),
        "cost.output": Math.round(outputCost),
        "cost.reasoning": reasoningCost ? Math.round(reasoningCost) : undefined,
        "cost.cache_read": cacheReadCost ? Math.round(cacheReadCost) : undefined,
        "cost.cache_write_5m": cacheWrite5mCost ? Math.round(cacheWrite5mCost) : undefined,
        "cost.cache_write_1h": cacheWrite1hCost ? Math.round(cacheWrite1hCost) : undefined,
        "cost.total": Math.round(totalCostInCent),
      })

      if (!apiKey) return

      const cost = isFree ? 0 : centsToMicroCents(totalCostInCent)
      await Database.transaction(async (tx) => {
        await tx.insert(UsageTable).values({
          workspaceID: apiKey.workspaceID,
          id: Identifier.create("usage"),
          model: MODEL.id,
          provider: providerName,
          inputTokens,
          outputTokens,
          reasoningTokens,
          cacheReadTokens,
          cacheWrite5mTokens,
          cacheWrite1hTokens,
          cost,
        })
        await tx
          .update(BillingTable)
          .set({
            balance: sql`${BillingTable.balance} - ${cost}`,
            monthlyUsage: sql`
              CASE
                WHEN MONTH(${BillingTable.timeMonthlyUsageUpdated}) = MONTH(now()) AND YEAR(${BillingTable.timeMonthlyUsageUpdated}) = YEAR(now()) THEN ${BillingTable.monthlyUsage} + ${cost}
                ELSE ${cost}
              END
            `,
            timeMonthlyUsageUpdated: sql`now()`,
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

    async function reload() {
      if (!apiKey) return

      // acquire reload lock
      const lock = await Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            timeReloadLockedTill: sql`now() + interval 1 minute`,
          })
          .where(
            and(
              eq(BillingTable.workspaceID, apiKey.workspaceID),
              lt(BillingTable.balance, centsToMicroCents(Billing.CHARGE_THRESHOLD)),
              or(isNull(BillingTable.timeReloadLockedTill), lt(BillingTable.timeReloadLockedTill, sql`now()`)),
            ),
          ),
      )
      if (lock.rowsAffected === 0) return

      await Actor.provide("system", { workspaceID: apiKey.workspaceID }, async () => {
        await Billing.reload()
      })
    }
  } catch (error: any) {
    logger.metric({
      "error.type": error.constructor.name,
      "error.message": error.message,
    })

    // Note: both top level "type" and "error.type" fields are used by the @ai-sdk/anthropic client to render the error message.
    if (
      error instanceof AuthError ||
      error instanceof CreditsError ||
      error instanceof MonthlyLimitError ||
      error instanceof ModelError
    )
      return new Response(
        JSON.stringify({
          type: "error",
          error: { type: error.constructor.name, message: error.message },
        }),
        { status: 401 },
      )

    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "error",
          message: error.message,
        },
      }),
      { status: 500 },
    )
  }
}

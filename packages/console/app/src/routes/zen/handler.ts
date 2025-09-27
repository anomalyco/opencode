import { z } from "zod"
import type { APIEvent } from "@solidjs/start/server"
import path from "node:path"
import { and, Database, eq, isNull, lt, or, sql } from "@opencode/console-core/drizzle/index.js"
import { KeyTable } from "@opencode/console-core/schema/key.sql.js"
import { BillingTable, UsageTable } from "@opencode/console-core/schema/billing.sql.js"
import { centsToMicroCents } from "@opencode/console-core/util/price.js"
import { Identifier } from "@opencode/console-core/identifier.js"
import { Resource } from "@opencode/console-resource"
import { Billing } from "../../../../core/src/billing"
import { Actor } from "@opencode/console-core/actor.js"
import { WorkspaceTable } from "@opencode/console-core/schema/workspace.sql.js"
import { ZenModel } from "@opencode/console-core/model.js"

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

  type Model = z.infer<typeof ZenModel.ModelSchema>

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
    const modelInfo = validateModel(body.model)
    const providerInfo = selectProvider(modelInfo)
    const authInfo = await authenticate(modelInfo)
    validateBilling(modelInfo, authInfo)
    logger.metric({ provider: providerInfo.id })

    // Request to model provider
    const startTimestamp = Date.now()
    const res = await fetch(path.posix.join(providerInfo.api, url.pathname.replace(/^\/zen/, "") + url.search), {
      method: "POST",
      headers: (() => {
        const headers = input.request.headers
        headers.delete("host")
        headers.delete("content-length")
        opts.setAuthHeader(headers, providerInfo.apiKey)
        Object.entries(providerInfo.headerMappings ?? {}).forEach(([k, v]) => {
          headers.set(k, headers.get(v)!)
        })
        return headers
      })(),
      body: JSON.stringify({
        ...(opts.modifyBody?.(body) ?? body),
        model: providerInfo.model,
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
      await trackUsage(authInfo, modelInfo, providerInfo.id, json.usage)
      await reload(authInfo)
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
                logger.metric({
                  response_length: responseLength,
                  "timestamp.last_byte": Date.now(),
                })
                const usage = opts.getStreamUsage()
                if (usage) {
                  await trackUsage(authInfo, modelInfo, providerInfo.id, usage)
                  await reload(authInfo)
                }
                c.close()
                return
              }

              if (responseLength === 0) {
                const now = Date.now()
                logger.metric({
                  time_to_first_byte: now - startTimestamp,
                  "timestamp.first_byte": now,
                })
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

  function validateModel(reqModel: string) {
    const json = JSON.parse(Resource.ZEN_MODELS.value)

    const allModels = ZenModel.ModelsSchema.parse(json)

    if (!(reqModel in allModels)) {
      throw new ModelError(`Model ${reqModel} not supported`)
    }
    const modelId = reqModel as keyof typeof allModels
    const modelData = allModels[modelId]

    logger.metric({ model: modelId })

    return { id: modelId, ...modelData }
  }

  function selectProvider(model: Model) {
    const providers = model.providers
      .filter((provider) => !provider.disabled)
      .flatMap((provider) => Array<typeof provider>(provider.weight ?? 1).fill(provider))
    return providers[Math.floor(Math.random() * providers.length)]
  }

  async function authenticate(model: Model) {
    const apiKey = opts.parseApiKey(input.request.headers)
    if (!apiKey) {
      if (model.allowAnonymous) return
      throw new AuthError("Missing API key.")
    }

    const data = await Database.use((tx) =>
      tx
        .select({
          apiKey: KeyTable.id,
          workspaceID: KeyTable.workspaceID,
          balance: BillingTable.balance,
          paymentMethodID: BillingTable.paymentMethodID,
          monthlyLimit: BillingTable.monthlyLimit,
          monthlyUsage: BillingTable.monthlyUsage,
          timeMonthlyUsageUpdated: BillingTable.timeMonthlyUsageUpdated,
        })
        .from(KeyTable)
        .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, KeyTable.workspaceID))
        .innerJoin(BillingTable, eq(BillingTable.workspaceID, KeyTable.workspaceID))
        .where(and(eq(KeyTable.key, apiKey), isNull(KeyTable.timeDeleted)))
        .then((rows) => rows[0]),
    )

    if (!data) throw new AuthError("Invalid API key.")
    logger.metric({
      api_key: data.apiKey,
      workspace: data.workspaceID,
    })

    const isFree = FREE_WORKSPACES.includes(data.workspaceID)

    return {
      apiKeyId: data.apiKey,
      workspaceID: data.workspaceID,
      billing: {
        paymentMethodID: data.paymentMethodID,
        balance: data.balance,
        monthlyLimit: data.monthlyLimit,
        monthlyUsage: data.monthlyUsage,
        timeMonthlyUsageUpdated: data.timeMonthlyUsageUpdated,
      },
      isFree,
    }
  }

  function validateBilling(model: Model, authInfo: Awaited<ReturnType<typeof authenticate>>) {
    if (!authInfo || authInfo.isFree) return
    if (model.allowAnonymous) return

    const billing = authInfo.billing
    if (!billing.paymentMethodID) throw new CreditsError("No payment method")
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

  async function trackUsage(
    authInfo: Awaited<ReturnType<typeof authenticate>>,
    modelInfo: ReturnType<typeof validateModel>,
    providerId: string,
    usage: any,
  ) {
    const { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens } =
      opts.normalizeUsage(usage)

    const modelCost =
      modelInfo.cost200K &&
      usage.inputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens > 200_000
        ? modelInfo.cost200K
        : modelInfo.cost

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

    if (!authInfo) return

    const cost = authInfo.isFree ? 0 : centsToMicroCents(totalCostInCent)
    await Database.transaction(async (tx) => {
      await tx.insert(UsageTable).values({
        workspaceID: authInfo.workspaceID,
        id: Identifier.create("usage"),
        model: modelInfo.id,
        provider: providerId,
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
        .where(eq(BillingTable.workspaceID, authInfo.workspaceID))
    })

    await Database.use((tx) =>
      tx
        .update(KeyTable)
        .set({ timeUsed: sql`now()` })
        .where(eq(KeyTable.id, authInfo.apiKeyId)),
    )
  }

  async function reload(authInfo: Awaited<ReturnType<typeof authenticate>>) {
    if (!authInfo) return

    const lock = await Database.use((tx) =>
      tx
        .update(BillingTable)
        .set({
          timeReloadLockedTill: sql`now() + interval 1 minute`,
        })
        .where(
          and(
            eq(BillingTable.workspaceID, authInfo.workspaceID),
            eq(BillingTable.reload, true),
            lt(BillingTable.balance, centsToMicroCents(Billing.CHARGE_THRESHOLD)),
            or(isNull(BillingTable.timeReloadLockedTill), lt(BillingTable.timeReloadLockedTill, sql`now()`)),
          ),
        ),
    )
    if (lock.rowsAffected === 0) return

    await Actor.provide("system", { workspaceID: authInfo.workspaceID }, async () => {
      await Billing.reload()
    })
  }
}

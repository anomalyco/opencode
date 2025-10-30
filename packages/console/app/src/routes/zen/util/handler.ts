import type { APIEvent } from "@solidjs/start/server"
import { and, Database, eq, isNull, lt, or, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { BillingTable, UsageTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { Identifier } from "@opencode-ai/console-core/identifier.js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { ZenData } from "@opencode-ai/console-core/model.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { ModelTable } from "@opencode-ai/console-core/schema/model.sql.js"
import { ProviderTable } from "@opencode-ai/console-core/schema/provider.sql.js"
import { logger } from "./logger"
import { AuthError, CreditsError, MonthlyLimitError, UserLimitError, ModelError } from "./error"
import { createBodyConverter, createStreamPartConverter, createResponseConverter } from "./provider/provider"
import { Format } from "./format"
import { anthropicHelper } from "./provider/anthropic"
import { openaiHelper } from "./provider/openai"
import { oaCompatHelper } from "./provider/openai-compatible"

type ZenData = Awaited<ReturnType<typeof ZenData.list>>
type Model = ZenData["models"][string]

export async function handler(
  input: APIEvent,
  opts: {
    format: Format
    parseApiKey: (headers: Headers) => string | undefined
  },
) {
  const FREE_WORKSPACES = [
    "wrk_01K46JDFR0E75SG2Q8K172KF3Y", // frank
    "wrk_01K6W1A3VE0KMNVSCQT43BG2SX", // opencode bench
  ]

  try {
    const body = await input.request.json()
    logger.metric({
      is_tream: !!body.stream,
      session: input.request.headers.get("x-opencode-session"),
      request: input.request.headers.get("x-opencode-request"),
    })
    const zenData = ZenData.list()
    const modelInfo = validateModel(zenData, body.model)
    const providerInfo = selectProvider(zenData, modelInfo, input.request.headers.get("x-real-ip") ?? "")
    const authInfo = await authenticate(modelInfo, providerInfo)
    validateBilling(modelInfo, authInfo)
    validateModelSettings(authInfo)
    updateProviderKey(authInfo, providerInfo)
    logger.metric({ provider: providerInfo.id })

    // Request to model provider
    const startTimestamp = Date.now()
    const reqUrl = providerInfo.modifyUrl(providerInfo.api)
    const reqBody = JSON.stringify(
      providerInfo.modifyBody({
        ...createBodyConverter(opts.format, providerInfo.format)(body),
        model: providerInfo.model,
      }),
    )
    logger.debug("REQUEST URL: " + reqUrl)
    logger.debug("REQUEST: " + reqBody)
    const res = await fetch(reqUrl, {
      method: "POST",
      headers: (() => {
        const headers = input.request.headers
        headers.delete("host")
        headers.delete("content-length")
        providerInfo.modifyHeaders(headers, body, providerInfo.apiKey)
        Object.entries(providerInfo.headerMappings ?? {}).forEach(([k, v]) => {
          headers.set(k, headers.get(v)!)
        })
        return headers
      })(),
      body: reqBody,
    })

    // Scrub response headers
    const resHeaders = new Headers()
    const keepHeaders = ["content-type", "cache-control"]
    for (const [k, v] of res.headers.entries()) {
      if (keepHeaders.includes(k.toLowerCase())) {
        resHeaders.set(k, v)
      }
    }
    logger.debug("STATUS: " + res.status + " " + res.statusText)
    if (res.status === 400 || res.status === 503) {
      logger.debug("RESPONSE: " + (await res.text()))
    }

    // Handle non-streaming response
    if (!body.stream) {
      const responseConverter = createResponseConverter(providerInfo.format, opts.format)
      const json = await res.json()
      const body = JSON.stringify(responseConverter(json))
      logger.metric({ response_length: body.length })
      logger.debug("RESPONSE: " + body)
      await trackUsage(authInfo, modelInfo, providerInfo, json.usage)
      await reload(authInfo)
      return new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
      })
    }

    // Handle streaming response
    const streamConverter = createStreamPartConverter(providerInfo.format, opts.format)
    const usageParser = providerInfo.createUsageParser()
    const stream = new ReadableStream({
      start(c) {
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        const encoder = new TextEncoder()
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
                const usage = usageParser.retrieve()
                if (usage) {
                  await trackUsage(authInfo, modelInfo, providerInfo, usage)
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

              for (let part of parts) {
                logger.debug("PART: " + part)

                part = part.trim()
                usageParser.parse(part)

                if (providerInfo.format !== opts.format) {
                  part = streamConverter(part)
                  c.enqueue(encoder.encode(part + "\n\n"))
                }
              }

              if (providerInfo.format === opts.format) {
                c.enqueue(value)
              }

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
      error instanceof UserLimitError ||
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

  function validateModel(zenData: ZenData, reqModel: string) {
    if (!(reqModel in zenData.models)) {
      throw new ModelError(`Model ${reqModel} not supported`)
    }
    const modelId = reqModel as keyof typeof zenData.models
    const modelData = zenData.models[modelId]

    logger.metric({ model: modelId })

    return { id: modelId, ...modelData }
  }

  function selectProvider(zenData: ZenData, model: Awaited<ReturnType<typeof validateModel>>, ip: string) {
    const providers = model.providers
      .filter((provider) => !provider.disabled)
      .flatMap((provider) => Array<typeof provider>(provider.weight ?? 1).fill(provider))

    // Use last character of IP address to select a provider
    const lastChar = ip.charCodeAt(ip.length - 1) || 0
    const index = lastChar % providers.length
    const provider = providers[index]

    if (!(provider.id in zenData.providers)) {
      throw new ModelError(`Provider ${provider.id} not supported`)
    }

    return {
      ...provider,
      ...zenData.providers[provider.id],
      ...(provider.id === "anthropic" ? anthropicHelper : provider.id === "openai" ? openaiHelper : oaCompatHelper),
    }
  }

  async function authenticate(
    model: Awaited<ReturnType<typeof validateModel>>,
    providerInfo: Awaited<ReturnType<typeof selectProvider>>,
  ) {
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
          billing: {
            balance: BillingTable.balance,
            paymentMethodID: BillingTable.paymentMethodID,
            monthlyLimit: BillingTable.monthlyLimit,
            monthlyUsage: BillingTable.monthlyUsage,
            timeMonthlyUsageUpdated: BillingTable.timeMonthlyUsageUpdated,
          },
          user: {
            id: UserTable.id,
            monthlyLimit: UserTable.monthlyLimit,
            monthlyUsage: UserTable.monthlyUsage,
            timeMonthlyUsageUpdated: UserTable.timeMonthlyUsageUpdated,
          },
          provider: {
            credentials: ProviderTable.credentials,
          },
          timeDisabled: ModelTable.timeCreated,
        })
        .from(KeyTable)
        .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, KeyTable.workspaceID))
        .innerJoin(BillingTable, eq(BillingTable.workspaceID, KeyTable.workspaceID))
        .innerJoin(UserTable, and(eq(UserTable.workspaceID, KeyTable.workspaceID), eq(UserTable.id, KeyTable.userID)))
        .leftJoin(ModelTable, and(eq(ModelTable.workspaceID, KeyTable.workspaceID), eq(ModelTable.model, model.id)))
        .leftJoin(
          ProviderTable,
          and(eq(ProviderTable.workspaceID, KeyTable.workspaceID), eq(ProviderTable.provider, providerInfo.id)),
        )
        .where(and(eq(KeyTable.key, apiKey), isNull(KeyTable.timeDeleted)))
        .then((rows) => rows[0]),
    )

    if (!data) throw new AuthError("Invalid API key.")
    logger.metric({
      api_key: data.apiKey,
      workspace: data.workspaceID,
    })

    return {
      apiKeyId: data.apiKey,
      workspaceID: data.workspaceID,
      billing: data.billing,
      user: data.user,
      provider: data.provider,
      isFree: FREE_WORKSPACES.includes(data.workspaceID),
      isDisabled: !!data.timeDisabled,
    }
  }

  function validateBilling(model: Model, authInfo: Awaited<ReturnType<typeof authenticate>>) {
    if (!authInfo || authInfo.isFree) return
    if (model.allowAnonymous) return

    const billing = authInfo.billing
    if (!billing.paymentMethodID) throw new CreditsError("No payment method")
    if (billing.balance <= 0) throw new CreditsError("Insufficient balance")

    const now = new Date()
    const currentYear = now.getUTCFullYear()
    const currentMonth = now.getUTCMonth()
    if (
      billing.monthlyLimit &&
      billing.monthlyUsage &&
      billing.timeMonthlyUsageUpdated &&
      billing.monthlyUsage >= centsToMicroCents(billing.monthlyLimit * 100)
    ) {
      const dateYear = billing.timeMonthlyUsageUpdated.getUTCFullYear()
      const dateMonth = billing.timeMonthlyUsageUpdated.getUTCMonth()
      if (currentYear === dateYear && currentMonth === dateMonth)
        throw new MonthlyLimitError(
          `Your workspace has reached its monthly spending limit of $${billing.monthlyLimit}.`,
        )
    }

    if (
      authInfo.user.monthlyLimit &&
      authInfo.user.monthlyUsage &&
      authInfo.user.timeMonthlyUsageUpdated &&
      authInfo.user.monthlyUsage >= centsToMicroCents(authInfo.user.monthlyLimit * 100)
    ) {
      const dateYear = authInfo.user.timeMonthlyUsageUpdated.getUTCFullYear()
      const dateMonth = authInfo.user.timeMonthlyUsageUpdated.getUTCMonth()
      if (currentYear === dateYear && currentMonth === dateMonth)
        throw new UserLimitError(`You have reached your monthly spending limit of $${authInfo.user.monthlyLimit}.`)
    }
  }

  function validateModelSettings(authInfo: Awaited<ReturnType<typeof authenticate>>) {
    if (!authInfo) return
    if (authInfo.isDisabled) throw new ModelError("Model is disabled")
  }

  function updateProviderKey(
    authInfo: Awaited<ReturnType<typeof authenticate>>,
    providerInfo: Awaited<ReturnType<typeof selectProvider>>,
  ) {
    if (!authInfo) return
    if (!authInfo.provider?.credentials) return
    providerInfo.apiKey = authInfo.provider.credentials
  }

  async function trackUsage(
    authInfo: Awaited<ReturnType<typeof authenticate>>,
    modelInfo: ReturnType<typeof validateModel>,
    providerInfo: Awaited<ReturnType<typeof selectProvider>>,
    usage: any,
  ) {
    const { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens } =
      providerInfo.normalizeUsage(usage)

    const modelCost =
      modelInfo.cost200K &&
      inputTokens + (cacheReadTokens ?? 0) + (cacheWrite5mTokens ?? 0) + (cacheWrite1hTokens ?? 0) > 200_000
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

    const cost = authInfo.isFree || authInfo.provider?.credentials ? 0 : centsToMicroCents(totalCostInCent)
    await Database.transaction(async (tx) => {
      await tx.insert(UsageTable).values({
        workspaceID: authInfo.workspaceID,
        id: Identifier.create("usage"),
        model: modelInfo.id,
        provider: providerInfo.id,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cacheReadTokens,
        cacheWrite5mTokens,
        cacheWrite1hTokens,
        cost,
        keyID: authInfo.apiKeyId,
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
      await tx
        .update(UserTable)
        .set({
          monthlyUsage: sql`
              CASE
                WHEN MONTH(${UserTable.timeMonthlyUsageUpdated}) = MONTH(now()) AND YEAR(${UserTable.timeMonthlyUsageUpdated}) = YEAR(now()) THEN ${UserTable.monthlyUsage} + ${cost}
                ELSE ${cost}
              END
            `,
          timeMonthlyUsageUpdated: sql`now()`,
        })
        .where(and(eq(UserTable.workspaceID, authInfo.workspaceID), eq(UserTable.id, authInfo.user.id)))
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
    if (authInfo.isFree) return
    if (authInfo.provider?.credentials) return

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

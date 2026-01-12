import type { APIEvent } from "@solidjs/start/server"
import { and, Database, eq, isNull, lt, or, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { BillingTable, SubscriptionTable, UsageTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { getWeekBounds } from "@opencode-ai/console-core/util/date.js"
import { Identifier } from "@opencode-ai/console-core/identifier.js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { ZenData } from "@opencode-ai/console-core/model.js"
import { BlackData } from "@opencode-ai/console-core/black.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { ModelTable } from "@opencode-ai/console-core/schema/model.sql.js"
import { ProviderTable } from "@opencode-ai/console-core/schema/provider.sql.js"
import { logger } from "./logger"
import {
  AuthError,
  CreditsError,
  MonthlyLimitError,
  SubscriptionError,
  UserLimitError,
  ModelError,
  RateLimitError,
} from "./error"
import { createBodyConverter, createStreamPartConverter, createResponseConverter, UsageInfo } from "./provider/provider"
import { anthropicHelper } from "./provider/anthropic"
import { googleHelper } from "./provider/google"
import { openaiHelper } from "./provider/openai"
import { oaCompatHelper } from "./provider/openai-compatible"
import { createRateLimiter } from "./rateLimiter"
import { createDataDumper } from "./dataDumper"
import { createTrialLimiter } from "./trialLimiter"
import { createStickyTracker } from "./stickyProviderTracker"

type ZenData = Awaited<ReturnType<typeof ZenData.list>>
type RetryOptions = {
  excludeProviders: string[]
  retryCount: number
}

export async function handler(
  input: APIEvent,
  opts: {
    format: ZenData.Format
    parseApiKey: (headers: Headers) => string | undefined
    parseModel: (url: string, body: any) => string
    parseIsStream: (url: string, body: any) => boolean
  },
) {
  type AuthInfo = Awaited<ReturnType<typeof authenticate>>
  type ModelInfo = Awaited<ReturnType<typeof validateModel>>
  type ProviderInfo = Awaited<ReturnType<typeof selectProvider>>

  const MAX_RETRIES = 3
  const FREE_WORKSPACES = [
    "wrk_01K46JDFR0E75SG2Q8K172KF3Y", // frank
    "wrk_01K6W1A3VE0KMNVSCQT43BG2SX", // opencode bench
  ]

  try {
    const url = input.request.url
    const body = await input.request.json()
    const model = opts.parseModel(url, body)
    const isStream = opts.parseIsStream(url, body)
    const ip = input.request.headers.get("x-real-ip") ?? ""
    const sessionId = input.request.headers.get("x-opencode-session") ?? ""
    const requestId = input.request.headers.get("x-opencode-request") ?? ""
    const projectId = input.request.headers.get("x-opencode-project") ?? ""
    const ocClient = input.request.headers.get("x-opencode-client") ?? ""
    logger.metric({
      is_tream: isStream,
      session: sessionId,
      request: requestId,
      client: ocClient,
    })
    const zenData = ZenData.list()
    const modelInfo = validateModel(zenData, model)
    const dataDumper = createDataDumper(sessionId, requestId, projectId)
    const trialLimiter = createTrialLimiter(modelInfo.trial, ip, ocClient)
    const isTrial = await trialLimiter?.isTrial()
    const rateLimiter = createRateLimiter(modelInfo.rateLimit, ip)
    await rateLimiter?.check()
    const stickyTracker = createStickyTracker(modelInfo.stickyProvider ?? false, sessionId)
    const stickyProvider = await stickyTracker?.get()
    const authInfo = await authenticate(modelInfo)

    const retriableRequest = async (retry: RetryOptions = { excludeProviders: [], retryCount: 0 }) => {
      const providerInfo = selectProvider(
        zenData,
        authInfo,
        modelInfo,
        sessionId,
        isTrial ?? false,
        retry,
        stickyProvider,
      )
      validateBilling(authInfo, modelInfo)
      validateModelSettings(authInfo)
      updateProviderKey(authInfo, providerInfo)
      logger.metric({ provider: providerInfo.id })

      const startTimestamp = Date.now()
      const reqUrl = providerInfo.modifyUrl(providerInfo.api, providerInfo.model, isStream)
      const reqBody = JSON.stringify(
        providerInfo.modifyBody({
          ...createBodyConverter(opts.format, providerInfo.format)(body),
          model: providerInfo.model,
        }),
      )
      logger.debug("REQUEST URL: " + reqUrl)
      logger.debug("REQUEST: " + reqBody.substring(0, 300) + "...")
      const res = await fetch(reqUrl, {
        method: "POST",
        headers: (() => {
          const headers = new Headers(input.request.headers)
          providerInfo.modifyHeaders(headers, body, providerInfo.apiKey)
          Object.entries(providerInfo.headerMappings ?? {}).forEach(([k, v]) => {
            headers.set(k, headers.get(v)!)
          })
          headers.delete("host")
          headers.delete("content-length")
          headers.delete("x-opencode-request")
          headers.delete("x-opencode-session")
          headers.delete("x-opencode-project")
          headers.delete("x-opencode-client")
          return headers
        })(),
        body: reqBody,
      })

      // Try another provider => stop retrying if using fallback provider
      if (
        res.status !== 200 &&
        // ie. openai 404 error: Item with id 'msg_0ead8b004a3b165d0069436a6b6834819896da85b63b196a3f' not found.
        res.status !== 404 &&
        // ie. cannot change codex model providers mid-session
        !modelInfo.stickyProvider &&
        modelInfo.fallbackProvider &&
        providerInfo.id !== modelInfo.fallbackProvider
      ) {
        return retriableRequest({
          excludeProviders: [...retry.excludeProviders, providerInfo.id],
          retryCount: retry.retryCount + 1,
        })
      }

      return { providerInfo, reqBody, res, startTimestamp }
    }

    const { providerInfo, reqBody, res, startTimestamp } = await retriableRequest()

    // Store model request
    dataDumper?.provideModel(providerInfo.storeModel)
    dataDumper?.provideRequest(reqBody)

    // Store sticky provider
    await stickyTracker?.set(providerInfo.id)

    // Temporarily change 404 to 400 status code b/c solid start automatically override 404 response
    const resStatus = res.status === 404 ? 400 : res.status

    // Scrub response headers
    const resHeaders = new Headers()
    const keepHeaders = ["content-type", "cache-control"]
    for (const [k, v] of res.headers.entries()) {
      if (keepHeaders.includes(k.toLowerCase())) {
        resHeaders.set(k, v)
      }
    }
    logger.debug("STATUS: " + res.status + " " + res.statusText)

    // Handle non-streaming response
    if (!isStream) {
      const responseConverter = createResponseConverter(providerInfo.format, opts.format)
      const json = await res.json()
      const body = JSON.stringify(responseConverter(json))
      logger.metric({ response_length: body.length })
      logger.debug("RESPONSE: " + body)
      dataDumper?.provideResponse(body)
      dataDumper?.flush()
      const tokensInfo = providerInfo.normalizeUsage(json.usage)
      await trialLimiter?.track(tokensInfo)
      await rateLimiter?.track()
      const costInfo = await trackUsage(authInfo, modelInfo, providerInfo, tokensInfo)
      await reload(authInfo, costInfo)
      return new Response(body, {
        status: resStatus,
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
                dataDumper?.flush()
                await rateLimiter?.track()
                const usage = usageParser.retrieve()
                if (usage) {
                  const tokensInfo = providerInfo.normalizeUsage(usage)
                  await trialLimiter?.track(tokensInfo)
                  const costInfo = await trackUsage(authInfo, modelInfo, providerInfo, tokensInfo)
                  await reload(authInfo, costInfo)
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
              dataDumper?.provideStream(buffer)

              const parts = buffer.split(providerInfo.streamSeparator)
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
      status: resStatus,
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

    if (error instanceof RateLimitError || error instanceof SubscriptionError) {
      const headers = new Headers()
      if (error instanceof SubscriptionError && error.retryAfter) {
        headers.set("retry-after", String(error.retryAfter))
      }
      return new Response(
        JSON.stringify({
          type: "error",
          error: { type: error.constructor.name, message: error.message },
        }),
        { status: 429, headers },
      )
    }

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
    if (!(reqModel in zenData.models)) throw new ModelError(`Model ${reqModel} not supported`)

    const modelId = reqModel as keyof typeof zenData.models
    const modelData = Array.isArray(zenData.models[modelId])
      ? zenData.models[modelId].find((model) => opts.format === model.formatFilter)
      : zenData.models[modelId]

    if (!modelData) throw new ModelError(`Model ${reqModel} not supported for format ${opts.format}`)

    logger.metric({ model: modelId })

    return { id: modelId, ...modelData }
  }

  function selectProvider(
    zenData: ZenData,
    authInfo: AuthInfo,
    modelInfo: ModelInfo,
    sessionId: string,
    isTrial: boolean,
    retry: RetryOptions,
    stickyProvider: string | undefined,
  ) {
    const provider = (() => {
      if (authInfo?.provider?.credentials) {
        return modelInfo.providers.find((provider) => provider.id === modelInfo.byokProvider)
      }

      if (isTrial) {
        return modelInfo.providers.find((provider) => provider.id === modelInfo.trial!.provider)
      }

      if (stickyProvider) {
        const provider = modelInfo.providers.find((provider) => provider.id === stickyProvider)
        if (provider) return provider
      }

      if (retry.retryCount === MAX_RETRIES) {
        return modelInfo.providers.find((provider) => provider.id === modelInfo.fallbackProvider)
      }

      const providers = modelInfo.providers
        .filter((provider) => !provider.disabled)
        .filter((provider) => !retry.excludeProviders.includes(provider.id))
        .flatMap((provider) => Array<typeof provider>(provider.weight ?? 1).fill(provider))

      // Use the last 4 characters of session ID to select a provider
      let h = 0
      const l = sessionId.length
      for (let i = l - 4; i < l; i++) {
        h = (h * 31 + sessionId.charCodeAt(i)) | 0 // 32-bit int
      }
      const index = (h >>> 0) % providers.length // make unsigned + range 0..length-1
      return providers[index || 0]
    })()

    if (!provider) throw new ModelError("No provider available")
    if (!(provider.id in zenData.providers)) throw new ModelError(`Provider ${provider.id} not supported`)

    return {
      ...provider,
      ...zenData.providers[provider.id],
      ...(() => {
        const format = zenData.providers[provider.id].format
        if (format === "anthropic") return anthropicHelper
        if (format === "google") return googleHelper
        if (format === "openai") return openaiHelper
        return oaCompatHelper
      })(),
    }
  }

  async function authenticate(modelInfo: ModelInfo) {
    const apiKey = opts.parseApiKey(input.request.headers)
    if (!apiKey || apiKey === "public") {
      if (modelInfo.allowAnonymous) return
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
            reloadTrigger: BillingTable.reloadTrigger,
            timeReloadLockedTill: BillingTable.timeReloadLockedTill,
          },
          user: {
            id: UserTable.id,
            monthlyLimit: UserTable.monthlyLimit,
            monthlyUsage: UserTable.monthlyUsage,
            timeMonthlyUsageUpdated: UserTable.timeMonthlyUsageUpdated,
          },
          subscription: {
            id: SubscriptionTable.id,
            rollingUsage: SubscriptionTable.rollingUsage,
            fixedUsage: SubscriptionTable.fixedUsage,
            timeRollingUpdated: SubscriptionTable.timeRollingUpdated,
            timeFixedUpdated: SubscriptionTable.timeFixedUpdated,
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
        .leftJoin(ModelTable, and(eq(ModelTable.workspaceID, KeyTable.workspaceID), eq(ModelTable.model, modelInfo.id)))
        .leftJoin(
          ProviderTable,
          modelInfo.byokProvider
            ? and(
                eq(ProviderTable.workspaceID, KeyTable.workspaceID),
                eq(ProviderTable.provider, modelInfo.byokProvider),
              )
            : sql`false`,
        )
        .leftJoin(
          SubscriptionTable,
          and(
            eq(SubscriptionTable.workspaceID, KeyTable.workspaceID),
            eq(SubscriptionTable.userID, KeyTable.userID),
            isNull(SubscriptionTable.timeDeleted),
          ),
        )
        .where(and(eq(KeyTable.key, apiKey), isNull(KeyTable.timeDeleted)))
        .then((rows) => rows[0]),
    )

    if (!data) throw new AuthError("Invalid API key.")
    logger.metric({
      api_key: data.apiKey,
      workspace: data.workspaceID,
      isSubscription: data.subscription ? true : false,
    })

    return {
      apiKeyId: data.apiKey,
      workspaceID: data.workspaceID,
      billing: data.billing,
      user: data.user,
      subscription: data.subscription,
      provider: data.provider,
      isFree: FREE_WORKSPACES.includes(data.workspaceID),
      isDisabled: !!data.timeDisabled,
    }
  }

  function validateBilling(authInfo: AuthInfo, modelInfo: ModelInfo) {
    if (!authInfo) return
    if (authInfo.provider?.credentials) return
    if (authInfo.isFree) return
    if (modelInfo.allowAnonymous) return

    // Validate subscription billing
    if (authInfo.subscription) {
      const black = BlackData.get()
      const sub = authInfo.subscription
      const now = new Date()

      const formatRetryTime = (seconds: number) => {
        const days = Math.floor(seconds / 86400)
        if (days >= 1) return `${days} day${days > 1 ? "s" : ""}`
        const hours = Math.floor(seconds / 3600)
        const minutes = Math.ceil((seconds % 3600) / 60)
        if (hours >= 1) return `${hours}hr ${minutes}min`
        return `${minutes}min`
      }

      // Check weekly limit
      if (sub.fixedUsage && sub.timeFixedUpdated) {
        const week = getWeekBounds(now)
        if (sub.timeFixedUpdated >= week.start && sub.fixedUsage >= centsToMicroCents(black.fixedLimit * 100)) {
          const retryAfter = Math.ceil((week.end.getTime() - now.getTime()) / 1000)
          throw new SubscriptionError(
            `Subscription quota exceeded. Retry in ${formatRetryTime(retryAfter)}.`,
            retryAfter,
          )
        }
      }

      // Check rolling limit
      if (sub.rollingUsage && sub.timeRollingUpdated) {
        const rollingWindowMs = black.rollingWindow * 3600 * 1000
        const windowStart = new Date(now.getTime() - rollingWindowMs)
        if (sub.timeRollingUpdated >= windowStart && sub.rollingUsage >= centsToMicroCents(black.rollingLimit * 100)) {
          const retryAfter = Math.ceil((sub.timeRollingUpdated.getTime() + rollingWindowMs - now.getTime()) / 1000)
          throw new SubscriptionError(
            `Subscription quota exceeded. Retry in ${formatRetryTime(retryAfter)}.`,
            retryAfter,
          )
        }
      }

      return
    }

    // Validate pay as you go billing
    const billing = authInfo.billing
    if (!billing.paymentMethodID)
      throw new CreditsError(
        `No payment method. Add a payment method here: https://opencode.ai/workspace/${authInfo.workspaceID}/billing`,
      )
    if (billing.balance <= 0)
      throw new CreditsError(
        `Insufficient balance. Manage your billing here: https://opencode.ai/workspace/${authInfo.workspaceID}/billing`,
      )

    const now = new Date()
    const currentYear = now.getUTCFullYear()
    const currentMonth = now.getUTCMonth()
    if (
      billing.monthlyLimit &&
      billing.monthlyUsage &&
      billing.timeMonthlyUsageUpdated &&
      billing.monthlyUsage >= centsToMicroCents(billing.monthlyLimit * 100) &&
      currentYear === billing.timeMonthlyUsageUpdated.getUTCFullYear() &&
      currentMonth === billing.timeMonthlyUsageUpdated.getUTCMonth()
    )
      throw new MonthlyLimitError(
        `Your workspace has reached its monthly spending limit of $${billing.monthlyLimit}. Manage your limits here: https://opencode.ai/workspace/${authInfo.workspaceID}/billing`,
      )

    if (
      authInfo.user.monthlyLimit &&
      authInfo.user.monthlyUsage &&
      authInfo.user.timeMonthlyUsageUpdated &&
      authInfo.user.monthlyUsage >= centsToMicroCents(authInfo.user.monthlyLimit * 100) &&
      currentYear === authInfo.user.timeMonthlyUsageUpdated.getUTCFullYear() &&
      currentMonth === authInfo.user.timeMonthlyUsageUpdated.getUTCMonth()
    )
      throw new UserLimitError(
        `You have reached your monthly spending limit of $${authInfo.user.monthlyLimit}. Manage your limits here: https://opencode.ai/workspace/${authInfo.workspaceID}/members`,
      )
  }

  function validateModelSettings(authInfo: AuthInfo) {
    if (!authInfo) return
    if (authInfo.isDisabled) throw new ModelError("Model is disabled")
  }

  function updateProviderKey(authInfo: AuthInfo, providerInfo: ProviderInfo) {
    if (!authInfo?.provider?.credentials) return
    providerInfo.apiKey = authInfo.provider.credentials
  }

  async function trackUsage(
    authInfo: AuthInfo,
    modelInfo: ModelInfo,
    providerInfo: ProviderInfo,
    usageInfo: UsageInfo,
  ) {
    const { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens } =
      usageInfo

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

    const cost = authInfo.provider?.credentials ? 0 : centsToMicroCents(totalCostInCent)
    await Database.use((db) =>
      Promise.all([
        db.insert(UsageTable).values({
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
          enrichment: authInfo.subscription ? { plan: "sub" } : undefined,
        }),
        db
          .update(KeyTable)
          .set({ timeUsed: sql`now()` })
          .where(and(eq(KeyTable.workspaceID, authInfo.workspaceID), eq(KeyTable.id, authInfo.apiKeyId))),
        ...(authInfo.subscription
          ? (() => {
              const black = BlackData.get()
              const week = getWeekBounds(new Date())
              const rollingWindowSeconds = black.rollingWindow * 3600
              return [
                db
                  .update(SubscriptionTable)
                  .set({
                    fixedUsage: sql`
              CASE
                WHEN ${SubscriptionTable.timeFixedUpdated} >= ${week.start} THEN ${SubscriptionTable.fixedUsage} + ${cost}
                ELSE ${cost}
              END
            `,
                    timeFixedUpdated: sql`now()`,
                    rollingUsage: sql`
              CASE
                WHEN UNIX_TIMESTAMP(${SubscriptionTable.timeRollingUpdated}) >= UNIX_TIMESTAMP(now()) - ${rollingWindowSeconds} THEN ${SubscriptionTable.rollingUsage} + ${cost}
                ELSE ${cost}
              END
            `,
                    timeRollingUpdated: sql`
              CASE
                WHEN UNIX_TIMESTAMP(${SubscriptionTable.timeRollingUpdated}) >= UNIX_TIMESTAMP(now()) - ${rollingWindowSeconds} THEN ${SubscriptionTable.timeRollingUpdated}
                ELSE now()
              END
            `,
                  })
                  .where(
                    and(
                      eq(SubscriptionTable.workspaceID, authInfo.workspaceID),
                      eq(SubscriptionTable.userID, authInfo.user.id),
                    ),
                  ),
              ]
            })()
          : [
              db
                .update(BillingTable)
                .set({
                  balance: authInfo.isFree
                    ? sql`${BillingTable.balance} - ${0}`
                    : sql`${BillingTable.balance} - ${cost}`,
                  monthlyUsage: sql`
              CASE
                WHEN MONTH(${BillingTable.timeMonthlyUsageUpdated}) = MONTH(now()) AND YEAR(${BillingTable.timeMonthlyUsageUpdated}) = YEAR(now()) THEN ${BillingTable.monthlyUsage} + ${cost}
                ELSE ${cost}
              END
            `,
                  timeMonthlyUsageUpdated: sql`now()`,
                })
                .where(eq(BillingTable.workspaceID, authInfo.workspaceID)),
              db
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
                .where(and(eq(UserTable.workspaceID, authInfo.workspaceID), eq(UserTable.id, authInfo.user.id))),
            ]),
      ]),
    )

    return { costInMicroCents: cost }
  }

  async function reload(authInfo: AuthInfo, costInfo: Awaited<ReturnType<typeof trackUsage>>) {
    if (!authInfo) return
    if (authInfo.isFree) return
    if (authInfo.provider?.credentials) return
    if (authInfo.subscription) return

    if (!costInfo) return

    const reloadTrigger = centsToMicroCents((authInfo.billing.reloadTrigger ?? Billing.RELOAD_TRIGGER) * 100)
    if (authInfo.billing.balance - costInfo.costInMicroCents >= reloadTrigger) return
    if (authInfo.billing.timeReloadLockedTill && authInfo.billing.timeReloadLockedTill > new Date()) return

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
            lt(BillingTable.balance, reloadTrigger),
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

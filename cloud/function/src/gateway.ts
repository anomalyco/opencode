import { z } from "zod"
import { Hono, MiddlewareHandler } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { zValidator } from "@hono/zod-validator"
import { Resource } from "sst"
import { type ProviderMetadata, type LanguageModelUsage, generateText, streamText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModelV2Prompt } from "@ai-sdk/provider"
import { type ChatCompletionCreateParamsBase } from "openai/resources/chat/completions"
import { Actor } from "@opencode/cloud-core/actor.js"
import { and, Database, eq, sql } from "@opencode/cloud-core/drizzle/index.js"
import { UserTable } from "@opencode/cloud-core/schema/user.sql.js"
import { KeyTable } from "@opencode/cloud-core/schema/key.sql.js"
import { createClient } from "@openauthjs/openauth/client"
import { Log } from "@opencode/cloud-core/util/log.js"
import { Billing } from "@opencode/cloud-core/billing.js"
import { Workspace } from "@opencode/cloud-core/workspace.js"
import { BillingTable, PaymentTable, UsageTable } from "@opencode/cloud-core/schema/billing.sql.js"
import { centsToMicroCents } from "@opencode/cloud-core/util/price.js"
import { Identifier } from "../../core/src/identifier"

type Env = {}

let _client: ReturnType<typeof createClient>
const client = () => {
  if (_client) return _client
  _client = createClient({
    clientID: "api",
    issuer: Resource.AUTH_API_URL.value,
  })
  return _client
}

const SUPPORTED_MODELS = {
  "anthropic/claude-sonnet-4": {
    input: 0.0000015,
    output: 0.000006,
    reasoning: 0.0000015,
    cacheRead: 0.0000001,
    cacheWrite: 0.0000001,
    model: () =>
      createAnthropic({
        apiKey: Resource.ANTHROPIC_API_KEY.value,
      })("claude-sonnet-4-20250514"),
  },
  "openai/gpt-4.1": {
    input: 0.0000015,
    output: 0.000006,
    reasoning: 0.0000015,
    cacheRead: 0.0000001,
    cacheWrite: 0.0000001,
    model: () =>
      createOpenAI({
        apiKey: Resource.OPENAI_API_KEY.value,
      })("gpt-4.1"),
  },
  "zhipuai/glm-4.5-flash": {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    model: () =>
      createOpenAICompatible({
        name: "Zhipu AI",
        baseURL: "https://api.z.ai/api/paas/v4",
        apiKey: Resource.ZHIPU_API_KEY.value,
      })("glm-4.5-flash"),
  },
}

const log = Log.create({
  namespace: "api",
})

const GatewayAuth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("authorization")

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: {
          message: "Missing API key.",
          type: "invalid_request_error",
          param: null,
          code: "unauthorized",
        },
      },
      401,
    )
  }

  const apiKey = authHeader.split(" ")[1]

  // Check against KeyTable
  const keyRecord = await Database.use((tx) =>
    tx
      .select({
        id: KeyTable.id,
        workspaceID: KeyTable.workspaceID,
      })
      .from(KeyTable)
      .where(eq(KeyTable.key, apiKey))
      .then((rows) => rows[0]),
  )

  if (!keyRecord) {
    return c.json(
      {
        error: {
          message: "Invalid API key.",
          type: "invalid_request_error",
          param: null,
          code: "unauthorized",
        },
      },
      401,
    )
  }

  c.set("keyRecord", keyRecord)
  await next()
}

const RestAuth: MiddlewareHandler = async (c, next) => {
  const authorization = c.req.header("authorization")
  if (!authorization) {
    return Actor.provide("public", {}, next)
  }
  const token = authorization.split(" ")[1]
  if (!token)
    throw new HTTPException(403, {
      message: "Bearer token is required.",
    })

  const verified = await client().verify(token)
  if (verified.err) {
    throw new HTTPException(403, {
      message: "Invalid token.",
    })
  }
  let subject = verified.subject as Actor.Info
  if (subject.type === "account") {
    const workspaceID = c.req.header("x-opencode-workspace")
    const email = subject.properties.email
    if (workspaceID) {
      const user = await Database.use((tx) =>
        tx
          .select({
            id: UserTable.id,
            workspaceID: UserTable.workspaceID,
            email: UserTable.email,
          })
          .from(UserTable)
          .where(and(eq(UserTable.email, email), eq(UserTable.workspaceID, workspaceID)))
          .then((rows) => rows[0]),
      )
      if (!user)
        throw new HTTPException(403, {
          message: "You do not have access to this workspace.",
        })
      subject = {
        type: "user",
        properties: {
          userID: user.id,
          workspaceID: workspaceID,
          email: user.email,
        },
      }
    }
  }
  await Actor.provide(subject.type, subject.properties, next)
}

const app = new Hono<{ Bindings: Env; Variables: { keyRecord?: { id: string; workspaceID: string } } }>()
  .get("/", (c) => c.text("Hello, world!"))
  .post("/v1/chat/completions", GatewayAuth, async (c) => {
    const keyRecord = c.get("keyRecord")!

    return await Actor.provide("system", { workspaceID: keyRecord.workspaceID }, async () => {
      try {
        // Check balance
        const customer = await Billing.get()
        if (customer.balance <= 0) {
          return c.json(
            {
              error: {
                message: "Insufficient balance",
                type: "insufficient_quota",
                param: null,
                code: "insufficient_quota",
              },
            },
            401,
          )
        }

        const body = await c.req.json<ChatCompletionCreateParamsBase>()
        const model = SUPPORTED_MODELS[body.model as keyof typeof SUPPORTED_MODELS]?.model()
        if (!model) throw new Error(`Unsupported model: ${body.model}`)

        const requestBody = transformOpenAIRequestToAiSDK()

        return body.stream ? await handleStream() : await handleGenerate()

        async function handleStream() {
          const result = await model.doStream({
            ...requestBody,
          })

          const encoder = new TextEncoder()
          const stream = new ReadableStream({
            async start(controller) {
              const id = `chatcmpl-${Date.now()}`
              const created = Math.floor(Date.now() / 1000)

              try {
                for await (const chunk of result.stream) {
                  console.log("!!! CHUNK !!! : " + chunk.type)
                  switch (chunk.type) {
                    case "text-delta": {
                      const data = {
                        id,
                        object: "chat.completion.chunk",
                        created,
                        model: body.model,
                        choices: [
                          {
                            index: 0,
                            delta: {
                              content: chunk.delta,
                            },
                            finish_reason: null,
                          },
                        ],
                      }
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                      break
                    }

                    case "reasoning-delta": {
                      const data = {
                        id,
                        object: "chat.completion.chunk",
                        created,
                        model: body.model,
                        choices: [
                          {
                            index: 0,
                            delta: {
                              reasoning_content: chunk.delta,
                            },
                            finish_reason: null,
                          },
                        ],
                      }
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                      break
                    }

                    case "tool-call": {
                      const data = {
                        id,
                        object: "chat.completion.chunk",
                        created,
                        model: body.model,
                        choices: [
                          {
                            index: 0,
                            delta: {
                              tool_calls: [
                                {
                                  index: 0,
                                  id: chunk.toolCallId,
                                  type: "function",
                                  function: {
                                    name: chunk.toolName,
                                    arguments: chunk.input,
                                  },
                                },
                              ],
                            },
                            finish_reason: null,
                          },
                        ],
                      }
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                      break
                    }

                    case "error": {
                      const data = {
                        id,
                        object: "chat.completion.chunk",
                        created,
                        model: body.model,
                        choices: [
                          {
                            index: 0,
                            delta: {},
                            finish_reason: "stop",
                          },
                        ],
                        error: {
                          message: typeof chunk.error === "string" ? chunk.error : chunk.error,
                          type: "server_error",
                        },
                      }
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
                      controller.close()
                      break
                    }

                    case "finish": {
                      const data = {
                        id,
                        object: "chat.completion.chunk",
                        created,
                        model: body.model,
                        choices: [
                          {
                            index: 0,
                            delta: {},
                            finish_reason:
                              {
                                stop: "stop",
                                length: "length",
                                "content-filter": "content_filter",
                                "tool-calls": "tool_calls",
                                error: "stop",
                                other: "stop",
                                unknown: "stop",
                              }[chunk.finishReason] || "stop",
                          },
                        ],
                        usage: {
                          prompt_tokens: chunk.usage.inputTokens,
                          completion_tokens: chunk.usage.outputTokens,
                          total_tokens: chunk.usage.totalTokens,
                          completion_tokens_details: {
                            reasoning_tokens: chunk.usage.reasoningTokens,
                          },
                          prompt_tokens_details: {
                            cached_tokens: chunk.usage.cachedInputTokens,
                          },
                        },
                      }
                      await trackUsage(body.model, chunk.usage, chunk.providerMetadata)
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
                      controller.close()
                      break
                    }

                    //case "stream-start":
                    //case "response-metadata":
                    case "text-start":
                    case "text-end":
                    case "reasoning-start":
                    case "reasoning-end":
                    case "tool-input-start":
                    case "tool-input-delta":
                    case "tool-input-end":
                    case "raw":
                    default:
                      // Log unknown chunk types for debugging
                      console.warn(`Unknown chunk type: ${(chunk as any).type}`)
                      break
                  }
                }
              } catch (error) {
                controller.error(error)
              }
            },
          })

          return new Response(stream, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          })
        }

        async function handleGenerate() {
          const response = await model.doGenerate({
            ...requestBody,
          })
          await trackUsage(body.model, response.usage, response.providerMetadata)
          return c.json({
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion" as const,
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant" as const,
                  content: response.content?.find((c) => c.type === "text")?.text ?? "",
                  reasoning_content: response.content?.find((c) => c.type === "reasoning")?.text,
                  tool_calls: response.content
                    ?.filter((c) => c.type === "tool-call")
                    .map((toolCall) => ({
                      id: toolCall.toolCallId,
                      type: "function" as const,
                      function: {
                        name: toolCall.toolName,
                        arguments: toolCall.input,
                      },
                    })),
                },
                finish_reason:
                  (
                    {
                      stop: "stop",
                      length: "length",
                      "content-filter": "content_filter",
                      "tool-calls": "tool_calls",
                      error: "stop",
                      other: "stop",
                      unknown: "stop",
                    } as const
                  )[response.finishReason] || "stop",
              },
            ],
            usage: {
              prompt_tokens: response.usage?.inputTokens,
              completion_tokens: response.usage?.outputTokens,
              total_tokens: response.usage?.totalTokens,
              completion_tokens_details: {
                reasoning_tokens: response.usage?.reasoningTokens,
              },
              prompt_tokens_details: {
                cached_tokens: response.usage?.cachedInputTokens,
              },
            },
          })
        }

        function transformOpenAIRequestToAiSDK() {
          const prompt = transformMessages()
          const tools = transformTools()

          return {
            prompt,
            maxOutputTokens: body.max_tokens ?? body.max_completion_tokens ?? undefined,
            temperature: body.temperature ?? undefined,
            topP: body.top_p ?? undefined,
            frequencyPenalty: body.frequency_penalty ?? undefined,
            presencePenalty: body.presence_penalty ?? undefined,
            providerOptions: body.reasoning_effort
              ? {
                  anthropic: {
                    reasoningEffort: body.reasoning_effort,
                  },
                }
              : undefined,
            stopSequences: (typeof body.stop === "string" ? [body.stop] : body.stop) ?? undefined,
            responseFormat: (() => {
              if (!body.response_format) return { type: "text" as const }
              if (body.response_format.type === "json_schema")
                return {
                  type: "json" as const,
                  schema: body.response_format.json_schema.schema,
                  name: body.response_format.json_schema.name,
                  description: body.response_format.json_schema.description,
                }
              if (body.response_format.type === "json_object") return { type: "json" as const }
              throw new Error("Unsupported response format")
            })(),
            seed: body.seed ?? undefined,
            tools: tools.tools,
            toolChoice: tools.toolChoice,
          }

          function transformTools() {
            const { tools, tool_choice } = body

            if (!tools || tools.length === 0) {
              return { tools: undefined, toolChoice: undefined }
            }

            const aiSdkTools = tools.map((tool) => {
              return {
                type: tool.type,
                name: tool.function.name,
                description: tool.function.description,
                inputSchema: tool.function.parameters!,
              }
            })

            let aiSdkToolChoice
            if (tool_choice == null) {
              aiSdkToolChoice = undefined
            } else if (tool_choice === "auto") {
              aiSdkToolChoice = { type: "auto" as const }
            } else if (tool_choice === "none") {
              aiSdkToolChoice = { type: "none" as const }
            } else if (tool_choice === "required") {
              aiSdkToolChoice = { type: "required" as const }
            } else if (tool_choice.type === "function") {
              aiSdkToolChoice = {
                type: "tool" as const,
                toolName: tool_choice.function.name,
              }
            }

            return { tools: aiSdkTools, toolChoice: aiSdkToolChoice }
          }

          function transformMessages() {
            const { messages } = body
            const prompt: LanguageModelV2Prompt = []

            for (const message of messages) {
              switch (message.role) {
                case "system": {
                  prompt.push({
                    role: "system",
                    content: message.content as string,
                  })
                  break
                }

                case "user": {
                  if (typeof message.content === "string") {
                    prompt.push({
                      role: "user",
                      content: [{ type: "text", text: message.content }],
                    })
                  } else {
                    const content = message.content.map((part) => {
                      switch (part.type) {
                        case "text":
                          return { type: "text" as const, text: part.text }
                        case "image_url":
                          return {
                            type: "file" as const,
                            mediaType: "image/jpeg" as const,
                            data: part.image_url.url,
                          }
                        default:
                          throw new Error(`Unsupported content part type: ${(part as any).type}`)
                      }
                    })
                    prompt.push({
                      role: "user",
                      content,
                    })
                  }
                  break
                }

                case "assistant": {
                  const content: Array<
                    | { type: "text"; text: string }
                    | {
                        type: "tool-call"
                        toolCallId: string
                        toolName: string
                        input: any
                      }
                  > = []

                  if (message.content) {
                    content.push({
                      type: "text",
                      text: message.content as string,
                    })
                  }

                  if (message.tool_calls) {
                    for (const toolCall of message.tool_calls) {
                      content.push({
                        type: "tool-call",
                        toolCallId: toolCall.id,
                        toolName: toolCall.function.name,
                        input: JSON.parse(toolCall.function.arguments),
                      })
                    }
                  }

                  prompt.push({
                    role: "assistant",
                    content,
                  })
                  break
                }

                case "tool": {
                  prompt.push({
                    role: "tool",
                    content: [
                      {
                        type: "tool-result",
                        toolName: "placeholder",
                        toolCallId: message.tool_call_id,
                        output: {
                          type: "text",
                          value: message.content as string,
                        },
                      },
                    ],
                  })
                  break
                }

                default: {
                  throw new Error(`Unsupported message role: ${message.role}`)
                }
              }
            }

            return prompt
          }
        }

        async function trackUsage(model: string, usage: LanguageModelUsage, providerMetadata?: ProviderMetadata) {
          const modelData = SUPPORTED_MODELS[model as keyof typeof SUPPORTED_MODELS]
          if (!modelData) throw new Error(`Unsupported model: ${model}`)

          const inputTokens = usage.inputTokens ?? 0
          const outputTokens = usage.outputTokens ?? 0
          const reasoningTokens = usage.reasoningTokens ?? 0
          const cacheReadTokens = usage.cachedInputTokens ?? 0
          const cacheWriteTokens =
            providerMetadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
            // @ts-expect-error
            providerMetadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
            0

          const inputCost = modelData.input * inputTokens
          const outputCost = modelData.output * outputTokens
          const reasoningCost = modelData.reasoning * reasoningTokens
          const cacheReadCost = modelData.cacheRead * cacheReadTokens
          const cacheWriteCost = modelData.cacheWrite * cacheWriteTokens
          const costInCents = (inputCost + outputCost + reasoningCost + cacheReadCost + cacheWriteCost) * 100

          await Billing.consume({
            model,
            inputTokens,
            outputTokens,
            reasoningTokens,
            cacheReadTokens,
            cacheWriteTokens,
            costInCents,
          })

          await Database.use((tx) =>
            tx
              .update(KeyTable)
              .set({ timeUsed: sql`now()` })
              .where(eq(KeyTable.id, keyRecord.id)),
          )
        }
      } catch (error: any) {
        return c.json({ error: { message: error.message } }, 500)
      }
    })
  })
  .use("/*", cors())
  .use(RestAuth)
  .get("/rest/account", async (c) => {
    const account = Actor.assert("account")
    let workspaces = await Workspace.list()
    if (workspaces.length === 0) {
      await Workspace.create()
      workspaces = await Workspace.list()
    }
    return c.json({
      id: account.properties.accountID,
      email: account.properties.email,
      workspaces,
    })
  })
  .get("/billing/info", async (c) => {
    const billing = await Billing.get()
    const payments = await Database.use((tx) =>
      tx
        .select()
        .from(PaymentTable)
        .where(eq(PaymentTable.workspaceID, Actor.workspace()))
        .orderBy(sql`${PaymentTable.timeCreated} DESC`)
        .limit(100),
    )
    const usage = await Database.use((tx) =>
      tx
        .select()
        .from(UsageTable)
        .where(eq(UsageTable.workspaceID, Actor.workspace()))
        .orderBy(sql`${UsageTable.timeCreated} DESC`)
        .limit(100),
    )
    return c.json({ billing, payments, usage })
  })
  .post(
    "/billing/checkout",
    zValidator(
      "json",
      z.custom<{
        success_url: string
        cancel_url: string
      }>(),
    ),
    async (c) => {
      const account = Actor.assert("user")

      const body = await c.req.json()

      const customer = await Billing.get()
      const session = await Billing.stripe().checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "opencode credits",
              },
              unit_amount: 2000, // $20 minimum
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          setup_future_usage: "on_session",
        },
        ...(customer.customerID
          ? { customer: customer.customerID }
          : {
              customer_email: account.properties.email,
              customer_creation: "always",
            }),
        metadata: {
          workspaceID: Actor.workspace(),
        },
        currency: "usd",
        payment_method_types: ["card"],
        success_url: body.success_url,
        cancel_url: body.cancel_url,
      })

      return c.json({
        url: session.url,
      })
    },
  )
  .post("/billing/portal", async (c) => {
    const body = await c.req.json()

    const customer = await Billing.get()
    if (!customer?.customerID) {
      throw new Error("No stripe customer ID")
    }

    const session = await Billing.stripe().billingPortal.sessions.create({
      customer: customer.customerID,
      return_url: body.return_url,
    })

    return c.json({
      url: session.url,
    })
  })
  .post("/stripe/webhook", async (c) => {
    const body = await Billing.stripe().webhooks.constructEventAsync(
      await c.req.text(),
      c.req.header("stripe-signature")!,
      Resource.STRIPE_WEBHOOK_SECRET.value,
    )

    console.log(body.type, JSON.stringify(body, null, 2))
    if (body.type === "checkout.session.completed") {
      const workspaceID = body.data.object.metadata?.workspaceID
      const customerID = body.data.object.customer as string
      const paymentID = body.data.object.payment_intent as string
      const amount = body.data.object.amount_total

      if (!workspaceID) throw new Error("Workspace ID not found")
      if (!customerID) throw new Error("Customer ID not found")
      if (!amount) throw new Error("Amount not found")
      if (!paymentID) throw new Error("Payment ID not found")

      await Actor.provide("system", { workspaceID }, async () => {
        const customer = await Billing.get()
        if (customer?.customerID && customer.customerID !== customerID) throw new Error("Customer ID mismatch")

        // set customer metadata
        if (!customer?.customerID) {
          await Billing.stripe().customers.update(customerID, {
            metadata: {
              workspaceID,
            },
          })
        }

        // get payment method for the payment intent
        const paymentIntent = await Billing.stripe().paymentIntents.retrieve(paymentID, {
          expand: ["payment_method"],
        })
        const paymentMethod = paymentIntent.payment_method
        if (!paymentMethod || typeof paymentMethod === "string") throw new Error("Payment method not expanded")

        await Database.transaction(async (tx) => {
          await tx
            .update(BillingTable)
            .set({
              balance: sql`${BillingTable.balance} + ${centsToMicroCents(amount)}`,
              customerID,
              paymentMethodID: paymentMethod.id,
              paymentMethodLast4: paymentMethod.card!.last4,
            })
            .where(eq(BillingTable.workspaceID, workspaceID))
          await tx.insert(PaymentTable).values({
            workspaceID,
            id: Identifier.create("payment"),
            amount: centsToMicroCents(amount),
            paymentID,
            customerID,
          })
        })
      })
    }

    console.log("finished handling")

    return c.json("ok", 200)
  })
  .get("/keys", async (c) => {
    const user = Actor.assert("user")

    const keys = await Database.use((tx) =>
      tx
        .select({
          id: KeyTable.id,
          name: KeyTable.name,
          key: KeyTable.key,
          userID: KeyTable.userID,
          timeCreated: KeyTable.timeCreated,
          timeUsed: KeyTable.timeUsed,
        })
        .from(KeyTable)
        .where(eq(KeyTable.workspaceID, user.properties.workspaceID))
        .orderBy(sql`${KeyTable.timeCreated} DESC`),
    )

    return c.json({ keys })
  })
  .post("/keys", zValidator("json", z.object({ name: z.string().min(1).max(255) })), async (c) => {
    const user = Actor.assert("user")
    const { name } = c.req.valid("json")

    // Generate secret key: sk- + 64 random characters (upper, lower, numbers)
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    let randomPart = ""
    for (let i = 0; i < 64; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    const secretKey = `sk-${randomPart}`

    const keyRecord = await Database.use((tx) =>
      tx
        .insert(KeyTable)
        .values({
          id: Identifier.create("key"),
          workspaceID: user.properties.workspaceID,
          userID: user.properties.userID,
          name,
          key: secretKey,
          timeUsed: null,
        })
        .returning(),
    )

    return c.json({
      key: secretKey,
      id: keyRecord[0].id,
      name: keyRecord[0].name,
      created: keyRecord[0].timeCreated,
    })
  })
  .delete("/keys/:id", async (c) => {
    const user = Actor.assert("user")
    const keyId = c.req.param("id")

    const result = await Database.use((tx) =>
      tx
        .delete(KeyTable)
        .where(and(eq(KeyTable.id, keyId), eq(KeyTable.workspaceID, user.properties.workspaceID)))
        .returning({ id: KeyTable.id }),
    )

    if (result.length === 0) {
      return c.json({ error: "Key not found" }, 404)
    }

    return c.json({ success: true, id: result[0].id })
  })
  .all("*", (c) => c.text("Not Found"))

export type ApiType = typeof app

export default app

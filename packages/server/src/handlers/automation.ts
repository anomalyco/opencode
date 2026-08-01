import { Automation } from "@opencode-ai/core/automation/automation"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHmac, timingSafeEqual } from "node:crypto"
import { Api } from "../api"
import { response } from "../location"
import { AutomationNotFoundError } from "@opencode-ai/protocol/errors"

export const AutomationHandler = HttpApiBuilder.group(Api, "server.automation", (handlers) =>
  Effect.gen(function* () {
    const automation = yield* Automation.Service

    return handlers
      .handle("automation.list", ({ query }) =>
        Effect.gen(function* () {
          const triggers = yield* automation.list({
            ...(query.sessionID ? { sessionID: query.sessionID } : {}),
          })
          return triggers
        }).pipe(response),
      )
      .handle("automation.get", ({ params }) =>
        Effect.gen(function* () {
          return yield* automation.get(params.id).pipe(
            Effect.catchTag("Automation.NotFoundError", () =>
              new AutomationNotFoundError({ id: params.id, message: `Automation trigger not found: ${params.id}` }),
            ),
          )
        }),
      )
      .handle("automation.create", ({ payload }) =>
        Effect.gen(function* () {
          return yield* automation.create({
            ...(payload.id ? { id: payload.id } : {}),
            sessionID: payload.sessionID,
            name: payload.name,
            prompt: payload.prompt,
            schedule: payload.schedule,
            ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
            ...(payload.agent ? { agent: payload.agent } : {}),
          })
        }),
      )
      .handle("automation.update", ({ params, payload }) =>
        Effect.gen(function* () {
          return yield* automation.update(params.id, payload).pipe(
            Effect.catchTag("Automation.NotFoundError", () =>
              new AutomationNotFoundError({ id: params.id, message: `Automation trigger not found: ${params.id}` }),
            ),
          )
        }),
      )
      .handle("automation.remove", ({ params }) =>
        Effect.gen(function* () {
          yield* automation.remove(params.id)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("automation.fire", ({ params }) =>
        Effect.gen(function* () {
          yield* automation.fire(params.id).pipe(
            Effect.catchTag("Automation.NotFoundError", () =>
              new AutomationNotFoundError({ id: params.id, message: `Automation trigger not found: ${params.id}` }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handleRaw(
        "automation.webhook",
        Effect.fn("AutomationHandler.webhook")((ctx) =>
          automation.get(ctx.params.id).pipe(
            Effect.catchTag("Automation.NotFoundError", () =>
              new AutomationNotFoundError({
                id: ctx.params.id,
                message: `Automation trigger not found: ${ctx.params.id}`,
              }),
            ),
            Effect.flatMap((trigger) => {
              if (trigger.schedule.type !== "webhook") {
                return Effect.succeed(
                  HttpServerResponse.jsonUnsafe({ error: "Trigger is not a webhook trigger" }, { status: 400 }),
                )
              }
              const schedule = trigger.schedule as { readonly type: "webhook"; readonly path: string; readonly secret?: string }
              const pathName = new URL(ctx.request.url, "http://localhost").pathname
              if (schedule.path && schedule.path !== pathName) {
                return Effect.succeed(
                  HttpServerResponse.jsonUnsafe({ error: "Webhook path mismatch" }, { status: 400 }),
                )
              }
              return Effect.orDie(ctx.request.text).pipe(
                Effect.flatMap((body) => {
                  if (schedule.secret) {
                    const signature = ctx.request.headers["x-hub-signature-256"]
                    if (!signature || Array.isArray(signature)) {
                      return Effect.succeed(
                        HttpServerResponse.jsonUnsafe({ error: "Missing X-Hub-Signature-256 header" }, { status: 401 }),
                      )
                    }
                    const expected =
                      "sha256=" + createHmac("sha256", schedule.secret).update(body).digest("hex")
                    const provided = signature
                    const a = Buffer.from(expected, "utf8")
                    const b = Buffer.from(provided, "utf8")
                    if (a.length !== b.length || !timingSafeEqual(a, b)) {
                      return Effect.succeed(
                        HttpServerResponse.jsonUnsafe({ error: "Invalid signature" }, { status: 401 }),
                      )
                    }
                  }
                  return automation.fire(ctx.params.id).pipe(
                    Effect.ignore,
                    Effect.as(HttpServerResponse.empty({ status: 200 })),
                  )
                }),
              )
            }),
          ),
        ),
      )
  }),
)

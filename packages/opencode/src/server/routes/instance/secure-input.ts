import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { SecureInput } from "@/secure-input"
import { SecureInputID } from "@/secure-input/schema"
import z from "zod"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"

const Submit = z.object({
  input: z.string().describe("The password or secure input value"),
})

const Cancel = z.object({})

export const SecureInputRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending secure input requests",
        description: "Get all pending secure input (password) requests across all sessions.",
        operationId: "secureInput.list",
        responses: {
          200: {
            description: "List of pending secure input requests",
            content: {
              "application/json": {
                schema: resolver(SecureInput.Request.zod.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("SecureInputRoutes.list", c, function* () {
          const svc = yield* SecureInput.Service
          return yield* svc.list()
        }),
    )
    .post(
      "/:requestID/submit",
      describeRoute({
        summary: "Submit secure input",
        description:
          "Submit a password or other secure input for a pending request. The input goes directly to the PTY and is never stored or logged.",
        operationId: "secureInput.submit",
        responses: {
          200: {
            description: "Secure input submitted successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: SecureInputID.zod,
        }),
      ),
      validator("json", Submit),
      async (c) =>
        jsonRequest("SecureInputRoutes.submit", c, function* () {
          const params = c.req.valid("param")
          const json = c.req.valid("json")
          const svc = yield* SecureInput.Service
          yield* svc.submit({
            requestID: params.requestID,
            input: json.input,
          })
          return true
        }),
    )
    .post(
      "/:requestID/cancel",
      describeRoute({
        summary: "Cancel secure input request",
        description: "Cancel a pending secure input request.",
        operationId: "secureInput.cancel",
        responses: {
          200: {
            description: "Secure input cancelled",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: SecureInputID.zod,
        }),
      ),
      async (c) =>
        jsonRequest("SecureInputRoutes.cancel", c, function* () {
          const params = c.req.valid("param")
          const svc = yield* SecureInput.Service
          yield* svc.cancel(params.requestID)
          return true
        }),
    ),
)

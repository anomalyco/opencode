import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { QuestionID } from "@/question/schema"
import { Question } from "../../question"
import { AppRuntime } from "@/effect/app-runtime"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const Reply = z.object({
  answers: Question.Answer.zod
    .array()
    .describe("User answers in order of questions (each answer is an array of selected labels)"),
})

export const QuestionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending questions",
        description: "Get all pending question requests across all sessions.",
        operationId: "question.list",
        responses: {
          200: {
            description: "List of pending questions",
            content: {
              "application/json": {
                schema: resolver(Question.Request.zod.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const questions = await AppRuntime.runPromise(Question.Service.use((svc) => svc.list()))
        return c.json(questions)
      },
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Reply to question request",
        description: "Provide answers to a question request from the AI assistant.",
        operationId: "question.reply",
        responses: {
          200: {
            description: "Question answered successfully",
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
          requestID: QuestionID.zod,
        }),
      ),
      validator("json", Reply),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await AppRuntime.runPromise(
          Question.Service.use((svc) =>
            svc.reply({
              requestID: params.requestID,
              answers: json.answers,
            }),
          ),
        )
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reject",
      describeRoute({
        summary: "Reject question request",
        description: "Reject a question request from the AI assistant.",
        operationId: "question.reject",
        responses: {
          200: {
            description: "Question rejected successfully",
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
          requestID: QuestionID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await AppRuntime.runPromise(Question.Service.use((svc) => svc.reject(params.requestID)))
        return c.json(true)
      },
    ),
)

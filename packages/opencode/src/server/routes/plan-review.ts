import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { PlanReview } from "../../session/plan-review"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const PlanReviewRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending plan reviews",
        description: "Get all pending plan review requests across all sessions.",
        operationId: "plan_review.list",
        responses: {
          200: {
            description: "List of pending plan reviews",
            content: {
              "application/json": {
                schema: resolver(PlanReview.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const reviews = await PlanReview.list()
        return c.json(reviews)
      },
    )
    .get(
      "/:requestID/content",
      describeRoute({
        summary: "Get plan content",
        description: "Get the content of a plan file for a pending review request.",
        operationId: "plan_review.content",
        responses: {
          200: {
            description: "Plan content",
            content: {
              "application/json": {
                schema: resolver(z.string()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: z.string(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const content = await PlanReview.content(params.requestID)
        return c.json(content)
      },
    )
    .post(
      "/:requestID/approve",
      describeRoute({
        summary: "Approve plan review",
        description: "Approve a plan and transition to build mode.",
        operationId: "plan_review.approve",
        responses: {
          200: {
            description: "Plan approved successfully",
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
          requestID: z.string(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await PlanReview.approve(params.requestID)
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reject",
      describeRoute({
        summary: "Reject plan review",
        description: "Reject a plan with optional feedback for revision.",
        operationId: "plan_review.reject",
        responses: {
          200: {
            description: "Plan rejected successfully",
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
          requestID: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          feedback: z.string().optional(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await PlanReview.reject(params.requestID, json.feedback)
        return c.json(true)
      },
    ),
)
